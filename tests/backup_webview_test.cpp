#include "ForkWebAssets.h"
#include <WebView2.h>
#include <Shlwapi.h>
#include <wil/com.h>
#include <wrl.h>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>

// A fresh, isolated WebView2 profile and synthetic library; never opens the
// installed application, accesses an account, or changes user configuration.
namespace {
wil::com_ptr<ICoreWebView2> webview;
wil::com_ptr<ICoreWebView2Controller> controller;
wil::com_ptr<ICoreWebView2DownloadOperation> download;
std::filesystem::path output;

void Fail(const char* text) { std::cerr << text << '\n'; PostQuitMessage(1); }

LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM wp, LPARAM lp)
{
    if (message == WM_TIMER) { Fail("Embedded backup download timed out"); return 0; }
    return DefWindowProcW(window, message, wp, lp);
}
}

int main()
{
    if (FAILED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED))) return 1;
    wchar_t executable[MAX_PATH]; GetModuleFileNameW(nullptr, executable, MAX_PATH);
    const auto profile = std::filesystem::path(executable).parent_path() /
        (L"backup-webview-profile-" + std::to_wstring(GetCurrentProcessId()));
    std::filesystem::create_directories(profile);
    output = profile / L"backup.zip";
    WNDCLASSW wc{}; wc.lpfnWndProc = WindowProc; wc.hInstance = GetModuleHandleW(nullptr); wc.lpszClassName = L"ForkBackupTest";
    RegisterClassW(&wc);
    const auto window = CreateWindowW(wc.lpszClassName, L"Backup integration test", WS_POPUP,
        -32000, -32000, 1280, 720, nullptr, nullptr, wc.hInstance, nullptr);
    ShowWindow(window, SW_SHOWNOACTIVATE);
    SetTimer(window, 1, 60000, nullptr);
    const auto created = CreateCoreWebView2EnvironmentWithOptions(nullptr, profile.c_str(), nullptr,
        Microsoft::WRL::Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
        [window](HRESULT status, ICoreWebView2Environment* env) -> HRESULT {
            if (FAILED(status) || !env) { Fail("WebView2 runtime unavailable for export test"); return S_OK; }
            return env->CreateCoreWebView2Controller(window,
                Microsoft::WRL::Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                [window, environment = wil::com_ptr<ICoreWebView2Environment>(env)](HRESULT status, ICoreWebView2Controller* control) -> HRESULT {
                    if (FAILED(status) || !control) { Fail("Could not create export test controller"); return S_OK; }
                    controller = control; controller->get_CoreWebView2(&webview); controller->put_Bounds({0, 0, 1280, 720});
                    const std::wstring seed = LR"JS(
                        localStorage.setItem('profile',JSON.stringify({auth:null,addons:[{manifest:{id:'native-addon',name:'Native test add-on',version:'1.0'},transportUrl:'https://example.invalid/config/manifest.json'}]}));
                        const fixtureItem={_id:'native-title',name:'Native export title',type:'series',removed:false,temp:false,_mtime:'2026-10-26T12:00:00Z',state:{timeOffset:12000}};
                        localStorage.setItem('library',JSON.stringify({uid:null,items:{'native-title':fixtureItem}}));
                        localStorage.setItem('library_recent',JSON.stringify({uid:null,items:{}}));
                    )JS";
                    const auto script = seed + kForkPlayerScript;
                    webview->AddScriptToExecuteOnDocumentCreated(script.c_str(), nullptr);
                    EventRegistrationToken token;
                    webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL);
                    webview->add_WebResourceRequested(Microsoft::WRL::Callback<ICoreWebView2WebResourceRequestedEventHandler>(
                        [environment](ICoreWebView2*, ICoreWebView2WebResourceRequestedEventArgs* args) -> HRESULT {
                            const std::string html = "<!doctype html><html><meta charset='utf-8'><body><div class='settings-container-test'><div class='sections-container-test'></div></div></body></html>";
                            wil::com_ptr<IStream> stream;
                            stream.attach(SHCreateMemStream(reinterpret_cast<const BYTE*>(html.data()), static_cast<UINT>(html.size())));
                            wil::com_ptr<ICoreWebView2WebResourceResponse> response;
                            environment->CreateWebResourceResponse(stream.get(), 200, L"OK", L"Content-Type: text/html; charset=utf-8", &response);
                            args->put_Response(response.get()); return S_OK;
                        }).Get(), &token);
                    webview->add_NavigationStarting(Microsoft::WRL::Callback<ICoreWebView2NavigationStartingEventHandler>(
                        [](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
                            wil::unique_cotaskmem_string uri; args->get_Uri(&uri);
                            // Match the shell's URL allowlist, including blob downloads.
                            if (!uri || std::wstring(uri.get()).find(L"stremio.zarg.me/") == std::wstring::npos) args->put_Cancel(TRUE);
                            return S_OK;
                        }).Get(), &token);
                    const auto downloads = webview.try_query<ICoreWebView2_4>();
                    if (!downloads) { Fail("WebView2 download API unavailable"); return S_OK; }
                    downloads->add_DownloadStarting(Microsoft::WRL::Callback<ICoreWebView2DownloadStartingEventHandler>(
                        [](ICoreWebView2*, ICoreWebView2DownloadStartingEventArgs* args) -> HRESULT {
                            args->put_ResultFilePath(output.c_str()); args->put_Handled(TRUE); args->get_DownloadOperation(&download);
                            EventRegistrationToken changed;
                            download->add_StateChanged(Microsoft::WRL::Callback<ICoreWebView2StateChangedEventHandler>(
                                [](ICoreWebView2DownloadOperation* operation, IUnknown*) -> HRESULT {
                                    COREWEBVIEW2_DOWNLOAD_STATE state; operation->get_State(&state);
                                    if (state == COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED) Fail("Embedded ZIP download interrupted");
                                    if (state == COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED) {
                                        std::ifstream file(output, std::ios::binary);
                                        const std::string bytes((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
                                        if (!bytes.starts_with("PK\x03\x04") || bytes.find("Library.html") == std::string::npos ||
                                            bytes.find("Backup.json") == std::string::npos || bytes.find("Native export title") == std::string::npos ||
                                            bytes.find("Native test add-on") == std::string::npos) Fail("Downloaded ZIP is missing backup content");
                                        else { std::cout << "PASS: compiled embedded backup downloads through actual WebView2\n"; PostQuitMessage(0); }
                                    }
                                    return S_OK;
                                }).Get(), &changed);
                            return S_OK;
                        }).Get(), &token);
                    webview->add_NavigationCompleted(Microsoft::WRL::Callback<ICoreWebView2NavigationCompletedEventHandler>(
                        [](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
                            BOOL success; args->get_IsSuccess(&success);
                            if (!success) { Fail("Could not load backup fixture"); return S_OK; }
                            webview->ExecuteScript(L"document.querySelector('#stremio-fork-backup button').click()",
                                Microsoft::WRL::Callback<ICoreWebView2ExecuteScriptCompletedHandler>([](HRESULT status, LPCWSTR) -> HRESULT {
                                    if (FAILED(status)) Fail("Compiled backup button did not execute"); return S_OK;
                                }).Get());
                            return S_OK;
                        }).Get(), &token);
                    webview->Navigate(L"https://stremio.zarg.me/__fork-backup-test__");
                    return S_OK;
                }).Get());
        }).Get());
    if (FAILED(created)) Fail("Could not initialize export WebView2 environment");
    MSG message{};
    while (GetMessageW(&message, nullptr, 0, 0) > 0) { TranslateMessage(&message); DispatchMessageW(&message); }
    KillTimer(window, 1);
    download.reset();
    if (controller) controller->Close();
    webview.reset(); controller.reset(); DestroyWindow(window); CoUninitialize();
    return static_cast<int>(message.wParam);
}
