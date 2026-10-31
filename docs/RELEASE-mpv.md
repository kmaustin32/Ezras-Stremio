## Ezra's Stremio 1.3.4

Restores volume keys and feedback while preserving the player controls and timing preferences.

### What's fixed

- **Up/Down stays on volume.** During native playback, plain Up/Down changes volume by 5% without moving focus among toolbar buttons. Repeats, live maximum volume, paused playback and the lower limit are preserved. Menus, editors, focused sliders, Tab/Enter, seeking and existing shortcuts keep their behavior.
- **The speaker popup returns.** The existing community indicator stays mounted independently of control visibility, so it works while playing or paused, with visible controls and with Never hide. Its own 1.5-second timer resets on each volume change, and moving the mouse no longer removes it. It does not flash on startup. Read-only feedback lets video pause clicks pass through and cannot start a slider drag.
- **Synchronized volume styling.** Toolbar and popup sliders both follow the configured maximum, normal theme colors and orange-to-red boost range.
- **Independent compatibility safeguards.** The popup fix validates separately from autoplay, amplification and episode blur. Unknown or ambiguous upstream code retains its original behavior and shows an amber compatibility warning. Existing version 3 patched caches upgrade without duplicating successful edits.

### Control preferences retained

Dark Mode remains the default for new configurations, with saved theme choices respected. The volume popup uses #222635 at 10% background opacity and a #858B99 speaker in Dark Mode. Animation speed remains Off, 0.1, 0.25, 0.5 (default), 0.75 or 1; timeout remains 0.5, 1 (default), 2, 5 or Never hide. Reduced motion, protected menu/slider interactions and saved timing preferences continue to apply.

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

- [Windows x64 installer](https://github.com/kmaustin32/stremio-community-v5-upd/releases/download/v1.3.4/Ezras-Stremio-1.3.4-x64.exe)
- [Portable Windows x64 ZIP](https://github.com/kmaustin32/stremio-community-v5-upd/releases/download/v1.3.4/Ezras-Stremio-1.3.4-x64.zip)
- [SHA256 checksums](https://github.com/kmaustin32/stremio-community-v5-upd/releases/download/v1.3.4/SHA256SUMS.txt)

Use Windows 10/11 x64. The installer sets up WebView2 when needed; the portable ZIP needs the system WebView2 Runtime. When upgrading, retain your configuration to keep custom mpv.conf, input.conf and other scripts. The fork's own black-bar script is updated. The original shell version and installation/profile paths are retained for upgrade compatibility.

### Validation and upstream compatibility

GitHub Actions builds the installer and portable archive and runs the native configuration, blur/framing/rendering, black-bar/seam, shader, streaming/transcoding, all 16 live player compatibility combinations, real keyboard/spatial-navigation and popup interactions, real community slider, episode-image blur, settings/shortcuts, animation and timeout preferences, theme switching, live dropdown interaction, backup, WebView2 and installer-branding checks before publication.

Theme and settings styling are isolated in the fork script; they do not rewrite the hosted community bundle or profile. Automatic upstream binary updates remain disabled. Source history is preserved for future upstream merges; incompatible hosted UI changes are reported rather than silently discarding other compatible fixes.
