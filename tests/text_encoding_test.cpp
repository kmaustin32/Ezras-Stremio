#include "../src/utils/helpers.h"
#include <nlohmann/json.hpp>
#include <iostream>
#include <stdexcept>

int main()
{
    try {
        // Explicit escapes keep the test independent of the compiler code page.
        const std::wstring title = L"\u72ac\u591c\u53c9 \u05e9\u05dc\u05d5\u05dd \U0001f3ac";
        const std::string utf8 = WStringToUtf8(title);
        if (Utf8ToWstring(utf8) != title || utf8.empty()) throw std::runtime_error("Unicode conversion lost text");
        const nlohmann::json message = {{"type", 1}, {"args", {"mpv-prop-change", {{"name", "track-list"}, {"title", utf8}}}}};
        const auto encoded = SerializeWebMessage(message);
        if (encoded.find(title) == std::wstring::npos || nlohmann::json::parse(WStringToUtf8(encoded)) != message)
            throw std::runtime_error("Native JSON transport corrupted non-Latin titles");
        const auto uri = std::string("https://example.invalid/") + utf8 + "?q=" + utf8;
        if (WStringToUtf8(Utf8ToWstring(uri)) != uri) throw std::runtime_error("Unicode URL lost characters");
        if (!Utf8ToWstring("").empty() || !WStringToUtf8(L"").empty()) throw std::runtime_error("Empty conversion changed");
        for (const auto& launch : {std::wstring(L"C:\\media\\") + title + L".torrent", std::wstring(L"magnet:?xt=urn:btih:example"), std::wstring(L"stremio://detail/series/example")}) {
            for (const size_t terminator : {size_t(0), size_t(1)}) {
                const auto decoded = DecodeNativeLaunchText(launch.c_str(), (launch.size() + terminator) * sizeof(wchar_t));
                if (!decoded || *decoded != launch) throw std::runtime_error("Native launch handoff retained a terminator or lost text");
            }
        }
        const wchar_t embedded[] = {L'a', L'\0', L'b'};
        if (DecodeNativeLaunchText(nullptr, 2) || DecodeNativeLaunchText(L"", 0) ||
            DecodeNativeLaunchText(L"abc", 3) || DecodeNativeLaunchText(embedded, sizeof(embedded)))
            throw std::runtime_error("Malformed native launch packet was accepted");
        std::cout << "PASS: native JSON transport and URL encoding preserve Japanese, Hebrew and emoji\n";
        return 0;
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
