#pragma once

#include <windows.h>
#include <WebView2.h>

void SetYouTubeEnvironment(HWND owner, ICoreWebView2Environment* environment);
void OpenYouTubeTab();
bool FocusYouTubeTab();
void ResizeYouTubeTab();
void CloseYouTubeTab();
void ShutdownYouTubeTab();
