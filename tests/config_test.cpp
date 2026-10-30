#include "../src/core/globals.h"
#include "../src/utils/config.h"
#include <iostream>
#include <stdexcept>

namespace {
std::filesystem::path testDirectory;
void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
}

// Redirect the real settings loader/saver to an isolated test configuration.
std::wstring GetExeDirectory() { return testDirectory.wstring(); }
std::string WStringToUtf8(const std::wstring& text) {
    const int size = WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0, nullptr, nullptr);
    std::string result(size, '\0');
    WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), result.data(), size, nullptr, nullptr);
    return result;
}

int main() {
    testDirectory = std::filesystem::temp_directory_path() /
        ("stremio-theme-config-test-" + std::to_string(GetCurrentProcessId()));
    try {
        require(g_useDarkTheme, "Native startup must default to Dark Mode");
        std::filesystem::create_directory(testDirectory);
        const auto ini = (testDirectory / "portable_config" / "stremio-settings.ini").wstring();
        LoadSettings();
        require(g_useDarkTheme, "A missing theme preference must default to Dark Mode");
        WritePrivateProfileStringW(L"General", L"UseDarkTheme", L"0", ini.c_str());
        WritePrivateProfileStringW(L"General", L"UnrelatedPreference", L"73", ini.c_str());
        LoadSettings();
        require(!g_useDarkTheme, "An explicit normal-mode preference must be respected");
        SaveSettings();
        g_useDarkTheme = true;
        LoadSettings();
        require(!g_useDarkTheme, "Normal mode must survive save and reload");
        g_useDarkTheme = true;
        SaveSettings();
        g_useDarkTheme = false;
        LoadSettings();
        require(g_useDarkTheme, "Dark Mode must survive save and reload");
        require(GetPrivateProfileIntW(L"General", L"UnrelatedPreference", 0, ini.c_str()) == 73,
                "Saving theme must preserve unrelated preferences");
        std::filesystem::remove_all(testDirectory);
        std::cout << "Theme startup/default, saved choices, reload and unrelated preferences passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        std::filesystem::remove_all(testDirectory);
        return 1;
    }
}
