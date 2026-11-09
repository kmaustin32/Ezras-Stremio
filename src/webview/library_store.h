#pragma once

#include <filesystem>
#include <string_view>
#include <nlohmann/json.hpp>

// Empty for a page outside the two supported community interfaces.
std::string_view LibraryStoreOrigin(std::wstring_view source);
nlohmann::json HandleLibraryStoreRequest(const std::filesystem::path& directory,
    std::string_view origin, const nlohmann::json& request);
