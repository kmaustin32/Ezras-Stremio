#include "helpers.h"
#include <nlohmann/json.hpp>

std::string WStringToUtf8(const std::wstring &wstr)
{
    if (wstr.empty()) {
        return {};
    }
    int neededSize = WideCharToMultiByte(CP_UTF8, 0, wstr.data(), (int)wstr.size(), nullptr, 0, nullptr, nullptr);
    if (neededSize <= 0) {
        return {};
    }
    std::string result(neededSize, '\0');
    WideCharToMultiByte(CP_UTF8, 0, wstr.data(), (int)wstr.size(), &result[0], neededSize, nullptr, nullptr);
    // remove trailing null
    while(!result.empty() && result.back()=='\0') {
        result.pop_back();
    }
    return result;
}

std::wstring Utf8ToWstring(const std::string& utf8Str)
{
    if (utf8Str.empty()) {
        return std::wstring();
    }
    int size_needed = MultiByteToWideChar(CP_UTF8, 0, utf8Str.data(), (int)utf8Str.size(), NULL, 0);
    if (size_needed == 0) {
        return std::wstring();
    }
    std::wstring wstr(size_needed, 0);
    MultiByteToWideChar(CP_UTF8, 0, utf8Str.data(), (int)utf8Str.size(), &wstr[0], size_needed);
    return wstr;
}

std::wstring SerializeWebMessage(const nlohmann::json& message)
{
    return Utf8ToWstring(message.dump());
}

std::optional<std::wstring> DecodeNativeLaunchText(const void* data, size_t byteCount)
{
    if (!data || byteCount == 0 || byteCount % sizeof(wchar_t)) return std::nullopt;
    std::wstring text(static_cast<const wchar_t*>(data), byteCount / sizeof(wchar_t));
    // COPYDATA senders may include the terminator or send just the characters.
    // Never retain it in the extension/URI, or accept an embedded null payload.
    if (!text.empty() && text.back() == L'\0') text.pop_back();
    if (text.empty() || text.find(L'\0') != std::wstring::npos) return std::nullopt;
    return text;
}
