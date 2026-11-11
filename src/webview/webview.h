#ifndef WEBVIEW_H
#define WEBVIEW_H

#include <windows.h>
#include <string>

void InitWebView2(HWND hWnd);
inline constexpr wchar_t LocalProfileUrl[] = L"https://ezras-stremio.invalid/";
void OpenLocalProfile();
void CompleteLocalProfileRequest(LPARAM result);
void WaitAndRefreshIfNeeded();
void refreshWeb(bool refreshAll);
static void SetupWebMessageHandler();
static void SetupExtensions();
static void SetupWebMods();

#endif // WEBVIEW_H
