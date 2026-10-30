## Ezra's Stremio 1.3.3

Dark Mode defaults, a matching volume popup, and a faster control animation option.

### What's new

- **Dark Mode by default.** New configurations and startup fallbacks use Dark Mode. Existing saved theme choices are preserved, including normal mode, and the tray toggle remains available.
- **Matching translucent volume popup.** In Dark Mode, the rounded background behind the volume-change speaker uses **#222635 at 10% opacity**. The speaker stays **#858B99**; normal-mode popup appearance and timing are preserved.
- **0.1 animation speed.** Control animation speed now offers **Off, 0.1, 0.25, 0.5 (default), 0.75 and 1**. The `sec` suffix is removed from both timing dropdowns, with seconds explained in their help text. Timeout choices remain **0.5, 1 (default), 2, 5 and Never hide**.
- **Regression coverage.** Real community-popup styling, all animation choices including 100 ms, theme fallback and saved normal mode are covered. A native configuration test checks fresh defaults, save/reload and unrelated-setting preservation against an isolated profile.

### Existing control preferences

Control timeout continues to apply during playback and pause after mouse or keyboard activity. Never hide keeps controls available in both states; menus, keyboard focus and slider drags remain protected. Animation duration stays independent of timeout, system reduced-motion preferences take priority, and existing saved timing preferences carry over.

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

- [Windows x64 installer](https://github.com/kmaustin32/stremio-community-v5-upd/releases/download/v1.3.3/Ezras-Stremio-1.3.3-x64.exe)
- [Portable Windows x64 ZIP](https://github.com/kmaustin32/stremio-community-v5-upd/releases/download/v1.3.3/Ezras-Stremio-1.3.3-x64.zip)
- [SHA256 checksums](https://github.com/kmaustin32/stremio-community-v5-upd/releases/download/v1.3.3/SHA256SUMS.txt)

Use Windows 10/11 x64. The installer sets up WebView2 when needed; the portable ZIP needs the system WebView2 Runtime. When upgrading, retain your configuration to keep custom mpv.conf, input.conf and other scripts. The fork's own black-bar script is updated. The original shell version and installation/profile paths are retained for upgrade compatibility.

### Validation and upstream compatibility

GitHub Actions builds the installer and portable archive and runs the native configuration, blur/framing/rendering, black-bar/seam, shader, streaming/transcoding, live player compatibility, real community slider, episode-image blur, settings/shortcuts, animation and timeout preferences, theme switching, live dropdown interaction, backup, WebView2 and installer-branding checks before publication.

Theme and settings styling are isolated in the fork script; they do not rewrite the hosted community bundle or profile. Automatic upstream binary updates remain disabled. Source history is preserved for future upstream merges; incompatible hosted UI changes are reported rather than silently discarding other compatible fixes.
