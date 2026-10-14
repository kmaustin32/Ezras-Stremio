## Ezra's Stremio 1.0.2

- Fixed a thin dark seam caused by faint encoded edge residue surviving manual black-bar detection. Detection now compares two stable measurements and refines only edges of confirmed bars, by at most two source pixels per edge.
- Added a one-source-pixel guard inside confirmed bar edges to prevent FSR/Anime4K scaling from sampling the black pixels outside the crop. Framing remains locked even when shaders are enabled later; unbarred axes and no-bar videos remain intact.
- Videos without clear bars remain uncropped. Larger dark picture edges are preserved, and each video still resets the detected crop. The detector stops after sampling; Ctrl+B remains the separate blur toggle.
- Added actual rendered-pixel checks for top/bottom/side seams, 8/10-bit sources, odd bar positions and fractional window scaling, plus preservation checks for no-bar videos and larger dark edges.

- Updated Settings → Player Shortcuts with all default input.conf bindings and the fork controls: Ctrl+B for blur, Ctrl+Shift+C for manual black-bar detection/reset, and Ctrl+Shift+F for Fit/Crop/Stretch.
- Listed each Anime4K mode individually and corrected shader clearing to Ctrl+8. Playback, seeking, speed, audio normalization, subtitle overrides, and the bundled Tab intro shortcut are included.
- Shortcut descriptions and key badges stay readable in narrow windows. General community shortcuts and custom player configuration are preserved.
- Release and download names now use Ezra's Stremio 1.0.2. The upstream shell version and existing installation/profile paths are retained for upgrade compatibility.

**Install this fork:** [Ezras-Stremio-1.0.2-x64.exe](https://github.com/kmaustin32/stremio-community-v5-upd/releases/download/v1.0.2/Ezras-Stremio-1.0.2-x64.exe),
or use the [portable ZIP](https://github.com/kmaustin32/stremio-community-v5-upd/releases/download/v1.0.2/Ezras-Stremio-1.0.2-x64.zip).
Files beginning **BUILD-ONLY** are source build dependencies, not this fork's installer.
Installing the original community dependency gives the original green icon and omits the fork features.

- Ctrl+Shift+C now detects encoded black bars on demand and locks the crop for the current video. Press again to restore framing; each new video resets. There is no automatic or continuous cropping.
- Ctrl+B remains the separate ambient-blur toggle. No clear bars or uncertain detection leaves the picture unchanged. Analysis stops after detection; shaders and unrelated filters are preserved.
- Detection needs running playback and a clear scene. Dark or unbalanced borders are conservatively rejected. Hardware decoding may briefly switch to copy-back during sampling and then restore its setting.
- Player compatibility fixes now apply independently: an upstream change to autoplay, maximum volume, or unwatched-thumbnail blur cannot discard the other compatible fixes. Unrecognized feature code is preserved, with an amber player indicator naming unavailable fixes.
- Release checks still require all three fixes against the current hosted interface, and test all eight combinations of upstream feature changes for syntax, idempotence, and preservation of unrelated code.
- Fixed unwatched-thumbnail blur when the primary image fails and the alternate anime image loads, including Inuyasha seasons after 2. Both the show page and player episode panel retain blur, as does the next-episode popup.
- The blur setting updates existing episode cards immediately; watched/unwatched changes keep working. Numbered specials (season or episode 0) are also protected.
- Watch history is preserved. On upgrade, the hosted UI script cache refreshes once so existing installations receive the fix.

- Auto play next episode now respects its setting when a video ends and cancels open countdowns when disabled; completion and manual Next remain available.
- Changing Maximum Volume now rescales the slider and updates actual mpv amplification immediately, including 150–225% above the previous 130% cap. Lower limits clamp current playback. Keyboard and wheel controls also use the live setting.
- Each new video starts at 100% volume, or at the selected maximum if it is lower. The slider keeps its orange-to-red boost range above 100%.
- Settings labels have more room before the options column and wrap instead of being cut off. Narrow windows stack labels and controls.
- Picture-in-Picture is available beside fullscreen at the top of the player, with the Loukious-style icon and matching control sizing. It toggles the community shell's borderless, always-on-top mode and stays synchronized with the tray.
- Ctrl+Shift+F cycles Fit, Crop, and Stretch, synchronized with the button and tray menu.
- Display controls use the official Stremio scaling icons, aligned with the other toolbar icons.

The embedded player uses mpv 0.41.0-1101-g5d85ba5fb (zhongfly, 2026-10-05),
with matching libplacebo 7.374.0, FFmpeg N-127213-g2da55bf59, headers and import library.
The FFmpeg/FFprobe command-line tools use BtbN's 2026-10-05 build, N-127203-ga35c879992.
The streaming server's sync options are adapted for the new FFmpeg version.
The required Vulkan loader 1.4.363.0 is bundled, so startup does not depend on
an existing system Vulkan runtime.

- Application branding now uses exact #7272c2 across Windows icons, splash, installer/uninstaller, hosted web UI logos, return button, and default Discord presence. Original shapes, white symbols, lettering and PNG transparency are preserved.
- The player toolbar's new display button cycles Fit → Crop → Stretch. Each new video resets to Fit; resizing keeps the current mode. Ambient blur and shaders are preserved. The tray menu provides the same control.

- Toggle Ambient Border Blur in the tray menu or with Ctrl+B in the player.
- The preference survives restart; `BorderBlurEnabled=-1` follows mpv.conf.
- New defaults enable blur at radius 25, use ewa_lanczos scaling, and force white subtitles.
- Updated input.conf: Ctrl+1–6 Anime4K, Ctrl+7 FSR, Ctrl+8 shader clearing, F1 audio normalization, F2 subtitle overrides, k/left-click pause, j/l seek, and [/] speed adjustment.
- FSR.glsl is now included from the verified original community package.
- Existing saved blur preferences continue to override mpv.conf; set BorderBlurEnabled=-1 to follow the new default.
- Automatic upstream binary updates are disabled to preserve fork features.
- Upstream source updates can be merged into the fork; see the included README-fork.md.

Download **Ezras-Stremio-1.0.2-x64.exe** for installation, or the **.zip** for
portable use with an installed WebView2 runtime. SHA256SUMS.txt verifies these
downloads. The remaining archives preserve build dependencies and are not
needed to run the application. `stremio-icon.png` is the public Discord branding asset.

GitHub Actions builds the application and runs configuration, toggle,
persistence, restart, keyboard, streaming, transcoding, native display geometry,
embedded D3D11 rendering at two sizes, Edge player controls, real community slider dragging,
responsive settings layout, real episode-image failures and alternate thumbnails,
watched/unwatched and blur-setting transitions, live autoplay and max-volume behavior,
and native WebView2 cached-upgrade and reload tests before publishing.
The build is unsigned. Hardware-specific playback and HDR require testing on
the target machine.
