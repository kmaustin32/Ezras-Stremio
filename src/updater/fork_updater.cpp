#include "fork_updater.h"
#include "release_update.h"
#include "../core/globals.h"
#include "../ui/mainwindow.h"
#include "../utils/config.h"
#include "../utils/helpers.h"

#include <curl/curl.h>
#include <openssl/evp.h>
#include <wil/resource.h>
#include <algorithm>
#include <array>
#include <memory>
#include <stdexcept>

namespace {
struct Result {
    std::optional<ReleaseUpdate> offer;
    std::filesystem::path installer;
    wil::unique_hfile verifiedFile;
    std::string error;
};

// Only the worker writes its result. The window reads it after joining.
std::jthread worker;
Result finished;
std::optional<ReleaseUpdate> offer;
std::string_view status = "idle";
std::string error;

std::wstring SettingsPath()
{
    return GetExeDirectory() + L"\\portable_config\\stremio-settings.ini";
}

UpdateChannel Channel()
{
    return GetPrivateProfileIntW(L"Updates", L"Beta", 0, SettingsPath().c_str()) == 1
        ? UpdateChannel::Beta : UpdateChannel::Stable;
}

bool IsPortable()
{
    return !FileExists(GetExeDirectory() + L"\\Uninstall.exe");
}

void Report()
{
    if (g_webview) SendToJS("fork-update-status", {{"channel", Channel() == UpdateChannel::Beta ? "beta" : "stable"},
        {"status", status}, {"version", offer ? offer->version : ""}, {"error", error}, {"portable", IsPortable()}});
}

void Fail(std::string message)
{
    status = "error";
    error = std::move(message);
    Report();
}

void Transfer(const std::string& url, std::stop_token stop, bool installer,
    curl_write_callback writer, void* context)
{
    const std::unique_ptr<CURL, decltype(&curl_easy_cleanup)> curl(curl_easy_init(), curl_easy_cleanup);
    if (!curl) throw std::runtime_error("Could not start the download.");
    curl_easy_setopt(curl.get(), CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl.get(), CURLOPT_USERAGENT, "Ezras-Stremio/" EZRAS_STREMIO_VERSION);
    curl_easy_setopt(curl.get(), CURLOPT_PROTOCOLS_STR, "https");
    curl_easy_setopt(curl.get(), CURLOPT_REDIR_PROTOCOLS_STR, "https");
    curl_easy_setopt(curl.get(), CURLOPT_FOLLOWLOCATION, installer ? 1L : 0L);
    curl_easy_setopt(curl.get(), CURLOPT_MAXREDIRS, 5L);
    curl_easy_setopt(curl.get(), CURLOPT_CONNECTTIMEOUT, 10L);
    curl_easy_setopt(curl.get(), CURLOPT_TIMEOUT, installer ? 600L : 25L);
    curl_easy_setopt(curl.get(), CURLOPT_LOW_SPEED_TIME, 30L);
    curl_easy_setopt(curl.get(), CURLOPT_LOW_SPEED_LIMIT, 1024L);
    curl_easy_setopt(curl.get(), CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(curl.get(), CURLOPT_FAILONERROR, 1L);
    curl_easy_setopt(curl.get(), CURLOPT_NOPROGRESS, 0L);
    curl_easy_setopt(curl.get(), CURLOPT_XFERINFOFUNCTION,
        +[](void* token, curl_off_t, curl_off_t, curl_off_t, curl_off_t) {
            return static_cast<int>(static_cast<std::stop_token*>(token)->stop_requested());
        });
    curl_easy_setopt(curl.get(), CURLOPT_XFERINFODATA, &stop);
    curl_easy_setopt(curl.get(), CURLOPT_WRITEFUNCTION, writer);
    curl_easy_setopt(curl.get(), CURLOPT_WRITEDATA, context);
    long response = 0;
    const auto result = curl_easy_perform(curl.get());
    curl_easy_getinfo(curl.get(), CURLINFO_RESPONSE_CODE, &response);
    if (result != CURLE_OK || response != 200)
        throw std::runtime_error(installer ? "The installer could not be downloaded. Try again." :
            "Could not reach GitHub to check for updates. Try again.");
}

std::optional<ReleaseUpdate> Check(UpdateChannel channel, bool portable, std::stop_token stop)
{
    std::string body;
    Transfer(ReleaseFeedUrl, stop, false, +[](char* data, size_t size, size_t count, void* context) -> size_t {
        auto& response = *static_cast<std::string*>(context);
        const size_t bytes = size * count;
        if (bytes > 8 * 1024 * 1024 - response.size()) return 0;
        try { response.append(data, bytes); }
        catch (...) { return 0; }
        return bytes;
    }, &body);
    try {
        return FindReleaseUpdate(json::parse(body), EZRAS_STREMIO_VERSION, channel, portable);
    } catch (const std::exception&) {
        throw std::runtime_error("Could not verify the release information from GitHub. Try again later.");
    }
}

void RemoveInstaller(Result& result)
{
    result.verifiedFile.reset();
    if (result.installer.empty()) return;
    std::error_code ignored;
    std::filesystem::remove(result.installer, ignored);
    std::filesystem::remove(result.installer.parent_path(), ignored);
    result.installer.clear();
}

void DownloadInstaller(Result& result, const ReleaseUpdate& package, std::stop_token stop)
{
    GUID id{};
    wchar_t dirname[39]{};
    if (FAILED(CoCreateGuid(&id)) || !StringFromGUID2(id, dirname, ARRAYSIZE(dirname)))
        throw std::runtime_error("Could not prepare a temporary folder for the installer.");
    const auto folder = std::filesystem::temp_directory_path() / (std::wstring(L"Ezras-Stremio-Update-") + dirname);
    const auto path = folder / L"Ezras-Stremio-Update.exe";
    if (!std::filesystem::create_directory(folder))
        throw std::runtime_error("Could not create a temporary folder for the installer.");
    result.installer = path;
    wil::unique_hfile output(CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr));
    if (!output) throw std::runtime_error("Could not save the installer.");
    struct Download {
        HANDLE file;
        std::uint64_t remaining;
    } download{output.get(), package.size};
    Transfer(package.url, stop, true, +[](char* data, size_t size, size_t count, void* context) -> size_t {
        auto& download = *static_cast<Download*>(context);
        const size_t bytes = size * count;
        DWORD written = 0;
        if (bytes > download.remaining || bytes > MAXDWORD ||
            !WriteFile(download.file, data, static_cast<DWORD>(bytes), &written, nullptr) || written != bytes) return 0;
        download.remaining -= written;
        return written;
    }, &download);
    output.reset();
    if (download.remaining) throw std::runtime_error("The installer download was incomplete.");

    // Hold a read-only handle through launch so the verified bytes cannot be replaced.
    result.verifiedFile.reset(CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ,
        nullptr, OPEN_EXISTING, FILE_FLAG_SEQUENTIAL_SCAN, nullptr));
    const std::unique_ptr<EVP_MD_CTX, decltype(&EVP_MD_CTX_free)> digest(EVP_MD_CTX_new(), EVP_MD_CTX_free);
    if (!result.verifiedFile || !digest || EVP_DigestInit_ex(digest.get(), EVP_sha256(), nullptr) != 1)
        throw std::runtime_error("Could not verify the installer.");
    std::array<char, 65536> buffer;
    std::uint64_t remaining = package.size;
    while (remaining && !stop.stop_requested()) {
        DWORD read = 0;
        const auto count = static_cast<DWORD>((std::min<std::uint64_t>)(buffer.size(), remaining));
        if (!ReadFile(result.verifiedFile.get(), buffer.data(), count, &read, nullptr) || !read ||
            EVP_DigestUpdate(digest.get(), buffer.data(), read) != 1)
            throw std::runtime_error("Could not verify the installer.");
        remaining -= read;
    }
    LARGE_INTEGER size{};
    unsigned char hash[32];
    unsigned int length = 0;
    if (remaining || !GetFileSizeEx(result.verifiedFile.get(), &size) ||
        static_cast<std::uint64_t>(size.QuadPart) != package.size ||
        EVP_DigestFinal_ex(digest.get(), hash, &length) != 1 || length != sizeof(hash))
        throw std::runtime_error("Could not verify the installer.");
    constexpr std::string_view hex = "0123456789abcdef";
    std::string checksum;
    for (const auto byte : hash) {
        checksum += hex[byte >> 4];
        checksum += hex[byte & 15];
    }
    if (checksum != package.sha256)
        throw std::runtime_error("The installer did not match GitHub's checksum. Try again.");
}

void StartWork(bool install)
{
    const auto channel = Channel();
    const auto portable = IsPortable();
    const auto selected = offer;
    error.clear();
    status = install ? "downloading" : "checking";
    if (!install) offer.reset();
    try {
        worker = std::jthread([window = g_hWnd, channel, portable, selected, install](std::stop_token stop) {
            Result result;
            try {
                if (install) DownloadInstaller(result, *selected, stop);
                else result.offer = Check(channel, portable, stop);
            } catch (const std::exception& e) {
                RemoveInstaller(result);
                result.error = e.what();
            }
            finished = std::move(result);
            PostMessageW(window, WM_FORK_UPDATE_READY, 0, 0);
        });
        Report();
    } catch (const std::exception&) {
        Fail("Could not start the update. Try again.");
    }
}
}

bool IsForkUpdateSource(std::wstring_view source)
{
    for (const auto* prefix : {L"https://stremio.zarg.me/", L"https://zaarrg.github.io/stremio-web-shell-fixes/",
            L"https://web.stremio.com/"}) {
        if (source.starts_with(prefix)) return true;
    }
    return false;
}

void HandleForkUpdateRequest(std::string_view request)
{
    if (request == "state" || worker.joinable() || status == "installing") {
        Report();
    } else if (request == "stable" || request == "beta") {
        if (!WritePrivateProfileStringW(L"Updates", L"Beta", request == "beta" ? L"1" : L"0", SettingsPath().c_str())) {
            Fail("Could not save the update channel.");
            return;
        }
        status = "idle";
        offer.reset();
        error.clear();
        Report();
    } else if (request == "check") {
        StartWork(false);
    } else if (request == "install" && status == "available" && offer) {
        if (IsPortable()) {
            const auto url = Utf8ToWstring(offer->url);
            if (reinterpret_cast<INT_PTR>(ShellExecuteW(g_hWnd, L"open", url.c_str(), nullptr, nullptr, SW_SHOWNORMAL)) <= 32)
                Fail("Could not start the portable ZIP download.");
        } else StartWork(true);
    }
}

void CompleteForkUpdate()
{
    if (!worker.joinable()) return;
    worker.join();
    Result result = std::move(finished);
    finished = {};
    if (!result.error.empty()) {
        Fail(std::move(result.error));
        return;
    }
    if (result.installer.empty()) {
        offer = std::move(result.offer);
        status = offer ? "available" : "current";
        Report();
        return;
    }

    status = "installing";
    Report();
    const auto prompt = L"Install Ezra's Stremio " + Utf8ToWstring(offer->version) +
        L"? Stremio will close and the Windows installer will open.";
    if (MessageBoxW(g_hWnd, prompt.c_str(), L"Ezra's Stremio Update",
            MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON2) != IDYES) {
        RemoveInstaller(result);
        status = "available";
        Report();
        return;
    }
    const auto directory = GetExeDirectory();
    auto command = L"\"" + result.installer.wstring() + L"\" /keepconfig /overrideInstallDir=\"" + directory + L"\"";
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION process{};
    if (!CreateProcessW(result.installer.c_str(), command.data(), nullptr, nullptr, FALSE, 0,
            nullptr, result.installer.parent_path().c_str(), &startup, &process)) {
        RemoveInstaller(result);
        Fail("The installer could not be started. Stremio is still open.");
        return;
    }
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    WINDOWPLACEMENT placement{sizeof(placement)};
    if (GetWindowPlacement(g_hWnd, &placement)) SaveWindowPlacement(placement);
    DestroyWindow(g_hWnd);
}

void ShutdownForkUpdate()
{
    if (worker.joinable()) {
        worker.request_stop();
        worker.join();
    }
    RemoveInstaller(finished);
}
