#include "release_update.h"

#include <regex>
#include <stdexcept>
#include <tuple>
#include <vector>

namespace {
constexpr auto downloadRoot = "https://github.com/kmaustin32/Ezras-Stremio/releases/download/";

// Rank beta numbers numerically. A final release supersedes its betas.
using Version = std::tuple<int, int, int, int, int>;
std::optional<Version> ParseVersion(std::string_view version)
{
    static const std::regex pattern(R"((0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})(?:-beta\.([1-9][0-9]{0,5})|(-hotfix))?)");
    std::match_results<std::string_view::const_iterator> match;
    if (!std::regex_match(version.begin(), version.end(), match, pattern)) return std::nullopt;
    return Version{std::stoi(match[1].str()), std::stoi(match[2].str()), std::stoi(match[3].str()),
        match[4].matched ? 0 : (match[5].matched ? 2 : 1), match[4].matched ? std::stoi(match[4].str()) : 0};
}
}

std::optional<ReleaseUpdate> FindReleaseUpdate(const nlohmann::json& releases, std::string_view installed,
    UpdateChannel channel, bool portable)
{
    const auto current = ParseVersion(installed);
    if (!current || !releases.is_array()) throw std::runtime_error("Invalid update feed");

    struct Candidate {
        Version version;
        std::string published;
        bool beta;
        ReleaseUpdate package;
    };
    const Candidate* stable = nullptr;
    std::vector<Candidate> candidates;
    for (const auto& release : releases) {
        if (!release.is_object() || release.value("draft", true)) continue;
        const auto tag = release.value("tag_name", std::string{});
        if (!tag.starts_with('v')) continue;
        const auto version = ParseVersion(std::string_view(tag).substr(1));
        if (!version) continue;
        const bool beta = release.value("prerelease", false);
        if (beta != (std::get<3>(*version) == 0)) continue;
        const auto published = release.value("published_at", std::string{});
        if (published.empty()) continue;

        const auto filename = "Ezras-Stremio-" + tag.substr(1) + "-x64" + (portable ? ".zip" : ".exe");
        const auto url = downloadRoot + tag + "/" + filename;
        // Keep the newest eligible release even if its asset is still uploading.
        // The caller can then report that download metadata is unavailable.
        ReleaseUpdate package{tag.substr(1), url, {}, 0};
        const auto assets = release.find("assets");
        if (assets != release.end() && assets->is_array()) {
            for (const auto& asset : *assets) {
                if (!asset.is_object() || asset.value("name", std::string{}) != filename ||
                    asset.value("browser_download_url", std::string{}) != url || asset.value("state", std::string{}) != "uploaded")
                    continue;
                if (asset.contains("digest") && asset["digest"].is_string()) {
                    const auto digest = asset["digest"].get<std::string>();
                    if (digest.size() == 71 && digest.starts_with("sha256:") &&
                        digest.find_first_not_of("0123456789abcdef", 7) == std::string::npos)
                        package.sha256 = digest.substr(7);
                }
                if (asset.contains("size") && asset["size"].is_number_unsigned()) package.size = asset["size"].get<std::uint64_t>();
                break;
            }
        }
        candidates.push_back({*version, published, beta, std::move(package)});
    }
    for (const auto& candidate : candidates) {
        if (!candidate.beta && (!stable || candidate.version > stable->version)) stable = &candidate;
    }
    // Older abandoned preview tracks must not override a newer stable release.
    const Candidate* best = stable;
    if (channel == UpdateChannel::Beta) {
        for (const auto& candidate : candidates) {
            if (candidate.beta && (!stable || candidate.published >= stable->published) &&
                (!best || candidate.version > best->version)) best = &candidate;
        }
    }
    if (!best || best->version <= *current) return std::nullopt;
    if (best->package.sha256.empty() || best->package.size == 0 || best->package.size > 1024ull * 1024 * 1024)
        throw std::runtime_error("Release download metadata is unavailable");
    return best->package;
}
