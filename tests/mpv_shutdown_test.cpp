#include "core/globals.h"
#include "mpv/player.h"
#include <chrono>
#include <iostream>

mpv_handle* g_mpv = nullptr;
int g_currentVolume = 100;
bool g_initialSet = false;
std::set<std::string> g_observedProps;
wil::com_ptr<ICoreWebView2_21> g_webview;

std::wstring GetExeDirectory() { return {}; }
void AppendToCrashLog(const std::string& message) { std::cerr << message << '\n'; }
void SendToJS(const std::string&, const nlohmann::json&) {}
void NotifyDisplayModeState(bool) {}

int main()
{
    g_mpv = mpv_create();
    if (!g_mpv || mpv_set_option_string(g_mpv, "config", "no") < 0 || mpv_initialize(g_mpv) < 0) {
        CleanupMPV();
        return 1;
    }
    HandleMpvSetProp({"speed", "1.25"});
    mpv_wait_async_requests(g_mpv);
    double speed = 0;
    if (mpv_get_property(g_mpv, "speed", MPV_FORMAT_DOUBLE, &speed) < 0 || speed != 1.25) {
        CleanupMPV();
        return 1;
    }
    HandleMpvCommand({"quit"});
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
    while (g_mpv && std::chrono::steady_clock::now() < deadline) {
        HandleMpvEvents();
        Sleep(10);
    }
    if (g_mpv) {
        CleanupMPV();
        std::cerr << "The production event loop did not handle mpv shutdown.\n";
        return 1;
    }
    HandleMpvEvents();
    HandleMpvSetProp({"pause", "true"});
    HandleMpvCommand({"stop"});
    return 0;
}
