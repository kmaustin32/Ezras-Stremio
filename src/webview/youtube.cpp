#include "youtube.h"

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <string>
#include <string_view>
#include <utility>
#include <shobjidl.h>
#include <wil/com.h>
#include <wil/resource.h>
#include <wrl.h>
#include <nlohmann/json.hpp>

#include "../core/globals.h"
#include "../mpv/player.h"
#include "../ui/mainwindow.h"

namespace {
using Microsoft::WRL::Callback;
using ControllerHandler = ICoreWebView2CreateCoreWebView2ControllerCompletedHandler;
constexpr wchar_t home[] = L"https://www.youtube.com/";
constexpr wchar_t hostClass[] = L"EzrasStremioYouTubeTab";
constexpr wchar_t settingsClass[] = L"EzrasStremioYouTubeExtension";
enum { backToStremio = 1, goBack, installExtension, blurSettings };

struct YouTubeTab {
    HWND owner{}, host{}, settingsWindow{}, installButton{}, settingsButton{};
    wil::com_ptr<ICoreWebView2Environment10> environment;
    wil::com_ptr<ICoreWebView2Controller> controller, settingsController;
    wil::com_ptr<ICoreWebView2> page;
    wil::com_ptr<ICoreWebView2Profile7> profile;
    std::wstring extensionId;
    bool visible{}, fullscreen{}, settingsLoading{}, extensionBusy{};
} tab;

// The popup is a separate WebView. Its active-tab lookup must resolve to
// YouTube, while other tab queries retain their normal behavior.
constexpr wchar_t popupTabAdapter[] = LR"JS(
(() => {
    const tabs = globalThis.chrome?.tabs;
    if (!tabs?.query) return;
    const query = tabs.query.bind(tabs);
    tabs.query = function (options, callback) {
        if (!options?.active || !options?.currentWindow) {
            return callback ? query(options, callback) : query(options);
        }
        const result = query({}).then(items => items.filter(item => {
            try {
                const url = new URL(item.url);
                return url.protocol === 'https:' && url.hostname === 'www.youtube.com';
            } catch { return false; }
        }).slice(0, 1));
        if (!callback) return result;
        result.then(callback, () => callback([]));
    };
})();
)JS";

bool IsYouTubeNavigation(std::wstring_view uri)
{
    for (const auto* prefix : {home, L"https://youtube.com/", L"https://m.youtube.com/",
             L"https://accounts.google.com/", L"https://consent.youtube.com/", L"https://consent.google.com/"}) {
        if (uri.starts_with(prefix)) return true;
    }
    return false;
}

bool IsExtensionId(const std::wstring& id)
{
    return id.size() == 32 && std::all_of(id.begin(), id.end(), [](wchar_t ch) {
        return ch >= L'a' && ch <= L'p';
    });
}

HRESULT CreateProfileController(HWND parent, ControllerHandler* handler)
{
    if (!tab.environment) return E_NOINTERFACE;
    wil::com_ptr<ICoreWebView2ControllerOptions> options;
    HRESULT hr = tab.environment->CreateCoreWebView2ControllerOptions(&options);
    if (FAILED(hr)) return hr;
    hr = options->put_ProfileName(L"EzrasYouTube");
    if (FAILED(hr)) return hr;
    return tab.environment->CreateCoreWebView2ControllerWithOptions(parent, options.get(), handler);
}

void Report(const wchar_t* message)
{
    if (tab.owner) MessageBoxW(tab.owner, message, L"YouTube", MB_OK | MB_ICONINFORMATION);
}

void UpdateExtensionButtons()
{
    EnableWindow(tab.installButton, tab.profile && !tab.extensionBusy && tab.extensionId.empty());
    EnableWindow(tab.settingsButton, !tab.extensionId.empty() && !tab.extensionBusy);
}

void CloseBlurSettings()
{
    if (tab.settingsController) tab.settingsController->Close();
    tab.settingsController = nullptr;
    if (tab.settingsWindow) DestroyWindow(tab.settingsWindow);
    tab.settingsWindow = nullptr;
    tab.settingsLoading = false;
}

LRESULT CALLBACK SettingsWindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_SIZE && tab.settingsController) {
        RECT bounds{};
        GetClientRect(window, &bounds);
        tab.settingsController->put_Bounds(bounds);
    } else if (message == WM_CLOSE) {
        CloseBlurSettings();
        FocusYouTubeTab();
        return 0;
    }
    return DefWindowProcW(window, message, wParam, lParam);
}

void OpenBlurSettings()
{
    if (tab.extensionId.empty() || !tab.visible) return;
    if (tab.settingsWindow) {
        if (!tab.settingsLoading) SetForegroundWindow(tab.settingsWindow);
        return;
    }
    RECT owner{};
    GetWindowRect(tab.owner, &owner);
    MONITORINFO monitor{sizeof(monitor)};
    if (GetMonitorInfoW(MonitorFromWindow(tab.owner, MONITOR_DEFAULTTONEAREST), &monitor))
        IntersectRect(&owner, &owner, &monitor.rcWork);
    const int width = (std::min)(MulDiv(470, GetDpiForWindow(tab.owner), 96), static_cast<int>(owner.right - owner.left));
    const int height = (std::min)(MulDiv(720, GetDpiForWindow(tab.owner), 96), static_cast<int>(owner.bottom - owner.top));
    tab.settingsWindow = CreateWindowExW(WS_EX_TOOLWINDOW, settingsClass, L"Blur settings",
        WS_POPUP | WS_CAPTION | WS_SYSMENU | WS_THICKFRAME, owner.right - width, owner.top,
        width, height, tab.owner, nullptr, GetModuleHandleW(nullptr), nullptr);
    if (!tab.settingsWindow) return;
    tab.settingsLoading = true;
    const auto url = L"chrome-extension://" + tab.extensionId + L"/popup.html";
    const HRESULT started = CreateProfileController(tab.settingsWindow, Callback<ControllerHandler>(
        [window = tab.settingsWindow, url](HRESULT result, ICoreWebView2Controller* controller) -> HRESULT {
            if (window != tab.settingsWindow) {
                if (controller) controller->Close();
                return S_OK;
            }
            wil::com_ptr<ICoreWebView2> popup;
            if (FAILED(result) || !controller || FAILED(controller->get_CoreWebView2(&popup)) || !popup) {
                CloseBlurSettings();
                Report(L"Could not open the extension settings.");
                return S_OK;
            }
            tab.settingsController = controller;
            RECT bounds{};
            GetClientRect(window, &bounds);
            controller->put_Bounds(bounds);
            wil::com_ptr<ICoreWebView2Settings> settings;
            if (SUCCEEDED(popup->get_Settings(&settings))) settings->put_IsWebMessageEnabled(FALSE);
            EventRegistrationToken token{};
            popup->add_NavigationStarting(Callback<ICoreWebView2NavigationStartingEventHandler>(
                [url](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
                    wil::unique_cotaskmem_string uri;
                    if (FAILED(args->get_Uri(&uri)) || !uri || url != uri.get()) args->put_Cancel(TRUE);
                    return S_OK;
                }).Get(), &token);
            popup->add_NewWindowRequested(Callback<ICoreWebView2NewWindowRequestedEventHandler>(
                [](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
                    return args->put_Handled(TRUE);
                }).Get(), &token);
            popup->add_WindowCloseRequested(Callback<ICoreWebView2WindowCloseRequestedEventHandler>(
                [window](ICoreWebView2*, IUnknown*) -> HRESULT {
                    PostMessageW(window, WM_CLOSE, 0, 0);
                    return S_OK;
                }).Get(), &token);
            const HRESULT added = popup->AddScriptToExecuteOnDocumentCreated(popupTabAdapter,
                Callback<ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler>(
                    [window, popup, url](HRESULT scriptResult, LPCWSTR) -> HRESULT {
                        if (window != tab.settingsWindow) return S_OK;
                        if (FAILED(scriptResult) || FAILED(popup->Navigate(url.c_str()))) {
                            CloseBlurSettings();
                            Report(L"Could not load the extension controls.");
                            return S_OK;
                        }
                        tab.settingsLoading = false;
                        ShowWindow(window, SW_SHOW);
                        tab.settingsController->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
                        return S_OK;
                    }).Get());
            if (FAILED(added)) {
                CloseBlurSettings();
                Report(L"Could not load the extension controls.");
            }
            return S_OK;
        }).Get());
    if (FAILED(started)) {
        CloseBlurSettings();
        Report(L"Could not open the extension settings.");
    }
}

void FindInstalledExtension()
{
    tab.extensionBusy = true;
    UpdateExtensionButtons();
    const HRESULT started = tab.profile->GetBrowserExtensions(
        Callback<ICoreWebView2ProfileGetBrowserExtensionsCompletedHandler>(
            [](HRESULT result, ICoreWebView2BrowserExtensionList* extensions) -> HRESULT {
                if (!tab.host) return S_OK;
                UINT32 count = 0;
                if (SUCCEEDED(result) && extensions) extensions->get_Count(&count);
                for (UINT32 index = 0; index < count; ++index) {
                    wil::com_ptr<ICoreWebView2BrowserExtension> extension;
                    wil::unique_cotaskmem_string id;
                    BOOL enabled = FALSE;
                    if (SUCCEEDED(extensions->GetValueAtIndex(index, &extension)) && extension &&
                        SUCCEEDED(extension->get_IsEnabled(&enabled)) && enabled &&
                        SUCCEEDED(extension->get_Id(&id)) && id && IsExtensionId(id.get())) {
                        tab.extensionId = id.get();
                        break;
                    }
                }
                tab.extensionBusy = false;
                UpdateExtensionButtons();
                return S_OK;
            }).Get());
    if (FAILED(started)) {
        tab.extensionBusy = false;
        UpdateExtensionButtons();
    }
}

void InstallBlurExtension()
{
    if (!tab.profile || tab.extensionBusy || !tab.extensionId.empty()) return;
    wil::com_ptr<IFileOpenDialog> picker;
    if (FAILED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&picker)))) return;
    picker->SetOptions(FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);
    picker->SetTitle(L"Select the unpacked UltraWideoVideo folder");
    if (FAILED(picker->Show(tab.owner))) return;
    wil::com_ptr<IShellItem> folder;
    wil::unique_cotaskmem_string path;
    if (FAILED(picker->GetResult(&folder)) || FAILED(folder->GetDisplayName(SIGDN_FILESYSPATH, &path)) || !path) return;
    const std::filesystem::path root(path.get());
    std::ifstream manifest(root / L"manifest.json");
    const auto data = manifest ? nlohmann::json::parse(manifest, nullptr, false) : nlohmann::json{};
    std::error_code fileError;
    if (!data.is_object() || !data.contains("action") || !data["action"].is_object() ||
        !data["action"].contains("default_popup") || data["action"]["default_popup"] != "popup.html" ||
        !std::filesystem::is_regular_file(root / L"popup.html", fileError)) {
        Report(L"Unzip the extension and select the folder that contains its manifest.json and popup.html.");
        return;
    }

    tab.extensionBusy = true;
    UpdateExtensionButtons();
    const HRESULT started = tab.profile->AddBrowserExtension(path.get(),
        Callback<ICoreWebView2ProfileAddBrowserExtensionCompletedHandler>(
            [](HRESULT result, ICoreWebView2BrowserExtension* extension) -> HRESULT {
                if (!tab.host) return S_OK;
                wil::unique_cotaskmem_string id;
                tab.extensionBusy = false;
                if (SUCCEEDED(result) && extension && SUCCEEDED(extension->get_Id(&id)) && id &&
                    IsExtensionId(id.get())) {
                    tab.extensionId = id.get();
                    tab.page->Reload(); // Apply declared content scripts to the current YouTube page.
                } else if (tab.visible) {
                    Report(L"Edge WebView2 could not load this extension folder.");
                }
                UpdateExtensionButtons();
                return S_OK;
            }).Get());
    if (FAILED(started)) {
        tab.extensionBusy = false;
        UpdateExtensionButtons();
        Report(L"Edge WebView2 could not load this extension folder.");
    }
}

LRESULT CALLBACK TabWindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_COMMAND && HIWORD(wParam) == BN_CLICKED) {
        switch (LOWORD(wParam)) {
        case backToStremio: CloseYouTubeTab(); return 0;
        case goBack: if (tab.page) tab.page->GoBack(); return 0;
        case installExtension: InstallBlurExtension(); return 0;
        case blurSettings: OpenBlurSettings(); return 0;
        }
    }
    return DefWindowProcW(window, message, wParam, lParam);
}

bool RegisterWindowClass(const wchar_t* name, WNDPROC procedure, HBRUSH background)
{
    WNDCLASSW wc{};
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpfnWndProc = procedure;
    wc.lpszClassName = name;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.hbrBackground = background;
    return RegisterClassW(&wc) || GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
}

HRESULT SetupYouTubePage(HRESULT result, ICoreWebView2Controller* controller)
{
    if (!tab.host) {
        if (controller) controller->Close();
        return S_OK;
    }
    if (FAILED(result) || !controller || FAILED(controller->get_CoreWebView2(&tab.page)) || !tab.page) {
        CloseYouTubeTab();
        DestroyWindow(tab.host);
        tab.host = nullptr;
        Report(L"Could not start the YouTube tab in Edge WebView2.");
        return S_OK;
    }
    tab.controller = controller;
    wil::com_ptr<ICoreWebView2Settings> settings;
    if (SUCCEEDED(tab.page->get_Settings(&settings))) {
        settings->put_IsWebMessageEnabled(FALSE);
        settings->put_AreHostObjectsAllowed(FALSE);
    }
    if (auto core = tab.page.try_query<ICoreWebView2_13>()) {
        wil::com_ptr<ICoreWebView2Profile> profile;
        if (SUCCEEDED(core->get_Profile(&profile))) tab.profile = profile.try_query<ICoreWebView2Profile7>();
    }

    EventRegistrationToken token{};
    tab.page->add_NavigationStarting(Callback<ICoreWebView2NavigationStartingEventHandler>(
        [](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
            wil::unique_cotaskmem_string uri;
            if (FAILED(args->get_Uri(&uri)) || !uri || !IsYouTubeNavigation(uri.get()))
                args->put_Cancel(TRUE);
            return S_OK;
        }).Get(), &token);
    tab.page->add_NewWindowRequested(Callback<ICoreWebView2NewWindowRequestedEventHandler>(
        [](ICoreWebView2* sender, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
            args->put_Handled(TRUE);
            wil::unique_cotaskmem_string uri;
            BOOL userInitiated = FALSE;
            if (SUCCEEDED(args->get_Uri(&uri)) && uri && SUCCEEDED(args->get_IsUserInitiated(&userInitiated)) &&
                userInitiated && IsYouTubeNavigation(uri.get())) sender->Navigate(uri.get());
            return S_OK;
        }).Get(), &token);
    tab.page->add_ContainsFullScreenElementChanged(Callback<ICoreWebView2ContainsFullScreenElementChangedEventHandler>(
        [](ICoreWebView2* sender, IUnknown*) -> HRESULT {
            BOOL fullscreen = FALSE;
            if (!tab.visible || FAILED(sender->get_ContainsFullScreenElement(&fullscreen))) return S_OK;
            tab.fullscreen = fullscreen != FALSE;
            ToggleFullScreen(tab.owner, tab.fullscreen);
            ResizeYouTubeTab();
            return S_OK;
        }).Get(), &token);
    controller->add_AcceleratorKeyPressed(Callback<ICoreWebView2AcceleratorKeyPressedEventHandler>(
        [](ICoreWebView2Controller*, ICoreWebView2AcceleratorKeyPressedEventArgs* args) -> HRESULT {
            COREWEBVIEW2_KEY_EVENT_KIND kind{};
            UINT key{};
            if (SUCCEEDED(args->get_KeyEventKind(&kind)) && SUCCEEDED(args->get_VirtualKey(&key)) &&
                (kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN || kind == COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN) &&
                key == 'V' && (GetKeyState(VK_MENU) & 0x8000) && (GetKeyState(VK_SHIFT) & 0x8000) &&
                !tab.extensionId.empty()) {
                args->put_Handled(TRUE);
                PostMessageW(tab.host, WM_COMMAND, MAKEWPARAM(blurSettings, BN_CLICKED), 0);
            }
            return S_OK;
        }).Get(), &token);
    ResizeYouTubeTab();
    controller->put_IsVisible(tab.visible);
    tab.page->Navigate(home);
    if (tab.profile) FindInstalledExtension();
    FocusYouTubeTab();
    return S_OK;
}
}

void SetYouTubeEnvironment(HWND owner, ICoreWebView2Environment* environment)
{
    tab.owner = owner;
    wil::com_ptr<ICoreWebView2Environment> base = environment;
    tab.environment = base.try_query<ICoreWebView2Environment10>();
}

void OpenYouTubeTab()
{
    if (!tab.environment || !tab.owner ||
        !RegisterWindowClass(hostClass, TabWindowProc, GetSysColorBrush(COLOR_BTNFACE)) ||
        !RegisterWindowClass(settingsClass, SettingsWindowProc, GetSysColorBrush(COLOR_WINDOW))) {
        Report(L"The YouTube tab requires a current Edge WebView2 runtime.");
        return;
    }
    if (tab.host) {
        tab.visible = true;
        if (g_mpv) pauseMPV(true);
        g_webviewController->put_IsVisible(FALSE);
        ShowWindow(tab.host, SW_SHOW);
        if (tab.controller) tab.controller->put_IsVisible(TRUE);
        ResizeYouTubeTab();
        FocusYouTubeTab();
        return;
    }

    const auto instance = GetModuleHandleW(nullptr);
    tab.host = CreateWindowExW(0, hostClass, L"YouTube", WS_CHILD | WS_CLIPCHILDREN,
        0, 0, 0, 0, tab.owner, nullptr, instance, nullptr);
    if (!tab.host) return;
    const auto button = [&](int id, const wchar_t* text) {
        HWND control = CreateWindowExW(0, L"BUTTON", text, WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_PUSHBUTTON,
            0, 0, 0, 0, tab.host, reinterpret_cast<HMENU>(static_cast<INT_PTR>(id)), instance, nullptr);
        SendMessageW(control, WM_SETFONT, reinterpret_cast<WPARAM>(GetStockObject(DEFAULT_GUI_FONT)), TRUE);
        return control;
    };
    button(backToStremio, L"Stremio");
    button(goBack, L"Back");
    tab.installButton = button(installExtension, L"Install blur extension");
    tab.settingsButton = button(blurSettings, L"Blur settings");
    UpdateExtensionButtons();
    tab.visible = true;
    if (g_mpv) pauseMPV(true);
    g_webviewController->put_IsVisible(FALSE);
    ShowWindow(tab.host, SW_SHOW);
    ResizeYouTubeTab();
    const HRESULT started = CreateProfileController(tab.host, Callback<ControllerHandler>(SetupYouTubePage).Get());
    if (FAILED(started)) SetupYouTubePage(started, nullptr);
}

bool FocusYouTubeTab()
{
    if (!tab.visible) return false;
    if (tab.controller) tab.controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
    return true;
}

void ResizeYouTubeTab()
{
    if (!tab.host || !tab.owner) return;
    RECT bounds{};
    GetClientRect(tab.owner, &bounds);
    SetWindowPos(tab.host, HWND_TOP, 0, 0, bounds.right, bounds.bottom, SWP_NOACTIVATE);
    const auto scale = [](int px) { return MulDiv(px, GetDpiForWindow(tab.owner), 96); };
    const int bar = tab.fullscreen ? 0 : scale(42);
    int left = scale(8);
    for (const auto& [id, width] : {std::pair{backToStremio, 80}, std::pair{goBack, 64},
             std::pair{installExtension, 150}, std::pair{blurSettings, 112}}) {
        const auto control = GetDlgItem(tab.host, id);
        ShowWindow(control, bar ? SW_SHOWNA : SW_HIDE);
        MoveWindow(control, left, scale(6), scale(width), scale(30), TRUE);
        left += scale(width + 8);
    }
    bounds.top = (std::min)(static_cast<LONG>(bar), bounds.bottom);
    if (tab.controller) tab.controller->put_Bounds(bounds);
}

void CloseYouTubeTab()
{
    if (!tab.visible) return;
    tab.visible = false;
    CloseBlurSettings();
    if (tab.page) tab.page->ExecuteScript(
        L"if (['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(location.hostname)) {"
        L"document.querySelectorAll('video').forEach(video => video.pause());"
        L"if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }", nullptr);
    if (tab.fullscreen) {
        tab.fullscreen = false;
        ToggleFullScreen(tab.owner, false);
    }
    if (tab.controller) tab.controller->put_IsVisible(FALSE);
    ShowWindow(tab.host, SW_HIDE);
    if (g_webviewController) {
        g_webviewController->put_IsVisible(TRUE);
        g_webviewController->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
    }
}

void ShutdownYouTubeTab()
{
    CloseBlurSettings();
    if (tab.controller) tab.controller->Close();
    tab = {};
}
