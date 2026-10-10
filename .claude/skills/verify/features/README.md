# PodNotes verification map

This directory is the maintained source for verifying PodNotes' user-facing
behavior in real Obsidian. Read the index, then use the matching feature file
as the recipe. [../SKILL.md](../SKILL.md) covers launch, doctor, evidence and
cleanup.

## Baseline preconditions

- This worktree's instance is running and the doctor check passes.
- The vault is fresh, or its state cannot affect the feature you prove.
- The `command-palette` and `file-explorer` core plugins are enabled.
- Recipes that need a feed have run `node .claude/skills/verify/fixtures.mjs feed`
  and added `PodNotes Fixture` through Settings ([feeds.md](./feeds.md)).

## Driving conventions

- `UI` means `node .claude/skills/verify/ui.mjs`. `CLI` means
  `npm run obsidian:e2e --`.
- Prefer `aria-label`s, `data-path` and `data-type` attributes, and visible
  text (`--text`) over DOM position.
- Run a command through the palette (`Ctrl+p`) for the user path and through
  `CLI command id=podnotes:<id>` for the direct path. Prove both when the
  change touches the command.
- Wait for the state you expect (`UI wait`, a `data.json` read) instead of a
  fixed sleep. A bare `sleep` belongs only in a recording driver.

## Proof and skip reporting

- Save artifacts under `.obsidian-e2e-artifacts/<feature>/`.
- Capture the user action and the resulting state, and confirm side effects
  with a second read (`data.json`, the note on disk, `api` state).
- Name the feature file and the entry point with every artifact.
- Report an unreachable path with the command you ran and the unmet
  precondition. Never report a skipped entry point as verified through another.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph on the user-visible
behavior, followed by exactly four H2s in this order: `Sub-features`,
`How to get to it (user POV)`, `Driving it with ui.mjs`, `Gotchas`.

## Features

- [Player and playback](./player.md) covers opening the view, playing a feed
  episode, toggling, skipping and seeking.
- [Feeds](./feeds.md) covers adding and removing a podcast by feed URL in
  Settings > PodNotes, and browsing its episodes.
- [Timestamps and URIs](./timestamps-uris.md) covers capturing timestamps and
  segments into a note and reopening episodes from `obsidian://podnotes` links.
- [Local files](./local-files.md) covers "Play with PodNotes" on a vault audio
  file and the Local Files playlist.
- [Episode notes](./episode-notes.md) covers creating a note for the playing
  episode from its template.
