# Local files

A user plays an audio or video file that lives in the vault by right-clicking
it and choosing "Play with PodNotes". The file plays in the PodNotes player
and appears in the Local Files playlist.

## Sub-features

- `local-menu` adds `Play with PodNotes` to the file menu of audio and video files (`Play as audio` and `Play as video` for ambiguous containers such as `.mp4`).
- `local-play` opens the player with the file's basename as the title and `local file` as the podcast.
- `local-playlist` lists the file in the `Local Files` playlist card and its episode list.
- `local-replay` restarts a finished local file when it is played again.

## How to get to it (user POV)

- Right-click the file in the file explorer, then `Play with PodNotes`.
- Open the file, then the tab's `More options` menu, then `Play with PodNotes`.
- In the PodNotes view, click the grid button, then the `Local Files` card.

## Driving it with ui.mjs

Preconditions:

- The `file-explorer` core plugin is enabled.
- `node .claude/skills/verify/fixtures.mjs audio` wrote `Fixtures/Local Fixture.wav` into the vault.

- **Show the file.** Run `CLI command id=file-explorer:open` and `UI click '.nav-folder-title[data-path="Fixtures"]'`. `.nav-file-title[data-path="Fixtures/Local Fixture.wav"]` is visible.
- **Open the file menu.** Run `UI click '.nav-file-title[data-path="Fixtures/Local Fixture.wav"]' --right`. A menu with `Play with PodNotes` between `Show in system explorer` and `Rename...` appears.
- **Play.** Run `UI click '.menu .menu-item' --text 'Play with PodNotes'`. The player opens, `api.podcast.title` is `Local Fixture`, `api.podcast.podcastName` is `local file`, and `api.currentTime` advances.
- **Playlist.** Run `UI click '.podcast-view [aria-label="Podcast grid"]'`. The `Local Files` card reads `(1)`, and `data.json` `localFiles.episodes[0].filePath` is `Fixtures/Local Fixture.wav`.
- **Proof.** Run `npm run capture:e2e-obsidian -- screenshot .obsidian-e2e-artifacts/local-files/menu.png` with the menu open, then `npm run screenshot:e2e-obsidian -- .obsidian-e2e-artifacts/local-files/playing.png`.

## Gotchas

- Every core plugin is off in a fresh vault, so there is no file explorer until you enable `file-explorer`.
- The folder is collapsed after a reload. Click it open before looking for the file.
- A second local file with the same basename replaces the first in the playlist and shows a Notice.
