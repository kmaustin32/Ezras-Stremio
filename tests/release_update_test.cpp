#include "../src/updater/release_update.h"
#include <iostream>
#include <stdexcept>

using nlohmann::json;

namespace {
json Release(std::string version, bool beta, std::string published, std::string extension = ".exe")
{
    const auto filename = "Ezras-Stremio-" + version + "-x64" + extension;
    const auto url = "https://github.com/kmaustin32/Ezras-Stremio/releases/download/v" + version + "/" + filename;
    return {{"tag_name", "v" + version}, {"draft", false}, {"prerelease", beta}, {"published_at", published},
        {"assets", json::array({{{"name", filename}, {"browser_download_url", url}, {"state", "uploaded"},
            {"size", 123u}, {"digest", "sha256:" + std::string(64, 'a')}}})}};
}

void Expect(bool condition, const char* reason)
{
    if (!condition) throw std::runtime_error(reason);
}
}

int main()
{
    try {
        const auto stable = Release("2.2.0", false, "2026-11-20T11:00:00Z");
        const auto beta2 = Release("2.2.1-beta.2", true, "2026-11-22T11:00:00Z");
        const auto beta10 = Release("2.2.1-beta.10", true, "2026-11-24T11:00:00Z");
        const auto oldPreview = Release("3.0.1-beta.2", true, "2026-11-10T11:00:00Z");
        auto draft = Release("4.0.0", false, "2026-11-24T11:00:00Z");
        draft["draft"] = true;
        const auto releases = json::array({beta2, draft, stable, oldPreview, beta10});
        const auto current = FindReleaseUpdate(releases, "2.1.5", UpdateChannel::Stable, false);
        Expect(current && current->version == "2.2.0" && current->url.ends_with("2.2.0-x64.exe"),
            "Stable should select the published stable installer");
        const auto beta = FindReleaseUpdate(releases, "2.2.1-beta.2", UpdateChannel::Beta, false);
        Expect(beta && beta->version == "2.2.1-beta.10" && beta->sha256 == std::string(64, 'a'),
            "Beta numbers should sort numerically and skip the old experimental branch");
        Expect(!FindReleaseUpdate(releases, "2.2.1-beta.10", UpdateChannel::Stable, false),
            "Switching to Stable must not downgrade");
        const auto final = FindReleaseUpdate(releases, "2.2.0-beta.99", UpdateChannel::Stable, false);
        Expect(final && final->version == "2.2.0", "Final must supersede its own beta");
        Expect(!FindReleaseUpdate(releases, "2.2.0", UpdateChannel::Stable, false), "No update for the current version");

        const auto zip = Release("2.3.0", false, "2026-11-28T11:00:00Z", ".zip");
        const auto portable = FindReleaseUpdate(json::array({zip}), "2.2.0", UpdateChannel::Stable, true);
        Expect(portable && portable->url.ends_with("2.3.0-x64.zip"), "Portable mode must use the ZIP");

        auto unsafe = stable;
        unsafe["assets"][0]["browser_download_url"] = "https://example.invalid/installer.exe";
        auto missing = stable;
        missing["assets"][0]["digest"] = nullptr;
        for (const auto& unverified : {unsafe, missing, zip}) {
            bool rejected = false;
            try { FindReleaseUpdate(json::array({unverified}), "2.1.5", UpdateChannel::Stable, false); }
            catch (const std::runtime_error&) { rejected = true; }
            Expect(rejected, "Never offer an installer with unverified download metadata");
        }
        std::cout << "PASS: update channels, version ordering, portable selection and asset verification\n";
    } catch (const std::exception& e) {
        std::cerr << e.what() << '\n';
        return 1;
    }
}
