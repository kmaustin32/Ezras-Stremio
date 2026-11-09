#include "../src/webview/library_store.h"
#include <chrono>
#include <iostream>
#include <stdexcept>

using nlohmann::json;

int main()
{
    struct TemporaryDirectory {
        std::filesystem::path path;
        ~TemporaryDirectory() {std::error_code ignored; std::filesystem::remove_all(path, ignored);}
    } directory{std::filesystem::temp_directory_path() / ("ezras-library-test-" +
        std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()))};
    const auto require = [](bool condition, const char* message) {
        if (!condition) throw std::runtime_error(message);
    };
    const auto list = [](const char* id, const char* name, json items) {
        return json{{"id", id}, {"name", name}, {"items", std::move(items)}};
    };
    const auto legacy = [](json lists) {return json{{"version", 1}, {"lists", std::move(lists)}};};
    const auto load = [&](std::string_view origin, std::string_view uid, json data = nullptr) {
        return HandleLibraryStoreRequest(directory.path, origin,
            {{"requestId", "test"}, {"action", "load"}, {"uid", uid}, {"legacy", std::move(data)}});
    };
    const auto save = [&](std::string_view origin, int revision, const json& lists) {
        return HandleLibraryStoreRequest(directory.path, origin,
            {{"requestId", "test"}, {"action", "save"}, {"uid", "account"}, {"revision", revision}, {"lists", lists}});
    };
    try {
        require(LibraryStoreOrigin(L"https://stremio.zarg.me/#/library") == "primary", "Accept primary Library");
        require(LibraryStoreOrigin(L"https://zaarrg.github.io/stremio-web-shell-fixes/#/") == "fallback", "Accept fallback Library");
        require(LibraryStoreOrigin(L"https://example.invalid/?next=https://stremio.zarg.me/").empty(), "Reject embedded trusted URL");
        require(LibraryStoreOrigin(L"https://zaarrg.github.io/unrelated/").empty(), "Reject other projects on the fallback host");
        const auto primary = legacy(json::array({list("anime", "Anime", {"tt100"}), list("custom", "Weekend", {"tt200"})}));
        const auto first = load("primary", "account", primary).at("record");
        require(first["revision"] == 1 && first["lists"] == primary["lists"], "Migrate primary lists");
        const auto broken = load("fallback", "account", "{broken");
        require(broken["legacyUnreadable"] == true && broken["record"] == first,
            "Broken legacy JSON must leave shared lists and the revision available");
        const auto invalid = load("fallback", "account", legacy(json::array({list("invalid", " ", {"tt100"})})).dump());
        require(invalid["legacyUnreadable"] == true && invalid["record"] == first,
            "Malformed legacy records must leave shared lists available");
        const auto fresh = load("fallback", "fresh-account", "null");
        require(fresh["legacyUnreadable"] == true && fresh["record"]["revision"] == 0 &&
            fresh["record"]["lists"].empty(), "Allow a new account to create lists despite unreadable legacy data");
        const auto fallback = legacy(json::array({list("live-action", "Live Action", {"tt100", "tt300"}),
            list("custom", "Weekend", {"tt400"}), list("favorites", "Favorites", {"tt500"})}));
        const auto shared = load("fallback", "account", fallback.dump()).at("record");
        require(shared["revision"] == 2 && shared["lists"].size() == 4, "Merge independent fallback lists");
        require(shared["lists"][1]["items"] == json::array({"tt200", "tt400"}), "Merge memberships without duplicates");
        require(shared["lists"][2]["items"] == json::array({"tt300"}), "Retain existing manual category choice");
        require(load("primary", "account", primary)["record"] == shared, "Read the same store from both hosts");
        require(!load("primary", "account", "{broken").contains("legacyUnreadable"),
            "Ignore old storage after that origin was migrated");
        require(save("primary", 1, primary["lists"])["conflict"] == true, "Reject a stale write");
        auto revised = shared["lists"];
        revised[1]["items"] = json::array({"tt400"});
        const auto updated = save("fallback", 2, revised).at("record");
        require(updated["revision"] == 3 && updated["lists"] == revised, "Persist fallback edits");
        require(load("primary", "account", primary)["record"] == updated, "A repeat migration cannot resurrect removed titles");
        require(load("primary", "different")["record"]["lists"].empty(), "Keep accounts separate");
        require(save("primary", 3, json::array({list("../x", "Bad", {"tt100"})})).contains("error"), "Reject malformed lists");
        require(load("fallback", "account")["record"] == updated, "Malformed writes leave the stored lists intact");
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
