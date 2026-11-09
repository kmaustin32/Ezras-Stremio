## Ezra's Stremio 1.5.0

Choose a watched accent, browse with a softer poster hover, and use Library controls styled to match Settings.

### What's new

- **Secondary color.** In **Settings → General**, choose Purple `#7272C2`, Amber `#DEA066` (default), Teal `#61D1C7`, Dusty Rose `#E08EB3`, or Sage `#B6D283`. Watched tags and checkmark badges update immediately, and the choice is saved on this device.
- **Poster hover.** Show and movie covers get a soft purple border glow and a gentler zoom. The cover stays still when Windows requests reduced motion.
- **Library controls.** Search, dropdowns and sorting use the same squared corners as Settings. The selected sort and the dropdown selection dot use the main purple.

### Player preferences retained

Up/Down volume keys, click-through volume feedback, source selection and existing framing/blur shortcuts remain available. Dark Mode defaults and saved theme choices, 0.1–1 second control animations, the unified timeout including Never hide, subtitles, volume boost and account-preserving cache refresh are retained.

### Everything from the fork, in one stable release

- mpv 0.41 with matching libplacebo, FFmpeg and bundled Vulkan loader; updated FFmpeg/FFprobe tools and compatible streaming-server sync options.
- Persistent ambient border blur through Ctrl+B and the tray menu.
- Manual encoded-black-bar detection/reset with Ctrl+Shift+C, per-video crop reset, no-bar safety, conservative seam refinement and shader edge protection.
- Fit/Crop/Stretch toolbar and tray controls with Ctrl+Shift+F, resetting to Fit for each video.
- Picture-in-Picture beside fullscreen, synchronized with the tray.
- Library shows open details for episode and source selection; movies, Continue Watching and explicit Play keep their behavior.
- New videos start at 100% volume or a lower selected maximum. Maximum Volume updates the actual amplification limit and slider, with orange-to-red boost above 100%.
- Autoplay off is honored at video end and cancels countdowns. Manual Next and watch-progress handling remain available.
- Skip Intro and Skip Outro use labeled chapters, with optional timestamp lookup in Player settings.
- Unwatched episode blur covers alternate thumbnails, absolute-numbered anime, later seasons, episode lists and next-episode popups.
- Purple #7272c2 branding throughout the application, installer and web logos; readable settings labels and a complete shipped Player Shortcuts catalog.
- Anime4K HQ/FSR shortcuts, audio normalization, subtitle overrides and the existing customized mpv defaults.
- Local library/add-on export with readable HTML, CSV lists and structured JSON. Open Library and Add-ons online first for current saved data; automatic restore is not included. Keep the ZIP/JSON private because configured add-on URLs may contain access keys.
- Independent compatibility checks and an amber status indicator, cache refreshes that preserve account/preferences, fork-safe update defaults, pinned dependencies and retained upstream source history.

The redesigned [README](../README.md) covers these features, installation, shortcuts, backups, configuration, community features and upstream development while retaining the original project's visual style and credits.

### Downloads

- [Windows x64 installer](https://github.com/kmaustin32/Ezras-Stremio/releases/download/v1.5.0/Ezras-Stremio-1.5.0-x64.exe)
- [Portable Windows x64 ZIP](https://github.com/kmaustin32/Ezras-Stremio/releases/download/v1.5.0/Ezras-Stremio-1.5.0-x64.zip)
- [SHA256 checksums](https://github.com/kmaustin32/Ezras-Stremio/releases/download/v1.5.0/SHA256SUMS.txt)

Use Windows 10/11 x64. The installer sets up WebView2 when needed; the portable ZIP needs the system WebView2 Runtime. When upgrading, retain your configuration to keep custom mpv.conf, input.conf and other scripts. The fork's own black-bar script is updated. The original shell version and installation/profile paths are retained for upgrade compatibility.

### Validation and upstream compatibility

GitHub Actions builds the installer and portable archive and runs checks for native playback, blur, framing, rendering, black-bar detection, shaders, streaming, chapter seeks, skip buttons, Library navigation and styling, poster motion, palette persistence, keyboard and popup interactions, episode-image blur, backup, WebView2 and installer branding before publication.

Theme and settings styling are isolated in the fork script; they do not rewrite the hosted community bundle or profile. Automatic upstream binary updates remain disabled. Source history is preserved for future upstream merges; incompatible hosted UI changes are reported rather than silently discarding other compatible fixes.
