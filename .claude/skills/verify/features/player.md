# Player and playback

The PodNotes view lives in the right sidebar. A user opens it, picks an episode
from a podcast's episode list, and the player shows artwork, title, progress,
skip buttons, and volume and rate sliders while the audio plays.

## Sub-features

- `player-open` opens and reveals the view from the ribbon and from the "Show player" command.
- `player-play` starts a feed episode from its episode list.
- `player-toggle` pauses and resumes from the artwork button and the "Toggle playback" command.
- `player-skip` moves back and forward by the configured skip lengths (15 s by default).
- `player-seek` jumps to a position from a click on the progress bar.
- `player-rate` changes the playback rate from the slider and the rate commands.

## How to get to it (user POV)

- Click the podcast icon in the left ribbon (`Show PodNotes`).
- Run `PodNotes: Show player` from the command palette.
- In the view, click the grid button, a podcast, then an episode.
- Run `PodNotes: Toggle playback`, `Increase playback rate`, `Decrease playback rate` or `Reset playback rate`.

## Driving it with ui.mjs

Preconditions:

- `PodNotes Fixture` is saved ([feeds.md](./feeds.md)) and its episodes are unplayed.
- The fixture server answers: `node .claude/skills/verify/fixtures.mjs feed`.

- **Open from the ribbon.** Run `UI click '.side-dock-ribbon-action[aria-label="Show PodNotes"]'`. `.workspace-leaf-content[data-type="podcast_player_view"]` is visible.
- **Open from the palette.** Run `UI key Ctrl+p`, `UI type .prompt-input 'Show player'`, `UI click .suggestion-item --text 'Show player'`. The same view is revealed, with no second PodNotes leaf (`CLI eval code='app.workspace.getLeavesOfType("podcast_player_view").length'` is `=> 1`).
- **Play an episode.** Run `UI click '.podcast-view [aria-label="Podcast grid"]'`, `UI click '.podcast-view .pn_image_container:has(img[alt="PodNotes Fixture"])'`, `UI click '.podcast-view .podcast-episode-item' --text 'Fixture Episode 1'`. The `Player` tab is selected, the title reads `Fixture Episode 1`, and after a few seconds `api.isPlaying` is true and `api.currentTime` grows.
- **Toggle.** Run `UI click '.podcast-view [aria-label="Toggle playback"]'`. `api.isPlaying` flips and `api.currentTime` stops advancing.
- **Skip.** Run `UI click '.podcast-view .controls-container > :last-child button'` (forward) or `'.podcast-view .controls-container > :first-child button'` (backward). `api.currentTime` moves by 15 s, clamped to the episode.
- **Seek.** Run `UI click '.podcast-view [aria-label="Seek within episode"]'`. It clicks the bar's center, so `api.currentTime` lands near 30 s of the 60 s fixture.
- **Rate.** Run `CLI command id=podnotes:increase-playback-rate`. `api.playbackRate` and the label in `.playbackrate-container` both increase.
- **Proof.** Run `npm run screenshot:e2e-obsidian -- .obsidian-e2e-artifacts/player/playing.png` while it plays, and record a toggle or skip with `npm run record:e2e-obsidian -- .obsidian-e2e-artifacts/player/flow.mp4 -- <driver>`. Read `jq '.playedEpisodes' <data.json>` for the stored position.

## Gotchas

- Clicking a finished episode resumes it at its end. That fires `ended` at once, and the queue auto-advances to another episode. Use unplayed episodes or a fresh vault.
- With `Keep a queue of episodes you switch away from` on (the default), switching episodes queues the previous one, and it plays again when the current one ends.
- The skip buttons have no accessible name. Address them by position inside `.controls-container`.
- The playback-rate slider renders at 1.5 while the real rate is 1x. Assert on `api.playbackRate` or the rate label, not the slider.
- Headless Obsidian plays to a null audio sink. Prove playback through `api.currentTime` advancing, not by sound.
