## Ezra's Stremio 1.3.5

Library shows open their details page so you can choose the episode and source before playback.

### What's new

- **Details first for Library shows.** Selecting a show in Library opens episode details instead of automatically starting its cached stream. Poster/title clicks and Enter follow the same native details link. You can choose an episode and then a playback source.
- **Existing shortcuts preserved.** Movies and Continue Watching retain their current navigation. The context menu's explicit Play action still intentionally uses the cached player; watched/remove actions and library/account data are preserved.
- **Independent compatibility safeguards.** Library navigation is checked separately from the four playback fixes. Tests cover all 32 combinations, native link forwarding and V3/V4 cache upgrades. Original-bundle tests reproduce the old automatic-player target.
- **Branches brought up to date.** The maintained webview-windows default branch and master receive the same tested release snapshot. Legacy master history is retained without replacing the maintained application with obsolete files or force-rewriting history.

### Player preferences retained

Up/Down volume keys, click-through volume feedback, source selection and existing framing/blur shortcuts remain available. Dark Mode defaults and saved theme choices, 0.1–1 second control animations, the unified timeout including Never hide, subtitles, volume boost and account-preserving cache refresh are retained.

### Everything from the fork, in one stable release

- mpv 0.41 with matching libplacebo, FFmpeg and bundled Vulkan loader; updated FFmpeg/FFprobe tools and compatible streaming-server sync options.
- Persistent ambient border blur through Ctrl+B and the tray menu.
- Manual encoded-black-bar detection/reset with Ctrl+Shift+C, per-video crop reset, no-bar safety, conservative seam refinement and shader edge protection.
- Fit/Crop/Stretch toolbar and tray controls with Ctrl+Shift+F, resetting to Fit for each video.
- Picture-in-Picture beside fullscreen, synchronized with the tray.
- New videos start at 100% volume or a lower selected maximum. Maximum Volume updates the actual amplification limit and slider, with orange-to-red boost above 100%.
- Autoplay off is honored at video end and cancels countdowns. Manual Next and watch-progress handling remain available.
- Unwatched episode blur covers alternate thumbnails, absolute-numbered anime, later seasons, episode lists and next-episode popups.
- Purple #7272c2 branding throughout the application, installer and web logos; readable settings labels and a complete shipped Player Shortcuts catalog.
- Anime4K HQ/FSR shortcuts, audio normalization, subtitle overrides and the existing customized mpv defaults.
- Local library/add-on export with readable HTML, CSV lists and structured JSON. Open Library and Add-ons online first for current saved data; automatic restore is not included. Keep the ZIP/JSON private because configured add-on URLs may contain access keys.
- Independent compatibility checks and an amber status indicator, cache refreshes that preserve account/preferences, fork-safe update defaults, pinned dependencies and retained upstream source history.

The redesigned [README](../README.md) covers these features, installation, shortcuts, backups, configuration, community features and upstream development while retaining the original project's visual style and credits.

### Downloads

- [Windows x64 installer](https://github.com/kmaustin32/Ezras-Stremio/releases/download/v1.3.5/Ezras-Stremio-1.3.5-x64.exe)
- [Portable Windows x64 ZIP](https://github.com/kmaustin32/Ezras-Stremio/releases/download/v1.3.5/Ezras-Stremio-1.3.5-x64.zip)
- [SHA256 checksums](https://github.com/kmaustin32/Ezras-Stremio/releases/download/v1.3.5/SHA256SUMS.txt)

Use Windows 10/11 x64. The installer sets up WebView2 when needed; the portable ZIP needs the system WebView2 Runtime. When upgrading, retain your configuration to keep custom mpv.conf, input.conf and other scripts. The fork's own black-bar script is updated. The original shell version and installation/profile paths are retained for upgrade compatibility.

### Validation and upstream compatibility

GitHub Actions builds the installer and portable archive and runs the native configuration, blur/framing/rendering, black-bar/seam, shader, streaming/transcoding, all 32 live compatibility combinations, actual Library/details/episode/source navigation, real keyboard/spatial-navigation and popup interactions, real community slider, episode-image blur, settings/shortcuts, animation and timeout preferences, theme switching, live dropdown interaction, backup, WebView2 and installer-branding checks before publication.

Theme and settings styling are isolated in the fork script; they do not rewrite the hosted community bundle or profile. Automatic upstream binary updates remain disabled. Source history is preserved for future upstream merges; incompatible hosted UI changes are reported rather than silently discarding other compatible fixes.
