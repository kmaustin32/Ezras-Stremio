## Ezra's Stremio 2.0.0 Beta 3

- **Shared Library lists.** The primary and fallback web interfaces use the same local lists and category corrections for each account. Older beta data is imported from each interface when you open it. If the two interfaces stored conflicting corrections, the one already imported into the shared store takes priority.
- **Older cards can resume.** The three-dot Play action uses the saved stream for that exact title and video, including its resume position, when one is available.
- **Bulk edits follow the current view.** Switching Library views clears selection, so a bulk edit cannot include titles selected in the previous view.
- **Library compatibility notice.** If a hosted interface update disables list support, Home and Library explain that the saved lists are still on the device.
- **mpv shutdown.** The native app stops handling events when mpv shuts down. Commands use mpv’s asynchronous API without background threads that can outlive the player.

Custom lists and manual corrections are stored per account on each Windows device. On another computer, Anime and Live Action rebuild from your regular Stremio Library.

### Windows downloads

- [Windows x64 installer](https://github.com/kmaustin32/Ezras-Stremio/releases/download/v2.0.0-beta.3/Ezras-Stremio-2.0.0-beta.3-x64.exe)
- [Portable Windows x64 ZIP](https://github.com/kmaustin32/Ezras-Stremio/releases/download/v2.0.0-beta.3/Ezras-Stremio-2.0.0-beta.3-x64.zip)
- [SHA256 checksums](https://github.com/kmaustin32/Ezras-Stremio/releases/download/v2.0.0-beta.3/SHA256SUMS.txt)

Use Windows 10 or 11 x64. If upgrading with the installer, retain your configuration to keep your custom mpv settings.
