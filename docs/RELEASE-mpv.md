## Ezra's Stremio 1.1.0

This stable release brings the animated player controls from the 1.0.4 betas together with a new animation-speed preference and a complete fork feature guide.

### Choose your animation speed

Open **Settings → Player → Controls → Control animation speed** and choose **Off**, **0.25 sec**, **0.5 sec (default)**, **0.75 sec** or **1 sec**.

- The choice applies immediately to playing and paused controls and to newly appearing toolbars. It is saved on this device separately from the community profile and survives reloads and upgrades.
- Off makes transitions instant, including cancelling an in-progress slide. Existing inactivity delays stay unchanged: one second while paused and the community player's usual timing while playing.
- Top controls slide upward, bottom controls slide downward, shading fades with them, and the episode button fades in place. Mouse movement smoothly reverses an unfinished slide.
- Menus, slider use, keyboard focus, subtitles and video framing remain usable. System reduced-motion preferences take priority.
- The setting follows the Player section even when its navigation label is translated, supports the keyboard and fits narrow windows. If storage cannot save the setting, it still works for the current session and reports that limitation.

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

- [Windows x64 installer](https://github.com/kmaustin32/stremio-community-v5-upd/releases/download/v1.1.0/Ezras-Stremio-1.1.0-x64.exe)
- [Portable Windows x64 ZIP](https://github.com/kmaustin32/stremio-community-v5-upd/releases/download/v1.1.0/Ezras-Stremio-1.1.0-x64.zip)
- [SHA256 checksums](https://github.com/kmaustin32/stremio-community-v5-upd/releases/download/v1.1.0/SHA256SUMS.txt)

Use Windows 10/11 x64. The installer sets up WebView2 when needed; the portable ZIP needs the system WebView2 Runtime. When upgrading, retain your configuration to keep custom mpv.conf, input.conf and other scripts. The fork's own black-bar script is updated. The original shell version and installation/profile paths are retained for upgrade compatibility.

### Validation and upstream compatibility

GitHub Actions builds the installer and portable archive and runs the native configuration, blur/framing/rendering, black-bar/seam, shader, streaming/transcoding, live player compatibility, real community slider, episode-image blur, settings/shortcuts, animation preference, backup, WebView2 and installer-branding checks before publication.

The animation preference is isolated in the fork script; it does not rewrite the hosted community bundle or profile. Automatic upstream binary updates remain disabled. Source history is preserved for future upstream merges; incompatible hosted UI changes are reported rather than silently discarding other compatible fixes.
