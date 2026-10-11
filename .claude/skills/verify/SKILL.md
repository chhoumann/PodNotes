---
name: verify
description: Drive PodNotes in a real Obsidian (headless on Linux, isolated per worktree) the way a user does, and capture screenshot and video evidence. Use to prove or reproduce PodNotes behavior end to end - the player and playback, timestamps and obsidian://podnotes URIs, feeds added in Settings, local files, episode notes. Not for the unit suite (npm run test) or the tests/e2e suite (npm run test:e2e).
---

# Verify PodNotes in real Obsidian

Every command runs from the worktree root. The instance, vault, CLI socket and
profile belong to this worktree only. Never drive the shared `dev` vault or
another worktree's Obsidian. AGENTS.md "Obsidian Runtime Workflow" explains the
machinery. Feature recipes are in [features/README.md](features/README.md).

## Launch

```bash
fnm use && npm ci                # once per worktree
npm run build                    # the vault links the root main.js
npm run start:e2e-obsidian       # start, or reuse and reload PodNotes
```

Ready when it prints `Obsidian instance launched for "podnotes-<worktree>"` (or
`reused`). After every later rebuild, reload explicitly. A plain
`obsidian:e2e` attaches to the warm instance without reloading the plugin:

```bash
npm run build && npm run obsidian:e2e -- --reload eval code='app.plugins.plugins.podnotes.manifest.version'
```

A fresh vault (`.obsidian-e2e-vaults/podnotes-<worktree>/`) has PodNotes'
default settings and every core plugin off. Turn on what the user paths below
need, once per vault:

```bash
npm run obsidian:e2e -- plugin:enable id=command-palette filter=core
npm run obsidian:e2e -- plugin:enable id=file-explorer filter=core
```

Start from a clean vault whenever earlier state could matter (a played or
finished episode, a saved feed, an interrupted `test:e2e` run):

```bash
npm run stop:e2e-obsidian && rm -rf .obsidian-e2e-vaults && npm run start:e2e-obsidian
```

## Doctor

Run this first, and again whenever something looks off:

```bash
npm run obsidian:e2e -- eval code='JSON.stringify({vault: app.vault.getName(), version: app.plugins.plugins.podnotes?.manifest.version, api: Boolean(app.plugins.plugins.podnotes?.api), uri: Boolean((app.workspace.protocolHandlers ?? app.workspace.protocolHandler?.handlers)?.has("podnotes"))})'
npm run obsidian:e2e -- dev:errors
npm run obsidian:e2e -- version
```

Expect `vault` `podnotes-<worktree>`, `api` and `uri` true, and no PodNotes
errors. If you rebuilt since the last `--reload`, the instance runs the old
bundle: reload before trusting anything.

## Drive

Drive through what a user touches: the PodNotes view, Settings, the command
palette, the file menu, links in notes. Reach for internal setters only to
read state.

- **UI.** `node .claude/skills/verify/ui.mjs` sends real mouse and keyboard
  events to the running instance. `click`, `type`, `fill` and `wait` wait up
  to 10 s for exactly one visible match. `key` and `uri` do not wait:

    ```bash
    node .claude/skills/verify/ui.mjs click '.podcast-view [aria-label="Podcast grid"]'
    node .claude/skills/verify/ui.mjs click '.podcast-view .podcast-episode-item' --text 'Fixture Episode 1'
    node .claude/skills/verify/ui.mjs click '.nav-file-title[data-path="Fixtures/Local Fixture.wav"]' --right
    node .claude/skills/verify/ui.mjs fill 'input[placeholder="Search or enter feed URL..."]' "$FEED"
    node .claude/skills/verify/ui.mjs key Escape
    node .claude/skills/verify/ui.mjs wait '[aria-label="Remove PodNotes Fixture podcast"]'
    ```

- **Commands.** The user path is the palette. The command name is the
  `--text` filter, without the `PodNotes:` prefix:

    ```bash
    node .claude/skills/verify/ui.mjs key Ctrl+p
    node .claude/skills/verify/ui.mjs type .prompt-input 'Show player'
    node .claude/skills/verify/ui.mjs click .suggestion-item --text 'Show player'
    ```

    The direct path is `npm run obsidian:e2e -- command id=podnotes:podnotes-show-leaf`.
    Command ids are in `src/commands.ts`. Editor commands such as
    `capture-timestamp` only exist while a Markdown editor is focused.

- **URIs.** Click the link in a note (Reading view), or deliver it the way
  Obsidian does when the OS hands it over:
  `node .claude/skills/verify/ui.mjs uri 'obsidian://podnotes?episodeName=...&url=...&time=12'`.
  Never run `xdg-open obsidian://...` from your shell: it reaches the system
  Obsidian profile, not this instance.

- **Fixtures.** `node .claude/skills/verify/fixtures.mjs feed` serves the
  `PodNotes Fixture` podcast from 127.0.0.1 and prints its feed URL. It has
  `Fixture Episode 1` and `Fixture Episode 2`, 60 s WAV enclosures each.
  `node .claude/skills/verify/fixtures.mjs audio` writes
  `Fixtures/Local Fixture.wav` (60 s) into the vault.

- **Runtime state.** `app.plugins.plugins.podnotes.api` has `podcast`,
  `isPlaying`, `currentTime`, `length`, `playbackRate` and `volume`:

    ```bash
    npm run obsidian:e2e -- eval code='JSON.stringify({episode: app.plugins.plugins.podnotes.api.podcast?.title, playing: app.plugins.plugins.podnotes.api.isPlaying, time: app.plugins.plugins.podnotes.api.currentTime})'
    ```

- **Stored state.** Read `data.json` on disk. `savedFeeds` is keyed by feed
  title. `playedEpisodes` is keyed by `<podcast>::<title>` and holds `time`,
  `duration` and `finished`. `queue`, `favorites` and `localFiles` hold
  `.episodes`. `timestamp.template` holds the capture format. Saves land about
  2 s after the change:

    ```bash
    jq '{feeds: (.savedFeeds | keys), current: .currentEpisode.title, played: .playedEpisodes}' .obsidian-e2e-vaults/*/.obsidian/plugins/podnotes/data.json
    npm run obsidian:e2e -- read path='Verify/Timestamps.md'
    ```

`obsidian eval` exits 0 even when the code throws. Read the output: a value
starts with `=> `, a failure with `Error:`.

## Evidence

Write evidence under `.obsidian-e2e-artifacts/<feature>/`. The folder is
git-ignored, and neither `stop` nor a vault reset touches it.

```bash
npm run screenshot:e2e-obsidian -- .obsidian-e2e-artifacts/player/playing.png       # the PodNotes view
npm run capture:e2e-obsidian -- screenshot .obsidian-e2e-artifacts/feeds/settings.png --modal
npm run capture:e2e-obsidian -- screenshot .obsidian-e2e-artifacts/notes/window.png  # whole window
npm run record:e2e-obsidian -- .obsidian-e2e-artifacts/player/flow.mp4 -- .obsidian-e2e-artifacts/player/drive.sh
npm run capture:e2e-obsidian -- sheet .obsidian-e2e-artifacts/player/flow.mp4 .obsidian-e2e-artifacts/player/flow-sheet.png
```

`screenshot` and `record` open the player first and fail without capturing
when it does not open. `record` then records the window while the driver runs.
The driver is an executable script of `ui.mjs` and `obsidian:e2e` calls with short
`sleep`s between steps. A driver that exits non-zero discards the take.
Without a driver, `record` takes 3 s.

A proof holds when it meets these standards:

- It drives the user path from the feature file, not an internal setter.
- It captures the action and the resulting state, not only the final screen.
- It checks side effects with a second read: `data.json`, the note on disk,
  `api` state.
- It records the Obsidian version, the feed URL or local file, and the exact
  commands.
- You opened every PNG, and a contact sheet or frame of every video, and saw
  the behavior in it. Report anything that looks off in the UI.

## Cleanup

```bash
node .claude/skills/verify/fixtures.mjs stop
npm run stop:e2e-obsidian
npm run stop:e2e-obsidian -- --dry-run      # expect "pids: none"
```

`stop` ends only this worktree's process tree (Obsidian and Xvfb) and removes
its profile. It keeps the vault and `.obsidian-e2e-artifacts/`. Delete
`.obsidian-e2e-vaults` too when the next run should start clean.

## Helpers

- `.claude/skills/verify/ui.mjs` sends trusted input through
  `obsidian dev:cdp`. Its verbs are `click <css> [--text <s>] [--right]`,
  `type <css> <text>` (insert at the cursor), `fill <css> <text>` (replace),
  `key <Enter|Escape|Tab|ArrowUp|ArrowDown|Backspace|<char>|Ctrl+<char>>`,
  `wait <css> [--text <s>]`, and `uri <obsidian://...>`. `click`, `type`,
  `fill` and `wait` wait up to 10 s; `--timeout <ms>` changes that. `key` and
  `uri` do not wait. Each CLI call fails after 15 s without an answer.
- `.claude/skills/verify/fixtures.mjs` runs as `feed`, `audio [vault path]` or
  `stop`. The feed URL uses `127.0.0.1.nip.io`, a public DNS name for
  127.0.0.1, because PodNotes refuses literal loopback hosts. Its port is fixed
  per worktree, so a saved feed survives a server restart.
