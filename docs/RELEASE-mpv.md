## Ezra's Stremio 2.0.0

- **Custom Library lists.** Create named lists and add a title to multiple lists. Use Ctrl+click to select several titles for a bulk edit. Your lists appear on Home after Featured Movies.
- **Automatic Anime and Live Action lists.** Both lists rebuild from your saved Library, and manual moves are remembered on this device. Watched and Unwatched filter titles. Last Watched, A–Z, and Z–A sort within the selected list.
- **Saved lists carry over.** In-place updates preserve custom lists and manual categories. The primary and supported fallback web interfaces share the same local lists. If older beta data cannot be read, current lists stay available. The uninstaller honors your choice to keep or remove them.
- **Older Library cards can resume the saved source.** The three-dot Play action uses the stream saved for that exact title and video when available. Switching views clears the previous bulk selection.
- **Faster interface preparation at startup.** The app checks only where Library hooks can begin and keeps its compatibility checks. This reduces the work required before the hosted interface loads.
- **More reliable Windows playback and startup.** A second launch preserves saved preferences, and native player commands stay on the thread that owns mpv during shutdown.

Custom lists and manual corrections are stored per account on each Windows device. On another computer, Anime and Live Action rebuild from your regular Stremio Library.

### Windows downloads

- [Windows x64 installer](https://github.com/kmaustin32/Ezras-Stremio/releases/download/v2.0.0/Ezras-Stremio-2.0.0-x64.exe)
- [Portable Windows x64 ZIP](https://github.com/kmaustin32/Ezras-Stremio/releases/download/v2.0.0/Ezras-Stremio-2.0.0-x64.zip)
- [SHA256 checksums](https://github.com/kmaustin32/Ezras-Stremio/releases/download/v2.0.0/SHA256SUMS.txt)

Use Windows 10 or 11 x64. If upgrading with the installer, retain your configuration to keep your custom mpv settings.

On some Windows configurations, opening a local file from Explorer can fail when the filename contains accented or non-Latin characters.
