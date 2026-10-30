## Ezra's Stremio 1.3.0

A more consistent player palette and a configurable paused-control timeout, with the existing playback and fork features retained.

### What's new

- **Selected navigation icons: #7272C2.** Library, Calendar and the other selected sidebar icons now match the fork's theme in both modes.
- **Matching episode/source progress.** Progress on episode thumbnails and on the playback-source selection page now uses #7272C2, matching the playback seek bar.
- **Darker Dark Mode: #222635.** Controlled by the existing saved **Use Dark Theme** tray setting; turning it off restores the original background.
- **Consistent player controls.** Fullscreen entry/exit and Picture-in-Picture match the other icons, including opacity. Icons, both playback time labels and the normal volume range use white in normal mode and #858B99 in Dark Mode. The seek bar remains #7272C2; volume above 100% retains the orange-to-red boost range, using the configured maximum on both tracks.
- **Control player timeout.** Immediately after animation speed in **Settings → Player → Controls**: **0.5 sec**, **1 sec (default)**, **2 sec**, **5 sec** or **Never hide**. It applies to paused controls, as before; playing videos retain their usual timeout. The choice is saved on this device and applies immediately, with menus, keyboard use and sliders kept usable.
- **README and tests updated.** Added real navigation/progress/icon/volume color checks and timeout persistence, cross-window and delay checks. The native blur assertion now waits for actual rendered border pixels within a fixed deadline while retaining its original threshold.

### Existing control preferences

The animation-speed setting still offers Off, 0.25 sec, 0.5 sec (default), 0.75 sec and 1 sec. It remains independent of the paused idle timeout, and system reduced-motion preferences take priority. Settings dropdowns keep their rounded style and keyboard focus outlines.

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

- [Windows x64 installer](https://github.com/kmaustin32/stremio-community-v5-upd/releases/download/v1.3.0/Ezras-Stremio-1.3.0-x64.exe)
- [Portable Windows x64 ZIP](https://github.com/kmaustin32/stremio-community-v5-upd/releases/download/v1.3.0/Ezras-Stremio-1.3.0-x64.zip)
- [SHA256 checksums](https://github.com/kmaustin32/stremio-community-v5-upd/releases/download/v1.3.0/SHA256SUMS.txt)

Use Windows 10/11 x64. The installer sets up WebView2 when needed; the portable ZIP needs the system WebView2 Runtime. When upgrading, retain your configuration to keep custom mpv.conf, input.conf and other scripts. The fork's own black-bar script is updated. The original shell version and installation/profile paths are retained for upgrade compatibility.

### Validation and upstream compatibility

GitHub Actions builds the installer and portable archive and runs the native configuration, blur/framing/rendering, black-bar/seam, shader, streaming/transcoding, live player compatibility, real community slider, episode-image blur, settings/shortcuts, animation and timeout preferences, theme switching, live dropdown interaction, backup, WebView2 and installer-branding checks before publication.

Theme and settings styling are isolated in the fork script; they do not rewrite the hosted community bundle or profile. Automatic upstream binary updates remain disabled. Source history is preserved for future upstream merges; incompatible hosted UI changes are reported rather than silently discarding other compatible fixes.
