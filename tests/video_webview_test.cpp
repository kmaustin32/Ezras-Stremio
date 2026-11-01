#include "ForkWebAssets.h"
#include <WebView2.h>
#include <Shlwapi.h>
#include <gdiplus.h>
#include <wil/com.h>
#include <wrl.h>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

// Verify the compiled web overlay's actual PNG alpha. Native mpv draws below
// WebView2, so any opaque page pixel in the video area hides playback.
namespace {
wil::com_ptr<ICoreWebView2> webview;
wil::com_ptr<ICoreWebView2Controller> controller;
int stage = 0;
bool capturing = false;
void Fail(const char* message) { std::cerr << message << " (stage " << stage << ")\n"; PostQuitMessage(1); }

void Advance(HWND window)
{
    ++stage;
    if (stage == 10) {
        std::cout << "PASS: compiled WebView2 overlay renders transparent native-video pixels across theme toggles, resize, replay and unload; gradient and controls remain visible outside playback\n";
        PostQuitMessage(0);
        return;
    }
    if (stage == 2 || stage == 3 || stage == 8 || stage == 9) {
        const bool dark = stage == 3 || stage == 9;
        webview->PostWebMessageAsJson(dark ? L"{\"args\":[\"theme-changed\",{\"dark\":true}]}" : L"{\"args\":[\"theme-changed\",{\"dark\":false}]}");
    } else if (stage == 4) {
        SetWindowPos(window, nullptr, -32000, -32000, 480, 270, SWP_NOACTIVATE | SWP_NOZORDER);
        controller->put_Bounds({0, 0, 480, 270});
    } else if (stage == 1 || stage == 6) {
        webview->ExecuteScript(L"for(let e=document.getElementById('surface');e;e=e.parentElement)e.style.background='transparent'", nullptr);
    } else if (stage == 5 || stage == 7) {
        webview->ExecuteScript(L"for(let e=document.getElementById('surface');e;e=e.parentElement)e.style.background=''", nullptr);
    }
    SetTimer(window, 2, 350, nullptr);
}

void Capture(HWND window)
{
    if (capturing) return;
    capturing = true;
    KillTimer(window, 2);
    wil::com_ptr<IStream> stream;
    if (FAILED(CreateStreamOnHGlobal(nullptr, TRUE, &stream))) { Fail("Cannot create preview stream"); return; }
    const auto result = webview->CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, stream.get(),
        Microsoft::WRL::Callback<ICoreWebView2CapturePreviewCompletedHandler>([window, stream](HRESULT status) -> HRESULT {
            capturing = false;
            if (FAILED(status)) { Fail("Cannot capture native web overlay"); return S_OK; }
            LARGE_INTEGER origin{}; stream->Seek(origin, STREAM_SEEK_SET, nullptr);
            STATSTG stat{}; stream->Stat(&stat, STATFLAG_NONAME);
            std::vector<char> bytes(static_cast<size_t>(stat.cbSize.QuadPart));
            ULONG read{};
            if (FAILED(stream->Read(bytes.data(), static_cast<ULONG>(bytes.size()), &read)) || read != bytes.size()) {
                Fail("Cannot read native overlay evidence"); return S_OK;
            }
            std::filesystem::create_directories(".build-cache/ui-test-evidence");
            std::ofstream evidence(".build-cache/ui-test-evidence/native-overlay-" + std::to_string(stage) + ".png", std::ios::binary);
            evidence.write(bytes.data(), bytes.size());
            stream->Seek(origin, STREAM_SEEK_SET, nullptr);
            Gdiplus::Bitmap image(stream.get());
            if (image.GetLastStatus() != Gdiplus::Ok) { Fail("Cannot decode native web overlay"); return S_OK; }
            Gdiplus::Color video, toolbar;
            image.GetPixel(image.GetWidth() - 2, image.GetHeight() - 2, &video);
            image.GetPixel(10, 10, &toolbar);
            const bool playing = (stage >= 1 && stage <= 4) || stage == 6;
            if (video.GetA() != (playing ? 0 : 255)) {
                std::cerr << "Video pixel alpha=" << static_cast<int>(video.GetA()) << '\n';
                Fail("Page background hides native video or disappears outside playback"); return S_OK;
            }
            if (!playing && stage != 8 && (video.GetR() < 20 || video.GetR() > 23 || video.GetG() < 24 || video.GetG() > 27 || video.GetB() < 36 || video.GetB() > 39)) {
                Fail("Requested Dark Mode gradient was lost after playback"); return S_OK;
            }
            if (stage == 8 && (video.GetR() != 123 || video.GetG() != 91 || video.GetB() != 245)) {
                Fail("Normal Mode did not restore the original background after playback"); return S_OK;
            }
            if (toolbar.GetA() != 255 || toolbar.GetR() != 114 || toolbar.GetG() != 114 || toolbar.GetB() != 194) {
                Fail("Playback transparency incorrectly hides foreground controls"); return S_OK;
            }
            Advance(window);
            return S_OK;
        }).Get());
    if (FAILED(result)) Fail("Native preview API unavailable");
}

LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM wp, LPARAM lp)
{
    if (message == WM_TIMER && wp == 1) { Fail("Native playback transparency test timed out"); return 0; }
    if (message == WM_TIMER && wp == 2) { Capture(window); return 0; }
    return DefWindowProcW(window, message, wp, lp);
}
}

int main()
{
    if (FAILED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED))) return 1;
    Gdiplus::GdiplusStartupInput options; ULONG_PTR graphics{};
    if (Gdiplus::GdiplusStartup(&graphics, &options, nullptr) != Gdiplus::Ok) return 1;
    wchar_t executable[MAX_PATH]; GetModuleFileNameW(nullptr, executable, MAX_PATH);
    const auto profile = std::filesystem::path(executable).parent_path() / (L"video-overlay-profile-" + std::to_wstring(GetCurrentProcessId()));
    const auto instance = GetModuleHandleW(nullptr);
    WNDCLASSW wc{}; wc.lpfnWndProc = WindowProc; wc.hInstance = instance; wc.lpszClassName = L"ForkVideoOverlayTest";
    RegisterClassW(&wc);
    const auto window = CreateWindowW(wc.lpszClassName, L"Native video overlay test", WS_POPUP,
        -32000, -32000, 640, 360, nullptr, nullptr, instance, nullptr);
    ShowWindow(window, SW_SHOWNOACTIVATE);
    SetTimer(window, 1, 60000, nullptr);
    const auto result = CreateCoreWebView2EnvironmentWithOptions(nullptr, profile.c_str(), nullptr,
        Microsoft::WRL::Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
        [window](HRESULT status, ICoreWebView2Environment* environment) -> HRESULT {
            if (FAILED(status) || !environment) { Fail("WebView2 runtime unavailable"); return S_OK; }
            return environment->CreateCoreWebView2Controller(window,
                Microsoft::WRL::Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                [window, environment = wil::com_ptr<ICoreWebView2Environment>(environment)](HRESULT status, ICoreWebView2Controller* control) -> HRESULT {
                    if (FAILED(status) || !control) { Fail("Cannot create native overlay controller"); return S_OK; }
                    controller = control; controller->get_CoreWebView2(&webview); controller->put_Bounds({0, 0, 640, 360});
                    const auto colorController = controller.try_query<ICoreWebView2Controller2>();
                    if (!colorController) { Fail("Transparent background API unavailable"); return S_OK; }
                    colorController->put_DefaultBackgroundColor({0, 0, 0, 0});
                    webview->AddScriptToExecuteOnDocumentCreated(kForkPlayerScript, nullptr);
                    webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL);
                    EventRegistrationToken token;
                    webview->add_WebResourceRequested(Microsoft::WRL::Callback<ICoreWebView2WebResourceRequestedEventHandler>(
                        [environment](ICoreWebView2*, ICoreWebView2WebResourceRequestedEventArgs* args) -> HRESULT {
                            const std::string html = "<!doctype html><html><head><style>:root{--primary-background-color:#7b5bf5;--secondary-background-color:#7b5bf5}html,body,#surface{margin:0;width:100%;height:100%}body{background:linear-gradient(41deg,var(--primary-background-color),var(--secondary-background-color))}#toolbar{position:fixed;top:0;left:0;width:60px;height:40px;background:#7272c2}</style></head><body><div id='surface'></div><div id='toolbar'></div></body></html>";
                            wil::com_ptr<IStream> stream; stream.attach(SHCreateMemStream(reinterpret_cast<const BYTE*>(html.data()), static_cast<UINT>(html.size())));
                            wil::com_ptr<ICoreWebView2WebResourceResponse> response;
                            environment->CreateWebResourceResponse(stream.get(), 200, L"OK", L"Content-Type: text/html; charset=utf-8", &response);
                            args->put_Response(response.get()); return S_OK;
                        }).Get(), &token);
                    webview->add_NavigationCompleted(Microsoft::WRL::Callback<ICoreWebView2NavigationCompletedEventHandler>(
                        [window](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
                            BOOL success = FALSE; args->get_IsSuccess(&success);
                            if (!success) Fail("Cannot load isolated native overlay fixture");
                            else SetTimer(window, 2, 500, nullptr);
                            return S_OK;
                        }).Get(), &token);
                    webview->Navigate(L"https://stremio.zarg.me/native-overlay-test");
                    return S_OK;
                }).Get());
        }).Get());
    if (FAILED(result)) Fail("Cannot initialize native web overlay test");
    MSG message{};
    while (GetMessageW(&message, nullptr, 0, 0) > 0) { TranslateMessage(&message); DispatchMessageW(&message); }
    KillTimer(window, 1); KillTimer(window, 2);
    if (controller) controller->Close();
    webview.reset(); controller.reset(); DestroyWindow(window);
    Gdiplus::GdiplusShutdown(graphics); CoUninitialize();
    return static_cast<int>(message.wParam);
}
