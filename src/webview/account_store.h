#pragma once

#include <filesystem>
#include <nlohmann/json.hpp>

nlohmann::json HandleAccountRequest(const std::filesystem::path& directory,
    bool localPage, const nlohmann::json& request);
