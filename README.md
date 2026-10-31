<p align="center">
  <img src="images/stremio2.png" alt="Ezra's Stremio purple logo" width="200" />
</p>
<div align="center">
  <h1>🌌 Ezra's Stremio</h1>
  <p><strong>Built on Stremio Community</strong></p>
</div>

<p align="center">The Stremio Web v5 experience, with native mpv playback, ambient borders and a little more polish.</p>

<p align="center">
  <img src="https://img.shields.io/badge/%20C++-00599C?style=for-the-badge&amp;logo=c%2B%2B&amp;logoColor=white" alt="C++" />
  <img src="https://img.shields.io/badge/🌐%20WebView2-0078D6?style=for-the-badge&amp;logo=microsoftedge&amp;logoColor=white" alt="WebView2" />
  <img src="https://img.shields.io/badge/mpv-0.41-7272c2?style=for-the-badge&amp;logo=mpv&amp;logoColor=white" alt="mpv 0.41" />
  <img src="https://img.shields.io/badge/🪟%20Windows-x64-7272c2?style=for-the-badge" alt="Windows x64" />
</p>
<p align="center">
  <a href="https://github.com/kmaustin32/Ezras-Stremio/releases/latest"><img src="https://img.shields.io/github/v/release/kmaustin32/Ezras-Stremio?style=for-the-badge&amp;color=7272c2&amp;label=Download" alt="Latest stable release" /></a>
</p>
<p align="center">
  <a href="#-made-for-your-player">Features</a> · <a href="#-installation">Installation</a> · <a href="#-player-shortcuts">Shortcuts</a> · <a href="#-keep-your-library">Library backup</a> · <a href="docs/FORK.md">Configuration &amp; development</a>
</p>

## ✨ Made for your player

Everything added to this fork, from the first mpv upgrade through **1.3.4**:

| Feature | What you get |
| --- | --- |
| 🌫️ **Ambient border blur** | Fill letterbox and pillarbox space with a blurred copy of the picture. Toggle with **Ctrl+B** or the tray menu; the preference survives restart and keeps your configured blur radius. |
| 🎞️ **Manual black-bar detection** | **Ctrl+Shift+C** detects bars baked into the video and remembers the crop for that video. Press again to restore framing. No confirmed bars means no crop; each new video resets. |
| 🪡 **Cleaner blur edges** | Conservative edge refinement and a small interior guard remove faint dark seams after bar detection, including when using FSR or Anime4K. Unbarred picture edges stay intact. |
| 📐 **Fit → Crop → Stretch** | A matching player button, tray entry and **Ctrl+Shift+F** cycle framing modes. Every video starts in Fit; resizing preserves the current choice. |
| 🖼️ **Picture-in-Picture button** | Toggle the shell's borderless, always-on-top mode beside fullscreen, with an icon matching the other controls. Player and tray states stay synchronized. |
| 🎬 **A clean video frame** | Controls and cursor hide after one second of inactivity while playing or paused by default, with a choice of timeout or Never hide. Mouse movement brings them back; subtitles remain visible and open menus, keyboard focus and slider use stay usable. |
| 🫧 **Smooth controls everywhere** | The top bar slides upward and bottom controls slide downward whenever they hide, during playback or pause. They slide back in when shown, including newly mounted toolbars. Interrupted slides reverse smoothly. |
| ⏱️ **Your animation speed** | **Settings → Player → Controls → Control animation speed:** Off, **0.1**, 0.25, **0.5 by default**, 0.75 or 1 (seconds). Saved on this device and applied immediately. Off makes transitions instant; system reduced motion takes priority. |
| ⏲️ **One control timeout everywhere** | Immediately after animation speed, **Settings → Player → Controls → Control player timeout** offers **0.5**, **1 by default**, **2**, **5** and **Never hide**. Saved on this device and applied immediately during playback and pause, after mouse or keyboard activity. Never hide keeps controls and the pointer available in both states. |
| 🔊 **Volume that follows your settings** | New videos start at 100%, or a lower selected maximum. Changing Maximum Volume rescales the slider and updates mpv's actual boost limit, including above the old 130% cap. The normal range matches the player controls; the boosted range fades from orange to red. Toolbar and popup sliders stay synchronized. |
| ⌨ **Volume keys that stay on volume** | **Up / Down** change volume in 5% steps during playback and pause without moving focus into the toolbar. Menus, editors and focused sliders keep their own keyboard behavior; Tab/Enter and existing shortcuts remain available. |
| 🔈 **Reliable volume feedback** | The original speaker popup appears on volume changes even while paused, with visible controls or with Never hide enabled. Its own 1.5-second timer resets on each change; moving the mouse does not dismiss it. Read-only feedback lets video clicks pass through. |
| ⏭️ **Reliable autoplay control** | Turning off Auto play next episode stops automatic advancement and cancels its countdown. Manual Next and watch-progress handling remain available. |
| 🙈 **Consistent spoiler protection** | Unwatched episode thumbnails stay blurred on show pages, in the episode drawer and in the next-episode popup, including alternate images and anime using absolute episode numbers. Watched-state and setting changes update existing images. |
| ✅ **Warmer watched markers** | Completed-episode badges and library watched markers use **#DEA066** in both modes, with checkmarks and labels retaining their contrast. |
| 📚 **Readable library & add-on backup** | Export a dated ZIP with an offline HTML report, CSV lists and structured JSON, preserving saved titles, add-on order/configurations and available playback history. |
| ⚙️ **Clearer settings & shortcuts** | Long labels wrap, options have more breathing room, narrow windows stack controls, and Player Shortcuts lists every shipped input.conf binding plus the fork controls. |
| 🌑 **A calmer Dark Mode** | **Dark Mode is the default** for new configurations, with a **#222635** app background and softer **#858B99** player icons, episode title, elapsed/total/remaining time labels and normal volume range, including the speaker in the volume-change popup. Its rounded background uses **#222635 at 10% opacity** in Dark Mode. The tray toggle and saved theme choices remain available. Normal mode uses white player controls. Changes apply immediately; turning it off restores the original background and white player controls. |
| 🟣 **A matching playback bar** | The seek bar and its handle, selected navigation icons, episode-thumbnail progress and playback-source progress and the add-on loading bar use **#7272c2** in both modes. Volume keeps its orange-to-red boost indicator. |
| 🎛️ **Polished settings dropdowns** | All settings dropdowns share the animation selector's rounded shape, purple border, dark surface and visible keyboard focus, with the existing single- and multiple-selection behavior preserved. |
| 💜 **A consistent purple identity** | **#7272c2** across app, desktop and tray icons, splash, installer/uninstaller, web logos, return button and default Discord branding. |

### 🎥 Native playback, refreshed

- **mpv 0.41** from [zhongfly/mpv-winbuild](https://github.com/zhongfly/mpv-winbuild), with matching FFmpeg, libplacebo, headers and import library. The required Vulkan loader is bundled.
- **Anime4K HQ modes and FSR** in the shipped player configuration, ready to select with keyboard shortcuts. Shaders start disabled until selected.
- New mpv defaults use **gpu-next**, ambient blur at radius **25**, **ewa_lanczos** scaling, white subtitles and an OSD top offset. Your retained custom configuration and saved preferences still apply.
- Updated FFmpeg/FFprobe tools and compatible server sync flags, with the community streaming runtime retained. Native display geometry, ambient blur, shaders, subtitles and Discord presence are covered by release checks.

## 🔧 Installation

**Windows 10/11 x64** · [All releases](https://github.com/kmaustin32/Ezras-Stremio/releases)

| Download | How to use it |
| --- | --- |
| 📥 [**1.3.4 installer — recommended**](https://github.com/kmaustin32/Ezras-Stremio/releases/download/v1.3.4/Ezras-Stremio-1.3.4-x64.exe) | Run the EXE. The installer sets up WebView2 if needed. When upgrading, choose to retain your configuration to keep custom mpv.conf, input.conf and scripts. |
| 💼 [**1.3.4 portable ZIP**](https://github.com/kmaustin32/Ezras-Stremio/releases/download/v1.3.4/Ezras-Stremio-1.3.4-x64.zip) | Extract into its own folder and run `stremio.exe`. The portable build requires an installed [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/). |
| ✅ [**SHA256 checksums**](https://github.com/kmaustin32/Ezras-Stremio/releases/download/v1.3.4/SHA256SUMS.txt) | Verify the downloads against the release's checksum file. |

Use files named **Ezras-Stremio** for this fork. Downloads marked **BUILD-ONLY** are archived build dependencies. Community package-manager listings install the upstream edition; use this fork's releases for these features.

The fork's own black-bar script is updated by the installer even when retaining your other configuration. The upstream shell version and installation/profile paths stay compatible with earlier fork releases.

## 🎛️ Settle in

1. **Start a video.** Use the toolbar's display button to choose Fit, Crop or Stretch.
2. **Fill the borders.** Press **Ctrl+B** for ambient blur. For bars encoded into the picture, press **Ctrl+Shift+C** during a clear, playing scene first.
3. **Choose your motion.** Open **Settings → Player → Controls** and pick the animation speed. The new **Control player timeout** setting chooses how long controls stay visible during playback and pause, including Never hide.
4. **Try the calmer palette.** Dark Mode starts enabled for new configurations. Use the **Use Dark Theme** tray toggle to choose the slate background and softer player icons or normal mode; saved choices carry over. The purple seek bar and refreshed settings dropdowns appear in both modes.
5. **Make a backup.** Open Library and Add-ons while online, then use **Settings → Library & add-on backup → Export library & add-ons**.

### 🌫️ Ambient blur & encoded bars

These options in `portable_config/mpv.conf` control the ambient borders:

```ini
vo=gpu-next
border-background=blur
background-blur-radius=25
```

Blur fills the space **outside the video picture**. For black bars baked into the picture, **Ctrl+Shift+C** briefly samples the video, locks a confirmed crop and stops analyzing. It leaves uncertain, dark or unbalanced edges alone. Pause, seek, resize and shader changes keep the detected framing for that video; press the shortcut again to restore it.

Detection and blur are separate controls. The detected aspect ratio stays fixed for the current video, including videos whose framing changes later. See [the detailed guide](docs/FORK.md#encoded-black-bars) for detection safeguards, compatible filters and the seam fix.

## ⌨ Player shortcuts

The same list is available in **Settings → Player Shortcuts**. These are the shipped defaults; a custom `input.conf` may change them.

| Shortcut | Action |
| --- | --- |
| **Ctrl+B** | Toggle ambient border blur |
| **Ctrl+Shift+C** | Detect encoded black bars / restore framing |
| **Ctrl+Shift+F** | Cycle Fit → Crop → Stretch |
| **Ctrl+1–6** | Anime4K HQ: A, B, C, A+A, B+B, C+A |
| **Ctrl+7** | Enable the FSR shader |
| **Ctrl+8** | Clear GLSL shaders |
| **F1** | Toggle audio normalization |
| **F2** | Cycle subtitle overrides: Force → Strip → No |
| **K** or **left click** | Play / pause |
| **Up / Down** | Raise / lower volume by 5% during native playback; menus and focused editing controls retain their normal keys |
| **J / L** | Seek backward / forward 10 seconds |
| **[ / ]** | Decrease / increase playback speed by 0.25 |
| **Tab** | Use the bundled anime-intro skip script after the intro starts |

Picture-in-Picture is beside fullscreen at the top of the player and in the tray menu. The community's general keyboard shortcuts remain available.

## 📚 Keep your library

**Settings → Library & add-on backup → Export library & add-ons** produces:

| File | What it contains |
| --- | --- |
| `Library.html` | A human-readable, offline report of saved shows, movies and installed Stremio add-ons. Use browser Find or Print to PDF. |
| `Library.csv` | Saved titles in a spreadsheet-friendly UTF-8 list. |
| `Addons.csv` | Installed Stremio add-ons in their original order. |
| `Backup.json` | A versioned snapshot with add-on configurations/installation URLs, recent and older library records, and available watched/playback state. |

The export reads the data already saved on this device. Open Library and Add-ons online first so the account can synchronize; export itself does not contact the account server. Missing library parts are flagged, and unreadable data or account mismatches fail visibly.

Keep the ZIP and JSON private: configured add-on URLs can contain access keys. Login credentials and account details are excluded. This backs up **Stremio add-ons**, not browser extensions. Automatic import/restore is not included. [More about the backup format →](docs/FORK.md#library-and-add-on-backup)

## 🌟 The community foundation

Ezra's Stremio builds on [Zaarrg's Stremio Community](https://github.com/Zaarrg/stremio-community-v5) and its hosted [Stremio Web shell fixes](https://github.com/Zaarrg/stremio-web-shell-fixes):

- 🎞️ Native mpv playback, hardware decoding, 4K, HDR and advanced audio/subtitle configuration.
- 🌀 Torrents, magnets, local files, Stremio add-ons and the existing streaming server.
- 📁 Drag-and-drop / Open With playback and local subtitle loading.
- 📌 Audio/subtitle language selection, subtitle priorities and styling.
- 🖼️ Picture-in-Picture, optional ThumbFast seek previews and Chromecast support.
- 💬 Discord Rich Presence, Windows dark mode and shell/tray settings.
- 🧩 Support for loading compatible unpacked browser extensions.

<p align="center"><img src="https://i.imgur.com/xvM5lp8.png" alt="Stremio Community desktop interface" width="600" /></p>

### 🎭 Community playback examples

<p align="center"><strong>Anime4K + Auto HDR compared with the official player</strong></p>
<p align="center"><img src="https://i.imgur.com/rLTmFC2.png" alt="Community upscaling comparison" width="600" /></p>
<p align="center"><small><i>Original community example. HDR can appear over-exposed in screenshots.</i></small></p>

<p align="center"><strong>Optional ThumbFast seek previews</strong></p>
<p align="center"><img src="https://i.imgur.com/jNPit8J.gif" alt="Community thumbnail previews while seeking" width="600" /></p>

<p align="center"><strong>Discord Rich Presence</strong></p>
<p align="center"><img src="https://i.imgur.com/V5YgSSx.png" alt="Community Discord Rich Presence example" /></p>

## 🛠️ Configuration & everyday use

- **mpv configuration:** edit `portable_config/mpv.conf` and `portable_config/input.conf` beside the app. [Bundled mpv configurations →](utils/mpv/README.md)
- **Local media:** drag a video or `.torrent` onto Stremio, use Open With, or open a magnet link. You can also paste a magnet into Search.
- **Local subtitles:** drop a subtitle file onto a playing video. Some subtitle colors are controlled by the Player settings; use mpv.conf for additional styling.
- **Browser extensions:** put a compatible unpacked extension in `portable_config/extensions/<name>/`, with its `manifest.json` directly inside that folder, then restart. Some extensions require extra shell support; see the [community extension collection](https://github.com/Zaarrg/stremio-community-v5/tree/webview-windows/extensions).
- **App behavior:** edit `portable_config/stremio-settings.ini` or use the tray menu. Existing options include CloseOnExit, UseDarkTheme, PauseOnMinimize, PauseOnLostFocus, AllowZoom and ThumbFastHeight.
- **Troubleshooting:** startup errors are written to `portable_config/errors-<date>.txt`. The portable build needs the system WebView2 Runtime.

Anime4K and FSR are included. Other mpv filters, shaders and optional upscalers can be configured separately; they are not enabled by this release. Keep a copy of your configuration before changing it, and use [the fork guide](docs/FORK.md) for the tested defaults and black-bar filter limitations.

### ⚙️ Start arguments

| Argument | Purpose |
| --- | --- |
| `--webui-url=<url>` | Choose another web UI, such as `https://web.stremio.com/`. |
| `--streaming-server-disabled` | Disable automatic streaming-server startup. |
| `--autoupdater-endpoint=<url>` | Supply an explicitly configured fork update feed. |
| `--autoupdater-force-full` | Request a full update from a configured feed. |

## 🔄 Built to keep our changes

Fork features are kept in separate native code, scripts and carefully checked integration patches. Upstream source history is retained so community updates can be merged and reviewed.

- **Upstream binary auto-updates are disabled by default**, so an original community installer cannot silently replace this fork. Install new Ezra's Stremio releases from this repository.
- Autoplay, maximum-volume, episode-blur and volume-popup patches validate independently. If the hosted UI changes incompatibly, an amber player indicator names the unavailable fixes while other compatible fixes remain active.
- Changed compatibility patches refresh the hosted UI's script cache once while preserving login storage, preferences and player configuration.
- Dependency versions and checksums are pinned, archived build dependencies have mirrors, and GitHub builds/tests the installer and portable package before publication.
- Release checks cover native blur/framing, no-bar and seam safety, FSR/Anime4K interactions, streaming/transcoding, real community sliders and episode images, settings/shortcuts/animation and timeout preferences, theme switching and live dropdown interaction, backup archives, WebView2 reloads and installer branding.

For development, start from **`webview-windows`** in this fork. Merge upstream changes into a feature branch, run the checks and review the result before merging back. The integration checks help detect upstream changes; future compatibility still needs verification.

📖 [Fork setup, build commands and upstream merge instructions](docs/FORK.md) · [Release notes](docs/RELEASE-mpv.md) · [Build workflow](.github/workflows/windows-release.yml)

## 🤝 Credits & support

Built on the work of **[Zaarrg](https://github.com/Zaarrg)** and the Stremio Community contributors, with mpv, FFmpeg, libplacebo, Anime4K, FSR and the other bundled projects. Original community documentation and examples informed this guide. Upstream credit and licensing remain in the source.

<p align="center">
  <a href="https://ko-fi.com/zaarrg"><img src="https://img.shields.io/badge/Support%20Zaarrg%20on%20Ko--fi-7272c2?style=for-the-badge&amp;logo=ko-fi&amp;logoColor=white" alt="Support the original community developer on Ko-fi" /></a>
</p>

## ⚠️ Disclaimer

This project is not affiliated with **Stremio** in any way.

This fork is provided solely for educational and lawful use. **It does not support piracy or any form of copyright infringement.**

It is the user's responsibility to ensure that any content accessed is fully compliant with the DMCA and all applicable copyright laws. The project maintainers do not condone or support any illegal activities.

<p align="center"><strong>💜 Ezra's Stremio · Built on Stremio Community</strong></p>
