#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <nlohmann/json.hpp>

enum class UpdateChannel { Stable, Beta };

struct ReleaseUpdate {
    std::string version;
    std::string url;
    std::string sha256;
    std::uint64_t size;
};

inline constexpr char ReleaseFeedUrl[] = "https://api.github.com/repos/kmaustin32/Ezras-Stremio/releases?per_page=100";

std::optional<ReleaseUpdate> FindReleaseUpdate(const nlohmann::json& releases, std::string_view installed,
    UpdateChannel channel, bool portable);
