#include "library_store.h"
#include <algorithm>
#include <fstream>
#include <map>
#include <set>
#include <stdexcept>
#include <openssl/sha.h>
#include <windows.h>

using nlohmann::json;

namespace {
constexpr auto maxBytes = 8 * 1024 * 1024;

void ValidateLists(const json& lists)
{
    if (!lists.is_array()) throw std::runtime_error("Saved lists could not be read.");
    std::set<std::string> ids;
    for (const auto& list : lists) {
        const auto id = list.at("id").get<std::string>();
        const auto name = list.at("name").get<std::string>();
        const auto& items = list.at("items");
        if (id.empty() || id.find_first_not_of("abcdefghijklmnopqrstuvwxyz0123456789-") != std::string::npos ||
            name.find_first_not_of(" \t\r\n\f\v") == std::string::npos || !ids.insert(id).second || !items.is_array())
            throw std::runtime_error("Saved lists could not be read.");
        for (const auto& item : items)
            if (!item.is_string() || item.get_ref<const std::string&>().empty())
                throw std::runtime_error("Saved lists could not be read.");
    }
}

bool ValidLegacy(const json& legacy)
{
    try {
        if (!legacy.is_object() || !legacy.contains("version") || legacy["version"] != 1 ||
            !legacy.contains("lists")) return false;
        ValidateLists(legacy["lists"]);
        return true;
    } catch (const json::exception&) {
        return false;
    } catch (const std::runtime_error&) {
        return false;
    }
}

bool Category(const std::string& id) { return id == "anime" || id == "live-action"; }

void MergeLegacy(json& lists, const json& legacy)
{
    std::map<std::string, size_t> existing;
    std::set<std::string> classified;
    for (size_t i = 0; i < lists.size(); ++i) {
        const auto id = lists[i]["id"].get<std::string>();
        existing.emplace(id, i);
        if (Category(id))
            for (const auto& item : lists[i]["items"]) classified.insert(item.get<std::string>());
    }
    for (const auto& list : legacy) {
        const auto id = list["id"].get<std::string>();
        const auto [entry, inserted] = existing.try_emplace(id, lists.size());
        if (inserted) lists.push_back({{"id", id}, {"name", list["name"]}, {"items", json::array()}});
        auto& items = lists[entry->second]["items"];
        std::set<std::string> members;
        for (const auto& item : items) members.insert(item.get<std::string>());
        for (const auto& item : list["items"]) {
            const auto& value = item.get_ref<const std::string&>();
            if ((!Category(id) || !classified.contains(value)) && members.insert(value).second) items.push_back(item);
        }
    }
}

std::filesystem::path AccountPath(const std::filesystem::path& directory, const std::string& uid)
{
    unsigned char digest[SHA256_DIGEST_LENGTH];
    if (!SHA256(reinterpret_cast<const unsigned char*>(uid.data()), uid.size(), digest))
        throw std::runtime_error("Local Library storage is unavailable.");
    std::string name;
    for (const auto byte : digest) {
        constexpr char hex[] = "0123456789abcdef";
        name += hex[byte >> 4];
        name += hex[byte & 15];
    }
    return directory / (name + ".json");
}

void WriteRecord(const std::filesystem::path& path, const json& record)
{
    const auto bytes = record.dump();
    if (bytes.size() > maxBytes) throw std::runtime_error("Saved lists are too large.");
    std::filesystem::create_directories(path.parent_path());
    auto temporary = path;
    temporary += L".tmp";
    std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
    output.write(bytes.data(), bytes.size());
    output.close();
    if (!output || !MoveFileExW(temporary.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH))
        throw std::runtime_error("Could not save your lists.");
}
}

std::string_view LibraryStoreOrigin(std::wstring_view source)
{
    if (source.starts_with(L"https://stremio.zarg.me/")) return "primary";
    if (source.starts_with(L"https://zaarrg.github.io/stremio-web-shell-fixes/")) return "fallback";
    return {};
}

json HandleLibraryStoreRequest(const std::filesystem::path& directory, std::string_view origin, const json& request)
{
    json response = {{"requestId", request.value("requestId", std::string{})}};
    try {
        const auto uid = request.at("uid").get<std::string>();
        if (origin.empty() || uid.empty() || uid.size() > 256) throw std::runtime_error("Invalid Library account.");
        const auto path = AccountPath(directory, uid);
        json record = {{"version", 1}, {"revision", 0}, {"lists", json::array()}, {"migrated", json::array()}};
        if (std::filesystem::exists(path)) {
            if (std::filesystem::file_size(path) > maxBytes) throw std::runtime_error("Saved lists are too large.");
            std::ifstream input(path, std::ios::binary);
            input >> record;
            if (record.value("version", 0) != 1 || !record.at("migrated").is_array())
                throw std::runtime_error("Saved lists could not be read.");
            ValidateLists(record.at("lists"));
        }
        const auto action = request.at("action").get<std::string>();
        const auto revision = record.at("revision").get<int>();
        if (action == "load") {
            auto& migrated = record["migrated"];
            const json sourceOrigin = std::string(origin);
            if (request.contains("legacy") && !request["legacy"].is_null() &&
                std::find(migrated.begin(), migrated.end(), sourceOrigin) == migrated.end()) {
                const auto& raw = request["legacy"];
                const auto legacy = raw.is_string() ? json::parse(raw.get_ref<const std::string&>(), nullptr, false) : raw;
                if (ValidLegacy(legacy)) {
                    MergeLegacy(record["lists"], legacy["lists"]);
                    migrated.push_back(sourceOrigin);
                    record["revision"] = revision + 1;
                    WriteRecord(path, record);
                } else {
                    response["legacyUnreadable"] = true;
                }
            }
        } else if (action == "save") {
            if (request.at("revision").get<int>() != revision) response["conflict"] = true;
            else {
                ValidateLists(request.at("lists"));
                record["lists"] = request["lists"];
                record["revision"] = revision + 1;
                WriteRecord(path, record);
            }
        } else throw std::runtime_error("Invalid Library request.");
        record.erase("migrated");
        response["record"] = std::move(record);
    } catch (const json::exception&) {
        response["error"] = "Saved lists could not be read.";
    } catch (const std::filesystem::filesystem_error&) {
        response["error"] = "Local Library storage is unavailable.";
    } catch (const std::exception& error) {
        response["error"] = error.what();
    }
    return response;
}
