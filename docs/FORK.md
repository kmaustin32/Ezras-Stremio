# Ezra's Stremio

This fork bundles mpv **0.41.0-1101-g5d85ba5fb**, libplacebo **7.374.0** and
FFmpeg **N-127213-g2da55bf59** from zhongfly's 2026-10-05 build. The standard
x86_64 build works without the newer CPU requirements of x86_64-v3.
The required Vulkan loader **1.4.363.0** is bundled beside mpv, including for
D3D11 playback. Use Windows 10/11 x64.

## Install and use

Download `Ezras-Stremio-1.1.0-x64.exe` from this fork's release. The installer
installs WebView2 when needed. The `.zip` is portable but requires the system
WebView2 runtime. Extract the ZIP into its own directory and run `stremio.exe`.
Use the installer whose filename starts with `Ezras-Stremio`; **BUILD-ONLY** downloads are
archived build dependencies. The original upstream installer is one such dependency
and installs the original green-icon application, not this fork.

Toggle **Ambient Border Blur** from the Stremio tray menu, or press **Ctrl+B**
in the player. The preference survives restart. The menu checkmark reflects
mpv's current state, including settings supplied by mpv.conf.

Edit `portable_config/mpv.conf` beside the application:

```ini
vo=gpu-next
border-background=blur
background-blur-radius=25
```

The mpv option names are `border-background` and `background-blur-radius`;
`border-blur` and `border-radius` are not valid mpv options. These settings
fill letterbox/pillarbox space with a blurred copy of the video. Black bars
encoded inside the video itself are part of the picture and are unaffected.
The radius controls blur strength, rather than rounded window corners.

In `portable_config/stremio-settings.ini`, `[MPV] BorderBlurEnabled=-1`
follows mpv.conf. `0` overrides it with solid borders and `1` enables blur.
The toggle writes only this preference and preserves the configured radius.
Set it back to `-1` to resume following mpv.conf. Enabling blur selects gpu-next.

### Encoded black bars

While a video is playing, press **Ctrl+Shift+C** during a clear, bright scene
to detect black bars encoded into the picture. The detector samples briefly,
then removes its analysis filter and locks the detected crop for this video,
including through pause, seek, resize, and Fit/Crop/Stretch changes. There is no
automatic or continuous detection. Press the same hotkey again to restore the
previous framing; each new video starts without the detected crop.

Press **Ctrl+B** separately to enable ambient blur in the remaining borders.
Detection does not change the blur setting. No clear bars, insufficient data,
dark/uncertain or unbalanced edges leave the picture unchanged. Detection requires
playback to be running; pausing during sampling cancels it. Existing video filters,
shaders, subtitles, and streaming connections are retained. Filters that change
decoded picture dimensions are conservatively rejected. Direct hardware decoding
may briefly switch to copy-back decoding for analysis, then restore its setting.
For changing-aspect-ratio videos, the manual crop stays locked until you reset it.

Detection compares two stable edge measurements to remove faint compression
residue that can leave a thin dark seam against the ambient blur. Refinement is
limited to two source pixels per edge of already confirmed black bars. Larger
disagreements retain the conservative crop; videos without confirmed bars remain
uncropped. Both sampling passes stop when detection finishes.
Confirmed bar edges also receive a one-source-pixel guard inside the picture:
shader upscalers can otherwise sample the encoded black pixels outside the VO
crop and leave a seam. The guard stays fixed when shaders change; unbarred axes
remain intact. Ctrl+Shift+C restores the full original framing.

The installer updates `scripts/fork_bar_detection.lua` as fork implementation
while preserving existing mpv.conf, input.conf and other custom scripts when
you choose to retain your configuration.

New installations enable blur with radius 25, use `ewa_lanczos` scaling, and
force white subtitles. Existing saved blur preferences continue to take priority.
The bundled `input.conf` provides Ctrl+1 through Ctrl+6 for Anime4K modes,
Ctrl+7 for FSR, Ctrl+8 to clear shaders, F1 for audio normalization, and F2
to cycle subtitle overrides. It also includes k/left-click for pause, j/l
for ten-second seeks, and [/] for speed changes of 0.25. The default shader
chain remains commented out, so shaders activate only when selected.

## Fit, Crop, and Stretch

The player toolbar includes a display button that cycles **Fit → Crop → Stretch**,
using the official Stremio scaling icons and matching the other controls.
**Ctrl+Shift+F** performs the same cycle and updates the button and tray state.
Fit preserves the complete picture and its proportions. Crop fills the player
while keeping proportions, cutting off the edges as needed. Stretch fills the
player by changing the picture's proportions. New videos reset to Fit; changing
window size or entering fullscreen keeps the mode for the current video.
The control preserves ambient blur, shaders, and subtitle styling. The tray's
**Display** item provides the same cycle if the web toolbar is unavailable.
Crop fills the player with the encoded frame; it does not detect black bars
encoded inside the video.

Every new video starts at **100% volume** (or a lower selected maximum), including when upgrading with an
older saved InitialVolume value. Adjustments apply to the current video;
the next video resets to 100%. Muting remains independent. The volume slider
keeps its configured maximum, with the range above 100% shaded orange to red.
Changing **Maximum Volume** updates both the slider and mpv's amplification
limit immediately, including values above the original 130% cap. Lowering the
maximum clamps any currently boosted volume. Keyboard and wheel controls follow
the same setting, and changing videos keeps the maximum while resetting volume.

The top player navbar includes a **Picture-in-Picture** toggle beside fullscreen,
matching Loukious's icon and placement. It uses the community shell's existing
borderless, always-on-top mode, synchronized with the tray toggle. Exiting restores
the previous always-on-top preference. Fullscreen and picture-in-picture are
mutually exclusive. Long settings labels wrap, with more room before the options
column and stacked controls in narrow windows.

While a video is paused, the top bar, progress bar, playback controls, episode
drawer button, and pointer hide after one second without activity. The top bar
slides upward and the bottom controls downward over the selected duration, with their
shadows fading out. The episode drawer button fades without changing position.
Moving the mouse or using the keyboard slides the controls back in, including
when an exit animation is still in progress. Reduced-motion preferences skip
the animation. Open menus, loading/error messages,
slider drags, and keyboard focus on controls keep them usable. Subtitles remain
visible. The same slides apply during normal playback whenever the
community player hides or restores its controls, including mouse movement,
mouse exit and menu changes. Normal playback keeps the community player's
existing visibility timing and active-slider protection. Newly mounted toolbars
also slide into place. Changing pause state retains the animation rather than
removing its styles partway through. Reduced-motion preferences apply in both
playing and paused states.
Settings → Player → Controls → **Control animation speed** offers Off, 0.25 sec,
0.5 sec (default), 0.75 sec and 1 sec. Off makes showing and hiding instantaneous;
the inactivity delays are unchanged. The preference applies immediately and is
saved on this device in the fork's own local-storage entry, separate from the
community profile. If storage is unavailable it still applies for the session.
Other open windows receive saved changes; clearing the preference restores the
default. System reduced-motion preferences take priority over the selected speed.
This behavior lives in the isolated fork script; it does not patch the hosted
player bundle or change playback state.

Turning off **Auto play next episode** now also disables advancement when the
video ends and cancels an open next-episode countdown. Manual Next still works, and completion/watch-progress handling
remains intact. A scoped compatibility patch applies this setting check to the
hosted community player's end handler and refreshes it when the setting changes.
The original community UI and its other features remain hosted upstream. The
patch validates and applies autoplay, maximum-volume, and episode-blur fixes
independently. If upstream changes one feature, its code stays intact while the
other compatible fixes still apply. Every feature validates all of its edits
before committing them. A small amber indicator in the player lists unavailable
fixes, and the log records the compatibility failure. This is a compatibility
fallback, not a guarantee that future upstream implementations retain those fixes.
CI requires all three fixes to work against the live upstream bundle and checks
every combination of changed feature code before publishing, so source
updates that change this integration require review.
On the first launch of a changed compatibility patch, the app refreshes the
web player's CacheStorage before loading the UI. A patch fingerprint records
the migration; later launches reuse the refreshed cache. Local settings,
cookies, login storage and player configuration are preserved.

**Blur unwatched episodes image** protects alternate thumbnails as well as
primary images, in both the show page and the player's episode panel. This
includes anime that fall back from season-based to absolute episode numbering,
such as Inuyasha seasons after 2. The next-episode popup also keeps blur when
using an alternate image. Watched episodes remain clear in the episode lists;
marking one unwatched or changing the blur setting refreshes the image immediately.
Numbered specials (season or episode 0) are protected too. Non-episodic artwork
and generic placeholders keep their existing behavior. The fix preserves watch
history and uses the upstream setting and watched flags.

The native app, splash, installer/uninstaller, web UI branding, return button,
and default Discord logo use **#7272c2**. The original logo silhouettes, white
play symbols, transparency and wordmark lettering are retained. Movie artwork,
add-on logos and unrelated interface icons retain their own colors. Web branding
and the display button are embedded in the executable and work with the existing
hosted community UI without replacing that upstream project.

## Player shortcuts

Settings → Player Shortcuts lists every binding from the shipped input.conf,
including each Anime4K mode and Ctrl+8 for shader clearing. It also documents
Ctrl+B, Ctrl+Shift+C, Ctrl+Shift+F and the bundled Tab intro script. The list
describes shipped defaults; custom input.conf bindings may differ. The general
community keyboard shortcut section is retained. Browser tests compare the
catalog with input.conf and check readability and settings navigation.

## Keep upstream updates and fork changes

The fork's default development branch is `webview-windows`. A normal clone of
this fork includes the complete source. Create feature branches from that branch
and merge pull requests back after the build and test checks pass.

The original repository remains the upstream source. Fork features and build
policy live in separate files where practical. Merge upstream history into
the fork branch; Git preserves both sides and reports overlapping edits as
conflicts for review. Never replace the fork branch with upstream via a hard
reset, force push, or GitHub's discard-changes synchronization option.

```powershell
git remote add upstream https://github.com/Zaarrg/stremio-community-v5.git
git fetch upstream
git switch webview-windows
git merge upstream/webview-windows
```

Resolve any conflicts while retaining `src/mpv/ambient.*`, `src/mpv/display_mode.*`,
`src/webview/fork-player.js`, `cmake/ForkWebAssets.h.in`, the branded assets and
resource mappings, `src/mpv/playback_defaults.*`, `src/webview/player_bundle_patch.*`,
`src/webview/player_resources.*`, the integration calls, `cmake/ForkDefaults.cmake`, and the fork's workflow. Run the release
checks before publishing. Source updates cannot be guaranteed conflict-free.

Automatic application updates are disabled by default because the original
project's signed installers would replace this fork. Update using this fork's
releases until it has its own signing key and signed feed. A trusted signed
feed can be provided through `STREMIO_UPDATE_URL` at build time or the existing
`--autoupdater-endpoint` argument; signatures are still verified.

## Build and verify

GitHub Actions compiles x64 with MSVC and static vcpkg dependencies pinned in
`vcpkg.json` and `build/dependencies.lock.json`. It generates the MSVC import
library from the matching DLL and uses matching headers. FFmpeg and libplacebo
are updated with mpv. The FFmpeg/FFprobe tools use BtbN's dated 2026-10-05
build, N-127203-ga35c879992, with both utilities updated together. The
original project's tested streaming runtime is retained. A guarded build patch
updates the server's removed `-vsync` and legacy `-async` flags to `-fps_mode:v` and
the `aresample` filter. If a future server update changes that code, the build
stops for review rather than silently applying an incompatible patch.

For a local build, use an x64 Visual Studio Developer PowerShell with CMake,
Ninja, 7-Zip, Python, Node, vcpkg, and NSIS available. Run `build/prepare-fork.ps1`,
configure with `-DSTREMIO_MPV_DIR=<repo>/.build-cache/libmpv` and a vcpkg
toolchain, then build. Run CTest, `node --test tests/shortcut.test.js`, and
`python tests/mpv_smoke.py --dll .build-cache/libmpv/libmpv-2.dll --output .build-cache/render-test`.

Tests cover native mpv.conf parsing, live toggling, persisted state, restart,
unrelated configuration preservation, keyboard handling, and actual embedded
gpu-next rendering with blur on/off using D3D11's software renderer. Tests also
verify FFmpeg encoding, FFprobe metadata and streaming server startup. A release
tag matching `v*-mpv.*` publishes only after all build and test steps succeed.
Check hardware playback, HDR and streaming on the target machine as well.

Display tests also check native geometry changes, Fit/Crop/Stretch rendering at
two embedded host sizes, blur preservation, and the button in Edge. Browser tests
check acknowledgment, keyboard use, hiding with the toolbar, narrow-screen layout,
upstream toolbar recreation, new-video reset, and branding scope. The current UI
uses named CSS-module selectors; future toolbar changes may need a small adjustment
to the isolated script. The tray control continues to work independently.

The original app's Discord watching status and buttons are preserved through
a small SDK extension, tested against the actual compiled serializer.

The mpv publisher retains only 30 days of build archives. The release includes
the original checksum-verified dependency archives. The build script falls
back to those mirrors, keeping this commit buildable after upstream cleanup.

## Library and add-on backup

In Settings, use **Library & add-on backup → Export library & add-ons**.
The dated ZIP contains `Library.html` (readable offline, browser Find/Print),
`Library.csv` and `Addons.csv` (UTF-8 spreadsheets), and `Backup.json`.

This is a local snapshot of both `library` and `library_recent`, with newer
records winning by `_mtime`. Open Library and Add-ons while online first so
Stremio can synchronize its saved data. The export itself makes no network
requests and does not check account synchronization. It reports saved-title
and add-on counts and flags a missing library part. Unsupported data, account
mismatches and a locked add-on list fail visibly instead of silently truncating.

The report lists current saved titles and installed Stremio add-ons, preserving
add-on order and separate configurations. JSON also retains removed/temporary
records and available playback/watched state. It has a format ID and schema
version for future import tooling; automatic restore is not implemented.

Keep the ZIP and JSON private: configured add-on URLs can contain access keys.
Those URLs appear only in JSON. Stremio login credentials, account details and
unrelated local storage are never exported. This backs up Stremio add-ons,
not browser extensions or their internal settings.

The implementation is isolated in `src/webview/fork-backup.js` and embedded
with the existing fork script by CMake. It reads only the three expected
storage entries, adds its own Settings section, and leaves community-owned
DOM, stored data, playback and streaming code unchanged.

For a release, pass the successful Windows run ID, exact source SHA, and version
to the manual **Publish tested Windows build** workflow. A maintainer must
create the matching lightweight version tag at that tested SHA first. The
publisher checks the run, tag, file names and checksums before uploading those
exact artifacts. It no longer needs a publisher-only source commit.
