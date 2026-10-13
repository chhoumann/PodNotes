# Android phone verification

Run PodNotes in the real Obsidian Android app, capture the device screen, and
check persisted state. This recipe uses a phone profile on Linux with KVM, a
systemd user manager, Node 22, npm, `uv`, `jq`, and `flock`.

## Sub-features

- Build and deploy this checkout, load PodNotes, and open its visible player.
- Play a local vault audio file and add a feed through Settings.
- Capture a timestamp through the mobile toolbar and test dormant startup.
- Download the playing undownloaded remote episode of at least 150 MiB,
  checking the file, persisted registration, native memory, app/renderer
  survival, and that playback keeps its source and position.

## How to get to it (user POV)

Run from this worktree. The first setup downloads approximately 8 GB and is
bounded to 35 minutes. Run setup and download in an asynchronous terminal
session and poll it until exit; allow the full command timeout. Guest RAM is
4096 MiB; host RSS includes emulator overhead.

```bash
fnm use
npm run mobile:setup
npm run --silent mobile:verify
npm run mobile:screenshot -- .obsidian-e2e-artifacts/mobile/player.png
```

`verify` also boots a stopped emulator. It seeds the device vault from
`obsidian-e2e.config.mjs` `defaultData` only when `data.json` does not exist.
Repeated runs deploy the current bundle and preserve existing settings and data.
The JSON summary is saved in
`.obsidian-e2e-artifacts/mobile/session/verify.json`, including provisioning
writes and skips. Exit codes are 0 for pass, 2 for a failed assertion, and 1
for an infrastructure error.

If the T3 Device panel can open this SDK's emulator, use its returned
`agent-device` launcher and session flags for native input. Otherwise, use the
SDK's adb against **emulator-5554**. Never kill the global adb server.

## Driving it with ui.mjs

The desktop `ui.mjs` driver does not attach to this Android session. Use
`mobile:eval` for DOM inspection and registered commands, and native input
through the Device panel or serial-specific adb for user paths.

```bash
npm run --silent mobile:eval -- '({vault: app.vault.getName(), mobile: app.isMobile, version: app.plugins.plugins.podnotes?.manifest.version})'
npm run mobile:logs -- --seconds 20
npm run mobile:screenshot -- .obsidian-e2e-artifacts/mobile/check.png
```

For the issue checks:

1. **Local audio (#100):** push an audio file into `Media/` in this device
   vault, long-press its file-explorer entry, choose **Play with PodNotes**, and
   confirm playback time advances without a media error. Include spaces and
   `#` in the filename. Read persisted `localFiles` separately.
2. **Dormant startup (#110):** close the player, save the workspace layout,
   then force-stop and start `md.obsidian` three times. Verify PodNotes remains
   enabled, with zero `podcast_player_view` leaves and no player audio element
   before deliberately opening it.
3. **Mobile toolbar (#89):** configure **PodNotes: Capture Timestamp** in
   Obsidian's mobile toolbar settings, focus a note while an episode is loaded,
   and tap the toolbar button. Pull the Markdown separately to confirm its
   timestamp link was written.
4. **Add feed (#109):** in Settings > PodNotes, enter
   `https://lexfridman.com/feed/podcast/`, tap **Add**, and confirm **Remove**
   appears and the saved feed persists. This phone check does not prove a
   tablet layout.
5. **Large download (#113, #389):** open the podcast grid, select Lex Fridman
   Podcast and episode **#501 - DHH**, let it play, then run:

    ```bash
    npm run --silent mobile:download
    ```

    The 249,955,445-byte enclosure meets the probe's minimum. Choose another
    undownloaded episode of at least 150 MiB on subsequent runs. The probe runs
    the registered download command, waits for persisted registration, compares
    the native file stat with the registered size, and checks for partial files.
    It fails unless the same media element keeps its source, reports no media
    error, and advances 2 s past its position at registration. `playback` holds
    the element state before, at registration, and after.
    Reports and raw native samples go under
    `.obsidian-e2e-artifacts/mobile/download-<UTC>/`.

Capture screenshots after each action and confirm writes by reading
`.obsidian/plugins/podnotes/data.json` or the resulting note from the device.
Record the source commit, Obsidian and Android versions, device profile, feed
or file, input path, result, and relevant runtime errors.

## Gotchas

- One emulator runs on this host. The owning canonical worktree path persists
  between commands in `~/.cache/obsidian-mobile-debug/podnotes-session.json`.
  Every mobile command takes the host lock and refuses another owner.
- The SDK, AVD, APK, and verbose emulator log live under
  `~/.cache/obsidian-mobile-debug/`. Worktree output under
  `.obsidian-e2e-artifacts/mobile/` is ignored.
  Set `TMPDIR` to a directory on disk, not a shared tmpfs.
  CDP uses port 19333 to avoid desktop capture's port 9333. An occupied or
  foreign forward is an error.
- `setup` starts the app; `verify` opens this worktree's hashed device vault.
  Run `verify` before evaluating `app` on a fresh setup.
- Memory reports are app and sandboxed WebView renderer PSS before and after,
  not peak memory or a leak measurement. JavaScript heap readings are coarse
  supplemental values. Use `dumpsys meminfo --local PID`: ordinary renderer
  meminfo calls can crash this WebView version. The report requires exactly
  one Obsidian process and one sandboxed WebView renderer.
- First setup and later boots share an owned systemd launcher without
  emulator snapshots. An interrupted setup can be stopped with `mobile:stop`.
  Stop terminates the owned setup service and its children before qemu.
  Keep the phone size and density fixed. A phone result does not settle iOS
  or iPadOS reports. Use a separate tablet profile only in a separate session.
- Stop even after a failed probe, then confirm no owned qemu/emulator remains:

    ```bash
    npm run mobile:stop
    ```

    Stop preserves the AVD and device vaults. It prints the service's result.
    An uncertain shutdown retains the ownership record for inspection.
