#include "../src/webview/account_store.h"
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <windows.h>

using nlohmann::json;

int main()
{
    const auto root = std::filesystem::temp_directory_path() / ("ezra-account-test-" + std::to_string(GetCurrentProcessId()) + "-" + std::to_string(GetTickCount64()));
    const auto first = root / "first", second = root / "second", cloud = root / "Drive", fresh = root / "fresh";
    const std::string pass = "synthetic passphrase for beta testing", account(64, 'a');
    auto expect = [](bool good, const char* message) { if (!good) throw std::runtime_error(message); };
    auto call = [](const auto& directory, bool trusted, const json& request) {
        const auto result = HandleAccountRequest(directory, trusted, request);
        if (result.contains("error")) throw std::runtime_error(result["error"].get<std::string>());
        return result;
    };
    try {
        std::filesystem::create_directories(cloud);
        const json connect = {{"action", "connect"}, {"folder", cloud.string()}, {"passphrase", pass}};
        const json original = {{"name", "synthetic-title-marker"}}, addon = {{"url", "https://example.invalid/private-test-key/manifest.json"}};
        expect(HandleAccountRequest(first, false, connect).contains("error"), "A hosted page cannot change sync settings");
        call(first, true, {{"action", "enable"}});
        const json mirror = {{"action", "mirror"}, {"account", account}, {"data", {{"title/movie/tt1", original}, {"addon/test", addon}}}};
        expect(!call(first, false, mirror).contains("data"), "Hosted pages cannot read private profile data");
        call(first, true, connect);
        for (const auto& item : std::filesystem::directory_iterator(cloud)) {
            std::ifstream file(item.path(), std::ios::binary);
            const std::string encrypted{std::istreambuf_iterator<char>(file), {}};
            expect(encrypted.starts_with("EZRA1") && encrypted.find("private-test-key") == std::string::npos &&
                encrypted.find("synthetic-title-marker") == std::string::npos, "Sync files must encrypt the whole profile");
        }
        auto wrong = connect; wrong["passphrase"] = "synthetic wrong passphrase";
        expect(HandleAccountRequest(fresh, true, wrong).contains("error"), "Wrong passphrase must not import or overwrite");
        expect(call(second, true, connect)["data"]["title/movie/tt1"] == original, "Fresh installation must restore without sign-in");
        std::filesystem::rename(cloud, root / "offline");
        expect(call(first, true, {{"action", "edit"}, {"data", {{"progress/movie/tt1/tt1", {{"seconds", 93}}}}}}).contains("syncWarning"),
            "Local watch progress must save while Drive is offline");
        call(second, true, {{"action", "edit"}, {"data", {{"title/movie/tt2", {{"name", "Another title"}}}, {"addon/test", nullptr}}}});
        std::filesystem::rename(root / "offline", cloud);
        call(first, true, {{"action", "sync"}});
        auto merged = call(second, true, {{"action", "sync"}})["data"];
        expect(merged.contains("title/movie/tt2") && merged["progress/movie/tt1/tt1"]["seconds"] == 93 && !merged.contains("addon/test"),
            "Independent offline edits and removals must merge across installations");
        call(first, false, mirror);
        expect(!call(first, true, {{"action", "status"}})["data"].contains("addon/test"), "Unchanged Stremio snapshots must not undo a local removal");
        auto another = mirror; another["account"] = std::string(64, 'b');
        expect(HandleAccountRequest(first, false, another).contains("error"), "A different Stremio account must not overwrite the profile");
        std::filesystem::remove_all(root);
        std::cout << "PASS: private encryption, independent restore, unavailable folder, concurrent edits, and account isolation\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        std::error_code ignored;
        std::filesystem::remove_all(root, ignored);
        return 1;
    }
}
