# [PodNotes](https://chhoumann.github.io/PodNotes)

<img src="https://github.com/chhoumann/PodNotes/blob/master/docs/docs/resources/podcast_grid_big.png" alt="Podcast grid" align="center">

<h3 align="center">You can find the documentation <a href="https://chhoumann.github.io/PodNotes">here</a>.</h3>

## Demo Video
[![Demo video](https://img.youtube.com/vi/SGLfuN15uJY/0.jpg)](https://www.youtube.com/watch?v=SGLfuN15uJY)

---

The one goal for PodNotes is to make it easier to write notes on podcasts.

Here are the features that will help you do that 👇.

## Features

- Mobile friendly — works on iOS and Android, including offline playback of local files and downloads
- Podcast player built into Obsidian, for both audio and video episodes
- Add any publicly available podcast through search, or custom feeds by URL
- Track played episodes & playback progress, with continuous resume
- Create podcast notes from templates with rich metadata about episodes
- Bases-friendly default notes you can sort, filter, and group with [Obsidian Bases](https://help.obsidian.md/bases)
- Create a feed note for an entire podcast that every episode note links back to
- Capture timestamps & link directly to the time in the episode
- Transcribe episodes, with optional speaker labels (diarization)
- Download episodes for offline playback
- Support for non-podcast local audio and video files
- API that can be used by plugins like [QuickAdd](https://github.com/chhoumann/QuickAdd) or [Templater](https://github.com/silentvoid13/Templater) for custom workflows

## Installation

**This plugin is in the Obsidian community plugin store. You can find it by searching in the store.**

Other installation options can be found in the [documentation](https://chhoumann.github.io/PodNotes).

## Development

- `npm run test` runs the accessibility checks and the jsdom/unit test suite.
- `npm run build` type-checks and bundles the plugin.
- `npm run test:e2e` builds the plugin, then runs the local Obsidian-backed E2E suite.

The E2E suite is local-only. It depends on Obsidian being installed, the
`obsidian` CLI being available on `PATH`, and the target vault being open and
reachable. The default target vault is `dev`; override it with
`PODNOTES_E2E_VAULT` when needed. Failed E2E runs may write artifacts to
`.obsidian-e2e-artifacts/`.

Before running E2E, make sure the target vault's
`.obsidian/plugins/podnotes/main.js` and `manifest.json` symlinks point at this
checkout. The tests intentionally fail during preflight instead of relinking the
vault automatically.

## Screenshots

### Demo

![Demo](docs/docs/resources/demo.gif)

### Podcast Grid

![Podcast Grid](docs/docs/resources/podcast_grid.png)

### Episode List

![Episode List](docs/docs/resources/episode_list.png)

### Player

![Player](docs/docs/resources/player.png)

### Episode notes (Bases-friendly)

![Episode note](docs/docs/resources/podcast_note.png)

### Timestamps

![Timestamps](docs/docs/resources/timestamps.png)

### Transcripts with speaker labels

![Transcript with speaker labels](docs/docs/resources/transcript_diarization.png)

### Browse your library with Bases

![Bases view of episode notes](docs/docs/resources/bases_view.png)

### Podcast search

![Podcast Search](docs/docs/resources/podcast_search.png)
