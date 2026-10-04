# Powermove 1.1.0 for Windows (x64)

## 1.1.0-windows.4 hotfix

- **About box shows the real version**: Electron's built-in Windows About
  panel prints the numeric file version (`1.1.0.0`), never the prerelease
  version. Windows now gets its own About dialog with the true app version
  plus the runtime versions. macOS keeps the native panel.

## 1.1.0-windows.3 hotfix — fixes the white screen

- **Root cause found and fixed**: on machines whose Windows locale resolves
  empty, Chromium crashed natively the moment any file picker element was
  created (e.g. at editor startup) — an upstream Blink bug
  (`LCIDFromLocaleInternal` dereferencing a null locale). **Electron
  44.0.0 → 44.5.1**, which no longer crashes there: the app now starts
  normally on affected machines.
- The 1.1.0-windows.1 safety nets stay in place: any future native renderer
  death restarts once with software rendering, and local crash dumps are
  recorded (never uploaded) for diagnosis.

## 1.1.0-windows.2 hotfix

- **Renderer deaths now trigger software-rendering fallback**: any abnormal
  renderer death (native crash, external kill e.g. by antivirus, out of
  memory) restarts the app once with `--disable-gpu` instead of stranding it
  on a blank window. A second failure is left alone for diagnosis, so it can
  never restart-loop.
- **Local crash dumps**: native crashes are now recorded (never uploaded) so
  the cause can be identified from the `.dmp` file. The log prints the
  `crash dumps:` folder at startup; on Windows it is
  `%APPDATA%\Powermove\Crashpad\reports`.

## 1.1.0-windows.1 hotfix

- **First launch no longer ends on a blank window**: agent resource setup
  (Codex/Claude skills, rules, hooks) used Unix symlinks, which Windows
  blocks without Developer Mode. Directories are now shared as junctions
  and files as hard links (copies across drives) — no privileges needed.
  The same fix covers media import (image sequences, animation frames,
  preview naming), which used symlinks the same way.
- **A crashed renderer no longer strands the app**: if the renderer process
  dies natively (e.g. a broken GPU driver), Powermove now restarts itself
  once with software rendering instead of sitting on a white page with dead
  menus and an unresponsive close button.
- **Native window frame**: the macOS hidden titlebar and vibrant canvas are
  now macOS-only; Windows uses its standard frame with working caption
  buttons.
- **Auto-updates check the right repository**: update checks now read this
  fork's releases instead of upstream's macOS feed.

This is the first Windows release of Powermove: the complete 1.1.0 editor,
ported 1-to-1 from macOS. Everything below 1.1.0 already shipped upstream;
the Windows port adds native Windows packaging and platform support on top.

## Install

1. Download `Powermove-1.1.0-windows-win-x64-setup.exe` below and run it.
2. Windows SmartScreen will warn that the publisher is unknown — this build
   is unsigned. Click **More info → Run anyway**.
3. The installer offers per-user or machine-wide install, Start Menu and
   Desktop shortcuts, opens `.pmv` project files, and registers the
   `powermove://` sign-in link.

Signed with a certificate in a later release; until then, updates arrive
through the built-in updater (NSIS) exactly like on macOS.

## Windows support (new in this release)

- **Native installer**: NSIS setup with install-directory choice, Start Menu
  and Desktop shortcuts, `.pmv` file association, and `powermove://` protocol.
- **Built-in agent runtimes**: the same Claude and Codex runtimes ship inside
  the installer as Windows (`win32-x64`) binaries, with automatic discovery
  and self-updating to newer runtime versions, just like macOS.
- **Auto-updates**: update checks, download, and quit-to-install work through
  the in-app Updates UI.
- **Fonts**: installed Windows fonts are enumerated for the editor's font
  picker via the system font collection.
- **Agent commands** run through `cmd.exe` with the user's `PATH` plus the
  usual tool locations (bun, Node.js, Git). Project workspaces keep their
  path checks, caches, and process cleanup.
- **Encoder**: Windows `ffmpeg.exe` ships in the package for export.

Known macOS-only differences (no Windows equivalent exists):

- Project-command filesystem sandboxing (`sandbox-exec` seatbelts) is macOS
  only. On Windows, Project commands run directly in the workspace — file
  tools still confine themselves to the project folder, but there is no OS
  seatbelt beyond that.
- Trackpad alignment haptics and iCloud file states are macOS-only; on
  Windows they gracefully report "unknown"/unavailable.
- `powermove install` (stay-running service) supports systemd (Linux) and
  launchd (macOS) only.

## Everything in 1.1.0 (upstream, all platforms)

### 1.1.0 — Cloud and extension store
- Powermove Cloud with Google sign-in: browser sign-in finishes via the
  `powermove://` link; the matching backend deploys with each app release.
- Extension store with sandbox-safe browsing, installation, and publishing.
- Sandbox v2: per-extension processes with watchdog and pull-based reads;
  reading the project needs no permission; agents keep full internet and
  file access while only extensions stay sandboxed.
- Store collections behind a flag; built-in effects, inspector, timeline,
  and viewer updates.

### 1.0.5
- Restored Powermove MCP tools for Claude runs.

### 1.0.4
- Lower memory retention; synchronized layered video playback.
- Safer media confirmations, fully undoable scope-expanding transactions,
  preserved redo history on a lower memory budget, faster timeline row
  rebuilds in large grouped timelines.
- Agent mod capabilities, desktop recovery, website refresh.
- Fixed effect text rendering at high zoom; layer mask icon.
- Relicensed under AGPL-3.0-or-later.
- Rerelease: fixed intermittent image-sequence import failures on encoder
  startup (rebuilt and re-signed; reinstall if you have the first 1.0.4).

### 1.0.3 — Remote host (`npx powermove serve`)
- Run the editor from a browser on any device; LAN/Tailscale addresses,
  HTTPS by default, upload progress, parallel chunks.
- Install the host as a user service (systemd/launchd); fonts, media, and
  engine follow the project between devices and host.
- `powermove-cli` on npm with one-line install and self-updates.
- Export-location prompt; media-panel loading states.

### 1.0.1 — Editing feedback and agent composer
- Save/import progress with green success check; fonts appear without
  restart; correct GIF/video scrub previews; keyframes land on the playhead
  frame.
- Inline attachment badges with select/move/undo; no re-serialization on
  every keystroke; activity marks only affected controls.
- Live editor tools in hardened production builds; extension-compat
  update notices.

### 1.0.0 — First stable release
- Athas-style agent composer, titlebar tabs, full-width font field.
- Hidden project backups, `.pmv` file association, native menus and
  confirm sheets, panel polish, export dialog redesign.
- Timeline editing, video playback, and performance improvements.

Full per-PR history: https://github.com/iterative-computer/powermove/releases
