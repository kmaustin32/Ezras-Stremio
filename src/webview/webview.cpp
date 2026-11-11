#include "webview.h"
#include <atomic>
#include <memory>
#include <string>
#include <thread>
#include <cmath>
#include <fstream>
#include <iostream>
#include <utility>
#include <Shlwapi.h>
#include <ShlObj.h>
#include <wrl.h>
#include "../core/globals.h"
#include "../utils/crashlog.h"
#include "../utils/helpers.h"
#include "../ui/mainwindow.h"
#include "../utils/extensions.h"
#include "../resource.h"
#include "ForkWebAssets.h"
#include "player_resources.h"
#include "library_store.h"
#include "account_store.h"

namespace {
struct AccountResponse { std::wstring source; nlohmann::json data; };
std::atomic<unsigned> accountRequests = 0;
std::wstring selectedProfileFolder;

void ReplyAccount(std::wstring_view source, const json& data)
{
    wil::unique_cotaskmem_string current;
    if (!g_webview || FAILED(g_webview->get_Source(&current)) || !current) return;
    const std::wstring_view active(current.get());
    if (source.substr(0, source.find(L'#')) != active.substr(0, active.find(L'#'))) return;
    const auto message = SerializeWebMessage({{"type", 1}, {"object", "transport"}, {"id", 3030},
        {"args", {"ezra-account-result", data}}});
    g_webview->PostWebMessageAsString(message.c_str());
}

void SetupLocalProfileResources(ICoreWebView2Environment* environment)
{
    g_webview->AddWebResourceRequestedFilter(L"https://ezras-stremio.invalid/*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL);
    EventRegistrationToken token;
    g_webview->add_WebResourceRequested(Microsoft::WRL::Callback<ICoreWebView2WebResourceRequestedEventHandler>(
        [env = wil::com_ptr<ICoreWebView2Environment>(environment)](ICoreWebView2*, ICoreWebView2WebResourceRequestedEventArgs* args) -> HRESULT {
            wil::com_ptr<ICoreWebView2WebResourceRequest> request;
            wil::unique_cotaskmem_string uri;
            if (FAILED(args->get_Request(&request)) || !request || FAILED(request->get_Uri(&uri)) || !uri) return S_OK;
            const std::wstring_view url(uri.get());
            const bool html = url == LocalProfileUrl;
            if (!html && url != L"https://ezras-stremio.invalid/profile.js") return S_OK;
            const auto body = WStringToUtf8(html ? kLocalProfileHtml : kLocalProfileJs);
            wil::com_ptr<IStream> stream;
            stream.attach(SHCreateMemStream(reinterpret_cast<const BYTE*>(body.data()), static_cast<UINT>(body.size())));
            wil::com_ptr<ICoreWebView2WebResourceResponse> response;
            if (stream && SUCCEEDED(env->CreateWebResourceResponse(stream.get(), 200, L"OK", html ?
                L"Content-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Security-Policy: frame-ancestors 'none'; base-uri 'none'; default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src https:; img-src https: data:; form-action 'none'" :
                L"Content-Type: application/javascript; charset=utf-8\r\nCache-Control: no-store", &response))) args->put_Response(response.get());
            return S_OK;
        }).Get(), &token);
}

void AccountMessage(const std::wstring& source, json request)
{
    const bool local = source == LocalProfileUrl;
    if (!local && LibraryStoreOrigin(source).empty() && !source.starts_with(L"https://web.stremio.com/")) return;
    if (!request.is_object() || !request.contains("id") || !request["id"].is_string() ||
        request["id"].get_ref<const std::string&>().size() != 36 || !request.contains("action") || !request["action"].is_string()) return;
    const auto id = request["id"];
    const auto action = request["action"].get<std::string>();
    if (action == "open" && !local) { OpenLocalProfile(); return; }
    if (local && action == "online") {
        if (!g_webuiUrls.empty() && g_webview) {
            std::vector<std::string> stop{"stop"}; HandleEvent("mpv-command", stop);
            if (g_webuiUrl.empty()) g_webuiUrl = g_webuiUrls.front();
            g_webview->Navigate(g_webuiUrl.c_str());
        }
        return;
    }
    if (local && action == "ready") {
        std::vector<std::string> args;
        HandleEvent("app-ready", args);
        for (const auto* name : {"time-pos", "duration", "pause"}) {
            args = {name}; HandleEvent("mpv-observe-prop", args);
        }
        return;
    }
    if (local && action == "player") {
        if (!request.contains("command") || !request["command"].is_string()) return;
        const auto command = request["command"].get<std::string>();
        if (command == "load" && request.contains("url") && request["url"].is_string()) {
            const auto url = request["url"].get<std::string>();
            if (url.size() > 8192 || (!url.starts_with("https://") && !url.starts_with("http://"))) return;
            const double resume = request.contains("resume") && request["resume"].is_number() ? request["resume"].get<double>() : 0;
            std::vector<std::string> args{"loadfile", url};
            if (resume > 0 && resume <= 1000000) args.insert(args.end(), {"replace", "-1", "start=+" + std::to_string(resume)});
            HandleEvent("mpv-command", args);
            args = {"pause", "no"}; HandleEvent("mpv-set-prop", args);
        } else if (command == "stop" || command == "pause") {
            std::vector<std::string> args = command == "stop" ? std::vector<std::string>{"stop"} : std::vector<std::string>{"cycle", "pause"};
            HandleEvent("mpv-command", args);
        } else if (command == "fullscreen") ToggleFullScreen(g_hWnd, !g_isFullscreen);
        return;
    }
    if (local && action == "pick") {
        std::wstring selected;
        const auto apartment = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
        if (SUCCEEDED(apartment)) {
            {
                wil::com_ptr<IFileOpenDialog> picker;
                if (SUCCEEDED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, __uuidof(IFileOpenDialog), picker.put_void()))) {
                    picker->SetOptions(FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);
                    picker->SetTitle(L"Choose a folder for encrypted profile sync");
                    wil::com_ptr<IShellItem> item;
                    wil::unique_cotaskmem_string path;
                    if (SUCCEEDED(picker->Show(g_hWnd)) && SUCCEEDED(picker->GetResult(&item)) &&
                        SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &path)) && path) selected = path.get();
                }
            }
            CoUninitialize();
        }
        if (selected.empty()) ReplyAccount(source, {{"id", id}, {"cancelled", true}});
        else {
            selectedProfileFolder = std::move(selected);
            ReplyAccount(source, {{"id", id}, {"folder", WStringToUtf8(selectedProfileFolder)}});
        }
        return;
    }
    if (local && action == "connect") request["folder"] = WStringToUtf8(selectedProfileFolder);
    wil::unique_cotaskmem_string dataDirectory;
    if (FAILED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &dataDirectory)) || !dataDirectory) {
        ReplyAccount(source, {{"id", id}, {"error", "Local profile storage is unavailable."}});
        return;
    }
    if (accountRequests.fetch_add(1) >= 6) {
        --accountRequests;
        ReplyAccount(source, {{"id", id}, {"error", "Profile sync is busy. Try again shortly."}});
        return;
    }
    const auto directory = std::filesystem::path(dataDirectory.get()) / L"EzrasStremio" / L"Account";
    std::thread([window = g_hWnd, source, directory, local, request = std::move(request), id] {
        auto result = std::make_unique<AccountResponse>(AccountResponse{source, HandleAccountRequest(directory, local, request)});
        result->data["id"] = id;
        --accountRequests;
        if (PostMessageW(window, WM_LOCAL_PROFILE_RESULT, 0, reinterpret_cast<LPARAM>(result.get()))) result.release();
    }).detach();
}
}

void CompleteLocalProfileRequest(LPARAM result)
{
    const std::unique_ptr<AccountResponse> response(reinterpret_cast<AccountResponse*>(result));
    if (response) ReplyAccount(response->source, response->data);
}

void OpenLocalProfile()
{
    if (!g_webview) return;
    std::vector<std::string> stop{"stop"}; HandleEvent("mpv-command", stop);
    g_webview->Navigate(LocalProfileUrl);
    ShowWindow(g_hWnd, SW_SHOW);
}

static std::wstring EmbeddedBrandImage(int resourceId)
{
    HRSRC resource = FindResource(g_hInst, MAKEINTRESOURCE(resourceId), RT_RCDATA);
    if (!resource) return L"";
    HGLOBAL data = LoadResource(g_hInst, resource);
    const char* bytes = static_cast<const char*>(LockResource(data));
    if (!bytes) return L"";
    return L"data:image/png;base64," + Utf8ToWstring(Base64Encode(
        std::string(bytes, SizeofResource(g_hInst, resource))));
}

static std::wstring WithBrandImages(const wchar_t* source)
{
    std::wstring script = source;
    for (const auto& [marker, id] : {std::pair{L"__FORK_SYMBOL__", IDR_BRAND_SYMBOL},
                                    std::pair{L"__FORK_WORDMARK__", IDR_BRAND_WORDMARK},
                                    std::pair{L"__FORK_ICON__", IDR_BRAND_ICON}}) {
        const size_t pos = script.find(marker);
        if (pos != std::wstring::npos) script.replace(pos, wcslen(marker), EmbeddedBrandImage(id));
    }
    return script;
}

static const wchar_t* EXEC_SHELL_SCRIPT = LR"JS_CODE(
try {
    console.log('Shell JS injected');
    if (window.self === window.top && !window.qt) {
      window.qt = {
        webChannelTransport: {
          send: window.chrome.webview.postMessage,
          onmessage: (ev) => {
            // Will be overwritten by ShellTransport
            console.log('Received message from WebView2:', ev);
          }
        }
      };

      window.chrome.webview.addEventListener('message', (ev) => {
        window.qt.webChannelTransport.onmessage(ev);
      });

      window.onload = () => {
        try {
          initShellComm();
        } catch (e) {
            const errorMessage = {
              type: 6,
              object: "transport",
              method: "handleInboundJSON",
              id: 888,
              args: [
                "app-error",
                [ "shellComm" ]
              ]
            };
          window.chrome.webview.postMessage(JSON.stringify(errorMessage));
        }
      };
    }
} catch(e) {
    console.error("Error exec initShellComm:", e);
    const errorMessage = {
      type: 6,
      object: "transport",
      method: "handleInboundJSON",
      id: 888,
      args: [
        "app-error",
        [ "shellComm" ]
      ]
    };
    if(window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {
        window.chrome.webview.postMessage(JSON.stringify(errorMessage));
    }
};
)JS_CODE";

static const wchar_t* INJECTED_KEYDOWN_SCRIPT = LR"JS(
(function() {
    window.addEventListener('keydown', function(event) {
        const editable = event.target && (event.target.isContentEditable ||
            /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName));
        if (event.ctrlKey && !event.altKey && !event.shiftKey &&
            event.code === 'KeyB' && !editable) {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (!event.repeat) window.chrome.webview.postMessage(JSON.stringify({
                type: 6, object: 'transport', method: 'handleInboundJSON', id: 1000,
                args: ['toggle-border-blur', []]
            }));
            return;
        }
        if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey &&
            event.code === 'KeyF' && !editable) {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (!event.repeat) window.chrome.webview.postMessage(JSON.stringify({
                type: 6, object: 'transport', method: 'handleInboundJSON', id: 1002,
                args: ['cycle-display-mode', []]
            }));
            return;
        }
        if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey &&
            event.code === 'KeyC' && !editable) {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (!event.repeat) window.chrome.webview.postMessage(JSON.stringify({
                type: 6, object: 'transport', method: 'handleInboundJSON', id: 1003,
                args: ['detect-encoded-bars', []]
            }));
            return;
        }
        if (event.code === 'F5') {
            event.preventDefault();
            const ctrlPressed = event.ctrlKey || event.metaKey;
            const msg = {
              type: 6,
              object: "transport",
              method: "handleInboundJSON",
              id: 999,
              args: [
                "refresh",
                [ ctrlPressed ? "all" : "no" ]
              ]
            };
            window.chrome.webview.postMessage(JSON.stringify(msg));
        }
    }, true);
})();
)JS";

static const wchar_t* INJECTED_BUTTON_SCRIPT = LR"JS(
(function() {
  // Create the button element
  var btn = document.createElement('button');
  btn.id = 'goBackStremioBtn';

  // Style the button:
  btn.style.position = 'fixed';
  btn.style.bottom = '15px';
  btn.style.right = '15px';
  btn.style.zIndex = '9999';
  btn.style.backgroundColor = '#121024'; // Purple
  btn.style.color = 'white';
  btn.style.border = 'none';
  btn.style.borderRadius = '30px';
  btn.style.padding = '12px 20px';
  btn.style.fontSize = '16px';
  btn.style.fontWeight = 'bold';
  btn.style.display = 'flex';
  btn.style.alignItems = 'center';
  btn.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
  btn.style.cursor = 'pointer';
  btn.style.transition = 'background-color 0.3s ease';

  // Hover effect:
  btn.addEventListener('mouseenter', function() {
    btn.style.backgroundColor = '#211e39'; // Gray
  });
  btn.addEventListener('mouseleave', function() {
    btn.style.backgroundColor = '#121024';
  });

  // Create an image element for the logo
  var img = document.createElement('img');
  img.src = '__FORK_SYMBOL__';
  img.alt = 'Logo';
  img.style.height = '24px';
  img.style.width = '24px';
  img.style.marginRight = '8px';

img.addEventListener('error', function() {
  img.style.display = 'none';
});

  // Create a text element
  var txt = document.createElement('span');
  txt.textContent = 'Back to Stremio';

  // Append the logo and text to the button
  btn.appendChild(img);
  btn.appendChild(txt);

  // On click go home
  btn.addEventListener('click', function() {
            const payload = {
              type: 6,
              object: "transport",
              method: "handleInboundJSON",
              id: 666,
              args: [
                "navigate",
                [ "home" ]
              ]
            };
          window.chrome.webview.postMessage(JSON.stringify(payload));
  });

  // Append the button to the document body
  document.body.appendChild(btn);
})();
)JS";

void WaitAndRefreshIfNeeded()
{
    std::thread([](){
        const int maxAttempts = 10;
        const int initialWaitTime = 5;
        const int maxWaitTime = 60;

        std::cout << "[WEBVIEW]: Web Page could not be reached, retrying..." << std::endl;

        for(int attempt=0; attempt<maxAttempts; ++attempt)
        {
            int waitTime = (int)(initialWaitTime * pow(1.25, attempt));
            if(waitTime>maxWaitTime) waitTime = maxWaitTime;

            std::this_thread::sleep_for(std::chrono::seconds(waitTime));

            if(g_isAppReady){
                std::cout << "[WEBVIEW]: Web Page ready!" << std::endl;
                g_waitStarted.store(false);
                return;
            }
            std::cout << "[WEBVIEW]: Refreshing attempt " << (attempt+1) << std::endl;
            refreshWeb(false);
        }
        if(!g_isAppReady) {
            AppendToCrashLog("[WEBVIEW]: Could not load after attempts");
            MessageBoxW(nullptr,
                L"Web page could not be loaded after multiple attempts. Make sure the Web UI is reachable.",
                L"WebView2 Page load fail",
                MB_ICONERROR | MB_OK
            );
            PostQuitMessage(1);
            exit(1);
        }
    }).detach();
}

void InitWebView2(HWND hWnd)
{
    std::cout << "[WEBVIEW]: Starting webview..." << std::endl;
    // Setup environment
    Microsoft::WRL::ComPtr<ICoreWebView2EnvironmentOptions> options = Microsoft::WRL::Make<CoreWebView2EnvironmentOptions>();
    if(options){
        options->put_AdditionalBrowserArguments(
            L"--autoplay-policy=no-user-gesture-required --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"
        );
        Microsoft::WRL::ComPtr<ICoreWebView2EnvironmentOptions6> options6;
        if(SUCCEEDED(options.As(&options6))) {
            options6->put_AreBrowserExtensionsEnabled(TRUE);
        }
        Microsoft::WRL::ComPtr<ICoreWebView2EnvironmentOptions5> options5;
        if(SUCCEEDED(options.As(&options5))) {
            options5->put_EnableTrackingPrevention(TRUE);
        }
    }

    // Check for local Edge runtime in "portable_config/EdgeWebView"
    std::wstring exeDir;
    {
        wchar_t buf[MAX_PATH];
        GetModuleFileNameW(nullptr, buf, MAX_PATH);
        exeDir = buf;
        size_t pos = exeDir.find_last_of(L"\\/");
        if(pos!=std::wstring::npos) exeDir.erase(pos);
    }
    std::wstring browserDir = exeDir + L"\\portable_config\\EdgeWebView";
    const wchar_t* browserExecutableFolder = nullptr;
    if(DirectoryExists(browserDir)) {
        browserExecutableFolder = browserDir.c_str();
        std::wcout << L"[WEBVIEW]: Using local WebView2: " << browserDir << std::endl;
    }

    HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(
        browserExecutableFolder, nullptr, options.Get(),
        Microsoft::WRL::Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
        [hWnd](HRESULT res, ICoreWebView2Environment* env)->HRESULT
        {
            if(!env) return E_FAIL;
            env->CreateCoreWebView2Controller(
                hWnd,
                Microsoft::WRL::Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                [hWnd, environment = wil::com_ptr<ICoreWebView2Environment>(env)](HRESULT result, ICoreWebView2Controller* rawController)->HRESULT
                {
                    if (FAILED(result) || !rawController) return E_FAIL;
                    std::cout << "[WEBVIEW]: Initializing WebView..." << std::endl;
                    wil::com_ptr<ICoreWebView2Controller> m_webviewController = rawController;
                    if (!m_webviewController) return E_FAIL;

                    g_webviewController = m_webviewController.try_query<ICoreWebView2Controller4>();
                    if (!g_webviewController) return E_FAIL;

                    wil::com_ptr<ICoreWebView2> coreWebView;
                    g_webviewController->get_CoreWebView2(&coreWebView);
                    g_webview = coreWebView.try_query<ICoreWebView2_21>();
                    if (!g_webview) return E_FAIL;

                    wil::com_ptr<ICoreWebView2Profile> webView2Profile;
                    g_webview->get_Profile(&webView2Profile);
                    g_webviewProfile = webView2Profile.try_query<ICoreWebView2Profile8>();
                    if (!g_webviewProfile) return E_FAIL;

                    wil::com_ptr<ICoreWebView2Settings> webView2Settings;
                    g_webview->get_Settings(&webView2Settings);
                    auto settings = webView2Settings.try_query<ICoreWebView2Settings8>();
                    if (!settings) return E_FAIL;

                    if(settings) {
                        #ifndef DEBUG_LOG
                        settings->put_AreDevToolsEnabled(FALSE);
                        #endif
                        settings->put_IsStatusBarEnabled(FALSE);
                        settings->put_AreBrowserAcceleratorKeysEnabled(FALSE);
                        std::wstring customUA = std::wstring(L"StremioShell/") + Utf8ToWstring(APP_VERSION);
                        settings->put_UserAgent(customUA.c_str());
                        if(!g_allowZoom) {
                            settings->put_IsZoomControlEnabled(FALSE);
                            settings->put_IsPinchZoomEnabled(FALSE);
                        }
                    }
                    // Set background color
                    COREWEBVIEW2_COLOR col={0,0,0,0};
                    g_webviewController->put_DefaultBackgroundColor(col);

                    RECT rc; GetClientRect(hWnd,&rc);
                    g_webviewController->put_Bounds(rc);

                    g_webview->AddScriptToExecuteOnDocumentCreated(EXEC_SHELL_SCRIPT,nullptr);
                    g_webview->AddScriptToExecuteOnDocumentCreated(INJECTED_KEYDOWN_SCRIPT,nullptr);
                    const std::wstring forkScript = std::wstring(L"window.__stremioForkDarkTheme=") +
                        (g_useDarkTheme ? L"true;" : L"false;") + WithBrandImages(kForkPlayerScript);
                    g_webview->AddScriptToExecuteOnDocumentCreated(forkScript.c_str(), nullptr);
                    SetupPlayerResources(environment.get(), g_webview.get(), hWnd);
                    SetupLocalProfileResources(environment.get());

                    SetupWebMods();

                    SetupExtensions();
                    SetupWebMessageHandler();

                    PreparePlayerScriptCache(g_webviewProfile.get(),
                        GetExeDirectory() + L"\\portable_config\\stremio-settings.ini", [] {
                    std::thread([](){
                        std::wcout << L"[WEBVIEW]: Checking web ui endpoints..." << std::endl;
                        std::wstring foundUrl = GetFirstReachableUrl();
                        std::wstring* pResult = new std::wstring(foundUrl);
                        g_webuiUrl = foundUrl;
                        PostMessage(g_hWnd, WM_REACHABILITY_DONE, (WPARAM)pResult, 0);
                        FetchAndParseWhitelist();
                    }).detach();
                    });
                    return S_OK;
                }).Get()
            );
            return S_OK;
        }).Get()
    );
    if(FAILED(hr)) {
        std::wstring msg = L"[WEBVIEW]: CreateCoreWebView2EnvironmentWithOptions failed => " + std::to_wstring(hr);
        AppendToCrashLog(msg);
        MessageBoxW(nullptr, msg.c_str(), L"WebView2 Initialization Error", MB_ICONERROR | MB_OK);
        PostQuitMessage(1);
        exit(1);
    }
}

static void SetupWebMessageHandler()
{
    if(!g_webview) return;

    EventRegistrationToken navToken;
    g_webview->add_NavigationCompleted(
        Microsoft::WRL::Callback<ICoreWebView2NavigationCompletedEventHandler>(
        [](ICoreWebView2* sender, ICoreWebView2NavigationCompletedEventArgs* args)->HRESULT
        {
            BOOL isSuccess;
            args->get_IsSuccess(&isSuccess);

            // Retrieve the final URL
            wil::unique_cotaskmem_string rawUri;
            sender->get_Source(&rawUri);
            std::wstring finalUri = rawUri ? rawUri.get() : L"";
            std::wcout << L"[WEBVIEW]: Navigation try to " << finalUri << std::endl;

            // Add back to stremio button if not on stremio
            if (finalUri != LocalProfileUrl && finalUri.find(g_webuiUrl) == std::wstring::npos) {
                const std::wstring backScript = WithBrandImages(INJECTED_BUTTON_SCRIPT);
                sender->ExecuteScript(backScript.c_str(), nullptr);
            }

            if(isSuccess) {
                std::cout<<"[WEBVIEW]: Navigation Complete - Success\n";
                sender->ExecuteScript(EXEC_SHELL_SCRIPT, nullptr);
                // Flush the script queue.
                if (!g_scriptQueue.empty()) {
                    for (const auto &script : g_scriptQueue) {
                        sender->ExecuteScript(script.c_str(), nullptr);
                    }
                    g_scriptQueue.clear();
                }
            } else {
                std::cout<<"[WEBVIEW]: Navigation failed\n";
                if (finalUri != LocalProfileUrl && (finalUri == g_webuiUrl || !LibraryStoreOrigin(finalUri).empty())) {
                    OpenLocalProfile();
                    return S_OK;
                }
                if(g_hSplash && !g_waitStarted.exchange(true)) {
                    WaitAndRefreshIfNeeded();
                }
                HandleExtensions(finalUri);
            }
            return S_OK;
        }).Get(),
        &navToken
    );

    EventRegistrationToken contentToken;
    g_webview->add_ContentLoading(
        Microsoft::WRL::Callback<ICoreWebView2ContentLoadingEventHandler>(
            [](ICoreWebView2* sender, ICoreWebView2ContentLoadingEventArgs* args) -> HRESULT {
                std::cout<<"[WEBVIEW]: Content loaded\n";
                sender->ExecuteScript(EXEC_SHELL_SCRIPT, nullptr);
                return S_OK;
            }
        ).Get(),
        &contentToken
    );

    EventRegistrationToken domToken;
    g_webview->add_DOMContentLoaded(
        Microsoft::WRL::Callback<ICoreWebView2DOMContentLoadedEventHandler>(
        [](ICoreWebView2* sender, ICoreWebView2DOMContentLoadedEventArgs* args)->HRESULT
        {
            sender->ExecuteScript(EXEC_SHELL_SCRIPT, nullptr);
            return S_OK;
        }).Get(),
        &domToken
    );

    EventRegistrationToken contextMenuToken;
    g_webview->add_ContextMenuRequested(
        Microsoft::WRL::Callback<ICoreWebView2ContextMenuRequestedEventHandler>(
            [](ICoreWebView2* sender, ICoreWebView2ContextMenuRequestedEventArgs* args) -> HRESULT {
                // Existing variable declarations
                wil::com_ptr<ICoreWebView2ContextMenuItemCollection> items;
                HRESULT hr = args->get_MenuItems(&items);
                if (FAILED(hr) || !items) return hr;

                #ifdef DEBUG_LOG
                return S_OK; //DEV TOOLS DEBUG ONLY
                #endif

                // Get current URL
                wil::unique_cotaskmem_string currentUri;
                sender->get_Source(&currentUri);
                std::wstring uri(currentUri.get());
                bool isExtensionUrl = uri.starts_with(L"chrome-extension://");

                // Get context menu target
                wil::com_ptr<ICoreWebView2ContextMenuTarget> target;
                hr = args->get_ContextMenuTarget(&target);
                BOOL isEditable = FALSE;
                if (SUCCEEDED(hr) && target) {
                    target->get_IsEditable(&isEditable);
                }

                UINT count = 0;
                items->get_Count(&count);

                if (!isEditable) {
                    // Allow only Back command (ID 33000) for extension URLs
                    std::set<INT32> allowedCommands = isExtensionUrl ?
                        std::set<INT32>{33000} :
                        std::set<INT32>{};

                    for (UINT i = 0; i < count;) {
                        wil::com_ptr<ICoreWebView2ContextMenuItem> item;
                        hr = items->GetValueAtIndex(i, &item);
                        if (FAILED(hr)) {
                            i++;
                            continue;
                        }

                        INT32 commandId;
                        item->get_CommandId(&commandId);

                        if (allowedCommands.find(commandId) == allowedCommands.end()) {
                            items->RemoveValueAtIndex(i);
                            items->get_Count(&count);
                        } else {
                            i++;
                        }
                    }
                    return S_OK;
                }

                // Define allowed command IDs for filtering
                std::set<INT32> allowedCommandIds = {
                    50151, // Cut
                    50150, // Copy
                    50152, // Paste
                    50157, // Paste as plain text
                    50156  // Select all
                };

                for (UINT i = 0; i < count;) {
                    wil::com_ptr<ICoreWebView2ContextMenuItem> item;
                    hr = items->GetValueAtIndex(i, &item);
                    if (FAILED(hr)) {
                        i++;
                        continue;
                    }

                    INT32 commandId;
                    item->get_CommandId(&commandId);

                    if (allowedCommandIds.find(commandId) == allowedCommandIds.end()) {
                        items->RemoveValueAtIndex(i);
                        items->get_Count(&count);
                    } else {
                        i++;
                    }
                }
                return S_OK;
            }).Get(),
        &contextMenuToken
    );

    EventRegistrationToken msgToken;
    g_webview->add_WebMessageReceived(
        Microsoft::WRL::Callback<ICoreWebView2WebMessageReceivedEventHandler>(
        [](ICoreWebView2* /*sender*/, ICoreWebView2WebMessageReceivedEventArgs* args)->HRESULT
        {
            wil::unique_cotaskmem_string msgRaw;
            args->TryGetWebMessageAsString(&msgRaw);
            if(!msgRaw) return S_OK;
            std::wstring wstr(msgRaw.get());
            std::string str = WStringToUtf8(wstr);
            constexpr std::string_view accountPrefix = "ezra-account:";
            if (str.starts_with(accountPrefix)) {
                wil::unique_cotaskmem_string source;
                if (str.size() <= 24 * 1024 * 1024 && SUCCEEDED(args->get_Source(&source)) && source)
                    AccountMessage(source.get(), json::parse(str.substr(accountPrefix.size()), nullptr, false));
                return S_OK;
            }
            constexpr std::string_view listPrefix = "fork-library-store:";
            if (str.starts_with(listPrefix)) {
                // This narrow bridge is only for the two Library front ends.
                // Generic shell events still follow the existing handler.
                wil::unique_cotaskmem_string source, localAppData;
                if (FAILED(args->get_Source(&source)) || !source || str.size() > 8 * 1024 * 1024) return S_OK;
                const auto origin = LibraryStoreOrigin(source.get());
                if (origin.empty()) return S_OK;
                const auto request = json::parse(str.substr(listPrefix.size()), nullptr, false);
                if (!request.is_object() || !request.contains("requestId") || !request["requestId"].is_string() ||
                    request["requestId"].get_ref<const std::string&>().size() != 36)
                    return S_OK;
                if (FAILED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &localAppData)) || !localAppData) {
                    SendToJS("fork-library-store-result", {{"requestId", request["requestId"]},
                        {"error", "Local Library storage is unavailable."}});
                    return S_OK;
                }
                SendToJS("fork-library-store-result", HandleLibraryStoreRequest(
                    std::filesystem::path(localAppData.get()) / L"EzrasStremio" / L"Library", origin, request));
                return S_OK;
            }
            HandleInboundJSON(str);

            return S_OK;
        }).Get(),
        &msgToken
    );

    EventRegistrationToken newWindowToken;
    g_webview->add_NewWindowRequested(
        Microsoft::WRL::Callback<ICoreWebView2NewWindowRequestedEventHandler>(
            [](ICoreWebView2* /*sender*/, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT
            {
                // Mark the event as handled to prevent default behavior
                args->put_Handled(TRUE);

                wil::unique_cotaskmem_string uri;
                if (SUCCEEDED(args->get_Uri(&uri)) && uri)
                {
                    std::wstring wuri(uri.get());
                    // Check if the URI is a local file (starts with "file://")
                    if (wuri.rfind(L"file://", 0) == 0)
                    {
                        std::wstring filePath = wuri.substr(8);
                        std::string utf8FilePath = WStringToUtf8(filePath);
                        std::string decodedFilePathUtf8 = decodeURIComponent(utf8FilePath);
                        std::string baseName = std::filesystem::path(decodedFilePathUtf8).filename().string();
                        if (isSubtitle(filePath)) {
                            std::vector<std::string> subaddArgs = {"sub-add",decodedFilePathUtf8, "select", baseName + " External", "Other Tracks"};
                            HandleEvent("mpv-command", subaddArgs);
                            json j;
                            j["type"] = "SubtitleDropped";
                            j["path"] = utf8FilePath;
                            SendToJS("SubtitleDropped", j);
                            return S_OK;
                        }
                        json j;
                        j["type"] = "FileDropped";
                        j["path"] = decodedFilePathUtf8;
                        SendToJS("FileDropped", j);
                        return S_OK;
                    }
                    if (URLContainsAny(wuri)) {
                        g_webview->Navigate(wuri.c_str());
                        return S_OK;
                    }
                    // For non-file URIs, open externally
                    ShellExecuteW(nullptr, L"open", uri.get(), nullptr, nullptr, SW_SHOWNORMAL);
                }
                return S_OK;
            }
        ).Get(),
        &newWindowToken
    );

    // For redirects like window.location.replace
    EventRegistrationToken navstartedToken;
    g_webview->add_NavigationStarting(
        Microsoft::WRL::Callback<ICoreWebView2NavigationStartingEventHandler>(
            [](ICoreWebView2* sender, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT
            {
                wil::unique_cotaskmem_string uri;
                args->get_Uri(&uri);
                std::wstring destination(uri.get());

                if (destination != LocalProfileUrl && !URLContainsAny(destination)) {
                    args->put_Cancel(TRUE);
                    ShellExecuteW(nullptr, L"open", uri.get(), nullptr, nullptr, SW_SHOWNORMAL);
                }
                return S_OK;
            }
        ).Get(),
        &navstartedToken
    );

    // FullScreen
    EventRegistrationToken cfeToken;
    g_webview->add_ContainsFullScreenElementChanged(
        Microsoft::WRL::Callback<ICoreWebView2ContainsFullScreenElementChangedEventHandler>(
            [](ICoreWebView2* sender, IUnknown* /*args*/) -> HRESULT
            {
                // FullScreen Toggle Handle
                BOOL inFull = FALSE;
                sender->get_ContainsFullScreenElement(&inFull);
                ToggleFullScreen(g_hWnd, inFull != FALSE);
                return S_OK;
            }
        ).Get(),
        &cfeToken
    );
}

static void SetupExtensions()
{
    if(!g_webview || !g_webviewProfile) return;

    // e.g. from "portable_config/extensions"
    std::wstring exeDir;
    {
        wchar_t buf[MAX_PATH];
        GetModuleFileNameW(nullptr, buf, MAX_PATH);
        exeDir = buf;
        size_t pos = exeDir.find_last_of(L"\\/");
        if(pos!=std::wstring::npos) exeDir.erase(pos);
    }
    std::wstring extensionsRoot = exeDir + L"\\portable_config\\extensions";

    try {
        for(const auto& entry : std::filesystem::directory_iterator(extensionsRoot)) {
            if(entry.is_directory()) {
                std::wstring folderName = entry.path().filename().wstring();
                HRESULT hr = g_webviewProfile->AddBrowserExtension(
                    entry.path().wstring().c_str(),
                    Microsoft::WRL::Callback<ICoreWebView2ProfileAddBrowserExtensionCompletedHandler>(
                    [folderName](HRESULT result, ICoreWebView2BrowserExtension* extension)->HRESULT
                    {
                        if (SUCCEEDED(result) && extension)
                        {
                            wil::unique_cotaskmem_string extId;
                            HRESULT hrId = extension->get_Id(&extId);
                            if (SUCCEEDED(hrId) && extId)
                            {
                                // Store extension ID in the global map
                                g_extensionMap[folderName] = extId.get();
                                std::wcout << L"[EXTENSIONS]: " << folderName
                                           << L" => " << extId.get() << std::endl;
                            }
                            std::wcout << L"[EXTENSIONS]: Added extension " << folderName << std::endl;
                        } else {
                            std::wstring err = L"[EXTENSIONS]: Failed to add extension => " + std::to_wstring(result);
                            AppendToCrashLog(err);
                        }
                        return S_OK;
                    }).Get()
                );
                if(FAILED(hr)) {
                    std::wstring err = L"[EXTENSIONS]: AddBrowserExtension failed => " + std::to_wstring(hr);
                    AppendToCrashLog(err);
                }
            }
        }
    } catch(...) {
        std::cout<<"[EXTENSIONS]: No extensions folder or iteration failed.\n";
    }
}

static void SetupWebMods()
{
    if (!g_webview) return;

    wchar_t buf[MAX_PATH];
    GetModuleFileNameW(nullptr, buf, MAX_PATH);
    std::wstring exeDir = buf;
    size_t pos = exeDir.find_last_of(L"\\/");
    if (pos != std::wstring::npos) exeDir.erase(pos);

    const std::filesystem::path root = std::filesystem::path(exeDir) / L"portable_config" / L"webmods";
    if (!std::filesystem::exists(root) || !std::filesystem::is_directory(root)) {
        std::wcout << L"[WEBMODS] Folder not found: " << root.wstring() << std::endl;
        return;
    }

    std::vector<std::filesystem::path> cssFiles, jsFiles;
    for (const auto& e : std::filesystem::recursive_directory_iterator(root)) {
        if (!e.is_regular_file()) continue;
        auto ext = e.path().extension().wstring();
        std::transform(ext.begin(), ext.end(), ext.begin(), ::towlower);
        if (ext == L".map" || ext == L".bak" || ext == L".tmp") continue;
        if (ext == L".css") cssFiles.push_back(e.path());
        else if (ext == L".js") jsFiles.push_back(e.path());
    }

    auto relStr = [&](const std::filesystem::path& p){
        try { return std::filesystem::relative(p, root).wstring(); }
        catch(...) { return p.wstring(); }
    };
    auto sorter = [&](const std::filesystem::path& a, const std::filesystem::path& b){
        auto ra = relStr(a), rb = relStr(b);
        return _wcsicmp(ra.c_str(), rb.c_str()) < 0;
    };
    std::sort(cssFiles.begin(), cssFiles.end(), sorter);
    std::sort(jsFiles.begin(), jsFiles.end(), sorter);

    auto makeId = [&](const std::filesystem::path& p){
        std::wstring id = relStr(p);
        for (auto& ch : id) if (!iswalnum(ch)) ch = L'_';
        return id;
    };

    for (const auto& p : cssFiles) {
        std::string content;
        if (!ReadFileUtf8(p.wstring(), content)) continue;
        const std::wstring id = makeId(p);
        const std::wstring script = MakeInjectCssScript(id, content);
        g_webview->AddScriptToExecuteOnDocumentCreated(script.c_str(), nullptr);
        std::wcout << L"[WEBMODS] CSS: " << relStr(p) << std::endl;
    }

    for (const auto& p : jsFiles) {
        std::string content;
        if (!ReadFileUtf8(p.wstring(), content)) continue;
        const std::wstring id = makeId(p);
        const std::wstring script = MakeInjectJsScript(id, content);
        g_webview->AddScriptToExecuteOnDocumentCreated(script.c_str(), nullptr);
        std::wcout << L"[WEBMODS] JS: " << relStr(p) << std::endl;
    }
}

void refreshWeb(const bool refreshAll) {
    if (g_webviewProfile && refreshAll)
    {
        HRESULT hr = g_webviewProfile->ClearBrowsingData(
            COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE |
            COREWEBVIEW2_BROWSING_DATA_KINDS_CACHE_STORAGE |
            COREWEBVIEW2_BROWSING_DATA_KINDS_SERVICE_WORKERS |
            COREWEBVIEW2_BROWSING_DATA_KINDS_FILE_SYSTEMS |
            COREWEBVIEW2_BROWSING_DATA_KINDS_WEB_SQL |
            COREWEBVIEW2_BROWSING_DATA_KINDS_INDEXED_DB,
            Microsoft::WRL::Callback<ICoreWebView2ClearBrowsingDataCompletedHandler>(
                [](HRESULT result) -> HRESULT {
                    std::cout << "[BROWSER]: Cleared browser cache successfully" << std::endl;
                    return S_OK;
                }
            ).Get()
        );
        if (FAILED(hr)) {
            std::cout << "[BROWSER]: Could not clear browser cache" << std::endl;
        }
    }
    if (g_webview) {
        g_webview->Reload();
    }
}
