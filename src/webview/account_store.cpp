#include "account_store.h"

#include <algorithm>
#include <chrono>
#include <fstream>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <windows.h>
#include <wincrypt.h>
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/rand.h>

using nlohmann::json;
namespace {
constexpr size_t MaxBytes = 24 * 1024 * 1024;
constexpr auto BackupExtension = L".ezra-profile";
constexpr std::string_view Magic = "EZRA1";
std::mutex storeMutex;

std::string Random(size_t size)
{
    std::string bytes(size, '\0');
    if (RAND_bytes(reinterpret_cast<unsigned char*>(bytes.data()), static_cast<int>(size)) != 1)
        throw std::runtime_error("Could not initialize encryption.");
    return bytes;
}

std::string EncodeHex(std::string_view bytes)
{
    std::string id;
    for (const unsigned char byte : bytes) {
        constexpr std::string_view digits = "0123456789abcdef";
        id += digits[byte >> 4];
        id += digits[byte & 15];
    }
    return id;
}

std::string DecodeHex(std::string_view hex)
{
    constexpr std::string_view digits = "0123456789abcdef";
    if (hex.size() % 2 || hex.find_first_not_of(digits) != std::string::npos)
        throw std::runtime_error("Invalid Windows sync settings.");
    std::string bytes;
    for (size_t i = 0; i < hex.size(); i += 2) bytes += static_cast<char>(digits.find(hex[i]) * 16 + digits.find(hex[i + 1]));
    return bytes;
}

std::string Read(const std::filesystem::path& path)
{
    const auto size = std::filesystem::file_size(path);
    if (size > MaxBytes) throw std::runtime_error("The profile file is too large.");
    std::string bytes(static_cast<size_t>(size), '\0');
    std::ifstream input(path, std::ios::binary);
    if (!input.read(bytes.data(), static_cast<std::streamsize>(bytes.size())) || input.peek() != EOF)
        throw std::runtime_error("The profile file is temporarily unavailable.");
    return bytes;
}

void Write(const std::filesystem::path& path, const std::string& bytes)
{
    if (bytes.size() > MaxBytes) throw std::runtime_error("The profile file is too large.");
    auto temporary = path;
    temporary += L".tmp";
    std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
    output.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    output.close();
    if (!output || !MoveFileExW(temporary.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH))
        throw std::runtime_error("Could not save the profile file.");
}

std::string Protect(const std::string& bytes, bool encrypt)
{
    DATA_BLOB input{static_cast<DWORD>(bytes.size()), reinterpret_cast<BYTE*>(const_cast<char*>(bytes.data()))};
    DATA_BLOB output{};
    const BOOL ok = encrypt ? CryptProtectData(&input, L"Ezra's Stremio sync", nullptr, nullptr, nullptr,
        CRYPTPROTECT_UI_FORBIDDEN, &output) : CryptUnprotectData(&input, nullptr, nullptr, nullptr, nullptr,
        CRYPTPROTECT_UI_FORBIDDEN, &output);
    if (!ok) throw std::runtime_error("Windows could not unlock the saved sync settings.");
    const std::unique_ptr<void, decltype(&LocalFree)> buffer(output.pbData, LocalFree);
    return {reinterpret_cast<char*>(output.pbData), output.cbData};
}

std::string Cipher(std::string_view payload, const std::string& passphrase, bool encrypt)
{
    constexpr size_t saltSize = 16, nonceSize = 12, tagSize = 16;
    constexpr size_t headerSize = Magic.size() + saltSize + nonceSize;
    if (!encrypt && (payload.size() < headerSize + tagSize || !payload.starts_with(Magic)))
        throw std::runtime_error("Unrecognized encrypted profile file.");
    const std::string header = encrypt ? std::string(Magic) + Random(saltSize + nonceSize) : std::string(payload.substr(0, headerSize));
    const auto* salt = reinterpret_cast<const unsigned char*>(header.data() + Magic.size());
    const auto* nonce = salt + saltSize;
    unsigned char key[32];
    if (PKCS5_PBKDF2_HMAC(passphrase.data(), static_cast<int>(passphrase.size()), salt, saltSize,
            600000, EVP_sha256(), sizeof(key), key) != 1) throw std::runtime_error("Could not derive the sync key.");
    std::unique_ptr<EVP_CIPHER_CTX, decltype(&EVP_CIPHER_CTX_free)> context(EVP_CIPHER_CTX_new(), EVP_CIPHER_CTX_free);
    const bool initialized = context && EVP_CipherInit_ex(context.get(), EVP_aes_256_gcm(), nullptr, key, nonce, encrypt ? 1 : 0) == 1;
    OPENSSL_cleanse(key, sizeof(key));
    if (!initialized) throw std::runtime_error("Could not initialize profile encryption.");
    std::string tag(tagSize, '\0');
    if (!encrypt) {
        tag = payload.substr(payload.size() - tagSize);
        payload = payload.substr(headerSize, payload.size() - headerSize - tagSize);
        if (EVP_CIPHER_CTX_ctrl(context.get(), EVP_CTRL_GCM_SET_TAG, tagSize, tag.data()) != 1)
            throw std::runtime_error("Could not read the encrypted profile.");
    }
    std::string result(payload.size() + EVP_MAX_BLOCK_LENGTH, '\0');
    int length = 0, final = 0;
    if (EVP_CipherUpdate(context.get(), reinterpret_cast<unsigned char*>(result.data()), &length,
            reinterpret_cast<const unsigned char*>(payload.data()), static_cast<int>(payload.size())) != 1 ||
        EVP_CipherFinal_ex(context.get(), reinterpret_cast<unsigned char*>(result.data()) + length, &final) != 1)
        throw std::runtime_error("Could not unlock the profile. Check the sync passphrase.");
    result.resize(length + final);
    if (!encrypt) return result;
    if (EVP_CIPHER_CTX_ctrl(context.get(), EVP_CTRL_GCM_GET_TAG, tagSize, tag.data()) != 1)
        throw std::runtime_error("Could not seal the profile.");
    return header + result + tag;
}

bool Hex(const std::string& value, size_t length)
{
    return value.size() == length && value.find_first_not_of("0123456789abcdef") == std::string::npos;
}

bool Key(const std::string& key)
{
    return key.size() <= 1024 && (key.starts_with("title/") || key.starts_with("progress/") ||
        key.starts_with("list/") || key.starts_with("addon/"));
}

void ValidateRecords(const json& records)
{
    if (!records.is_object() || records.size() > 50000) throw std::runtime_error("Invalid profile records.");
    for (const auto& [key, record] : records.items()) {
        if (!Key(key) || !Hex(record.at("device").get<std::string>(), 32) || !record.at("clock").is_number_integer() ||
            record.at("clock").get<int64_t>() < 1 || record.at("clock").get<int64_t>() > 9007199254740991LL ||
            (!record.at("value").is_object() && !record.at("value").is_null())) throw std::runtime_error("Invalid profile record.");
    }
}

void Apply(json& state, const std::string& key, const json& value)
{
    if (!Key(key) || (!value.is_object() && !value.is_null())) throw std::runtime_error("Invalid profile update.");
    auto& records = state["records"];
    if (records.contains(key) && records[key]["value"] == value) return;
    const auto now = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
    const auto clock = (std::max)(static_cast<int64_t>(now), state.at("clock").get<int64_t>() + 1);
    if (clock > 9007199254740991LL) throw std::runtime_error("Profile revision limit reached.");
    state["clock"] = clock;
    records[key] = {{"device", state["device"]}, {"clock", clock}, {"value", value}};
}

void Merge(json& state, const json& incoming)
{
    ValidateRecords(incoming);
    for (const auto& [key, record] : incoming.items()) {
        auto& existing = state["records"][key];
        const auto clock = record.at("clock").get<int64_t>();
        if (existing.is_null() || clock > existing.at("clock").get<int64_t>() ||
            (clock == existing.at("clock").get<int64_t>() && record.at("device") > existing.at("device"))) existing = record;
        if (clock > state.at("clock").get<int64_t>()) state["clock"] = clock;
    }
}

void Pull(json& state, const std::filesystem::path& folder, const std::string& password)
{
    for (const auto& file : std::filesystem::directory_iterator(folder)) {
        if (!file.path().filename().wstring().starts_with(L"Ezras-Stremio-") || file.path().extension() != BackupExtension ||
            !file.is_regular_file()) continue;
        const auto envelope = json::parse(Cipher(Read(file.path()), password, false));
        if (envelope.at("version") != 1) throw std::runtime_error("Unsupported synced profile version.");
        const auto account = envelope.value("account", std::string{});
        const auto current = state.at("account").get<std::string>();
        if (!account.empty() && !Hex(account, 64)) throw std::runtime_error("Invalid account in the synced profile.");
        if (!current.empty() && !account.empty() && current != account)
            throw std::runtime_error("This sync folder belongs to a different Stremio account.");
        if (current.empty() && !account.empty()) state["account"] = account;
        Merge(state, envelope.at("records"));
    }
}

void Push(const json& state, const std::filesystem::path& folder, const std::string& password)
{
    if (state.at("records").empty()) return;
    const auto file = folder / ("Ezras-Stremio-" + state.at("device").get<std::string>() + ".ezra-profile");
    if (state.contains("publishedClock") && state["publishedClock"] == state["clock"] && std::filesystem::exists(file)) return;
    const auto envelope = json{{"version", 1}, {"account", state["account"]}, {"records", state["records"]}}.dump();
    if (envelope.size() + 64 > MaxBytes) throw std::runtime_error("The encrypted profile is too large.");
    Write(file, Cipher(envelope, password, true));
}

json View(const json& state, bool localPage)
{
    json result = {{"enabled", state["enabled"]}, {"hasProfile", !state.at("records").empty()}};
    if (localPage) {
        result["connected"] = state.contains("syncFolder");
        auto& data = result["data"] = json::object();
        for (const auto& [key, record] : state.at("records").items())
            if (!record.at("value").is_null()) data[key] = record["value"];
    }
    return result;
}
}

json HandleAccountRequest(const std::filesystem::path& directory, bool localPage, const json& request)
{
    std::lock_guard lock(storeMutex);
    try {
        const auto action = request.at("action").get<std::string>();
        if (!localPage && action != "status" && action != "mirror") throw std::runtime_error("This action requires the local profile screen.");
        const auto file = directory / "profile.json";
        json state = std::filesystem::exists(file) ? json::parse(Read(file)) : json{{"version", 1},
            {"enabled", false}, {"clock", 0}, {"account", ""}, {"records", json::object()}, {"mirror", json::object()}};
        if (state.at("version") != 1) throw std::runtime_error("Unsupported local profile version.");
        if (action == "status") return View(state, localPage);
        if (!state.contains("device")) state["device"] = EncodeHex(Random(16));
        std::filesystem::create_directories(directory);
        if (action == "enable") state["enabled"] = true;
        else if (action == "disconnect") {
            state.erase("syncFolder");
            state.erase("syncKey");
        }
        else if (action == "connect") {
            const auto folder = std::filesystem::u8path(request.at("folder").get<std::string>());
            const auto password = request.at("passphrase").get<std::string>();
            if (password.size() < 12 || password.size() > 512 || !std::filesystem::is_directory(folder))
                throw std::runtime_error("Choose an available folder and a passphrase of at least 12 characters.");
            Pull(state, folder, password);
            state.erase("publishedClock");
            state["syncFolder"] = request.at("folder");
            state["syncKey"] = EncodeHex(Protect(password, true));
            Push(state, folder, password);
            state["publishedClock"] = state["clock"];
        } else if (action == "mirror" || action == "edit" || action == "import" || action == "sync") {
            if (action == "mirror" && !state.at("enabled").get<bool>()) return View(state, false);
            if (action == "mirror") {
                const auto account = request.at("account").get<std::string>();
                if (!Hex(account, 64) || (state["account"] != "" && state["account"] != account))
                    throw std::runtime_error("The signed-in Stremio account does not match this local profile.");
                state["account"] = account;
            }
            if (action != "sync") {
                const auto& values = request.at("data");
                if (!values.is_object() || values.size() > 50000) throw std::runtime_error("Invalid profile update.");
                for (const auto& [key, value] : values.items()) {
                    if (action == "mirror" && state["mirror"].contains(key) && state["mirror"][key] == value) continue;
                    if (action != "import" || !state["records"].contains(key)) Apply(state, key, value);
                    if (action == "mirror") state["mirror"][key] = value;
                }
                if (action == "mirror") {
                    for (auto& [key, previous] : state["mirror"].items()) {
                        const bool complete = (key.starts_with("addon/") && request.value("completeAddons", false)) ||
                            (key.starts_with("list/") && request.value("completeLists", false));
                        if (complete && !previous.is_null() && !values.contains(key)) {
                            Apply(state, key, nullptr);
                            previous = nullptr;
                        }
                    }
                }
            }
            // Persist the local edits before touching a cloud-backed folder.
            Write(file, state.dump());
            if (state.contains("syncFolder")) {
                try {
                    const auto folder = std::filesystem::u8path(state.at("syncFolder").get<std::string>());
                    const auto password = Protect(DecodeHex(state.at("syncKey").get_ref<const std::string&>()), false);
                    auto merged = state;
                    Pull(merged, folder, password);
                    Write(file, merged.dump());
                    state = std::move(merged);
                    Push(state, folder, password);
                    state["publishedClock"] = state["clock"];
                } catch (const std::exception&) {
                    auto result = View(state, localPage);
                    result["syncWarning"] = "Local data is saved. Sync is unavailable or the folder could not be unlocked.";
                    return result;
                }
            }
        } else throw std::runtime_error("Unknown local profile action.");
        Write(file, state.dump());
        return View(state, localPage);
    } catch (const json::exception&) {
        return {{"error", "The profile or backup could not be read."}};
    } catch (const std::filesystem::filesystem_error&) {
        return {{"error", "The profile folder is unavailable."}};
    } catch (const std::exception& error) {
        return {{"error", error.what()}};
    }
}
