#pragma once

#include <windows.h>
#include <string_view>

constexpr UINT WM_FORK_UPDATE_READY = WM_APP + 4;

bool IsForkUpdateSource(std::wstring_view source);
void HandleForkUpdateRequest(std::string_view request);
void CompleteForkUpdate();
void ShutdownForkUpdate();
