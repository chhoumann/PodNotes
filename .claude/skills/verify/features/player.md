# Player and playback

The PodNotes view lives in the right sidebar. A user opens it, picks an episode
from a podcast's episode list, and the full player opens over the view with
artwork, title, progress, skip buttons, and volume and rate sliders while the
audio plays. Collapsing it leaves the mini player at the bottom of every page.

## Sub-features

- `player-open` reveals the view from the ribbon, and opens the full player from the "Show player" command.
- `player-collapse` collapses the full player to the mini player from its chevron or Escape, and opens it again from the mini player, without pausing.
- `player-play` starts a feed episode from its episode list.
- `player-toggle` pauses and resumes from the artwork button and the "Toggle playback" command.
- `player-skip` moves back and forward by the configured skip lengths (15 s by default).
- `player-seek` jumps to a position from a click on the progress bar.
- `player-rate` changes the playback rate from the slider and the rate commands.

## How to get to it (user POV)

- Click the podcast icon in the left ribbon (`Show PodNotes`).
- Run `PodNotes: Show player` from the command palette.
- In the view, go Back to the Library, click a podcast's card, then an episode.
- Click the chevron at the top of the full player, or press Escape, to collapse it. Click the mini player's title to open it again.
- Run `PodNotes: Toggle playback`, `Increase playback rate`, `Decrease playback rate` or `Reset playback rate`.

## Driving it with ui.mjs

Preconditions:

- `PodNotes Fixture` is saved ([feeds.md](./feeds.md)) and its episodes are unplayed.
- The fixture server answers: `node .claude/skills/verify/fixtures.mjs feed`.

- **Open from the ribbon.** Run `UI click '.side-dock-ribbon-action[aria-label="Show PodNotes"]'`. `.workspace-leaf-content[data-type="podcast_player_view"]` is visible.
- **Open from the palette.** Run `UI key Ctrl+p`, `UI type .prompt-input 'Show player'`, `UI click .suggestion-item --text 'Show player'`. The same view is revealed, with no second PodNotes leaf (`CLI eval code='app.workspace.getLeavesOfType("podcast_player_view").length'` is `=> 1`). With an episode loaded, the full player (`.podcast-view section.pn-player`) covers the view.
- **Play an episode.** On the Library (`UI click '.podcast-view .pn-head button[aria-label^="Back to"]'` until `h1.pn-head-title` reads `Library`), run `UI click '.podcast-view button.pn-gridcard[aria-label="PodNotes Fixture"]'` and `UI click '.podcast-view .pn-ep-main' --text 'Fixture Episode 1'`. The full player opens with the title `Fixture Episode 1`, and after a few seconds `api.isPlaying` is true and `api.currentTime` grows.
- **Collapse and open.** Run `UI click '.podcast-view [aria-label="Collapse player"]'` or `UI key Escape`. The mini player (`.podcast-view section.pn-mini`) shows the episode and `api.isPlaying` stays true. Run `UI click '.podcast-view .pn-mini-open'` to open the full player again.
- **Toggle.** Run `UI click '.podcast-view [aria-label="Toggle playback"]'`. `api.isPlaying` flips and `api.currentTime` stops advancing.
- **Skip.** Run `UI click '.podcast-view .controls-container > :last-child button'` (forward) or `'.podcast-view .controls-container > :first-child button'` (backward). `api.currentTime` moves by 15 s, clamped to the episode.
- **Seek.** Run `UI click '.podcast-view [aria-label="Seek within episode"]'`. It clicks the bar's center, so `api.currentTime` lands near 30 s of the 60 s fixture.
- **Rate.** Run `CLI command id=podnotes:increase-playback-rate`. `api.playbackRate` and the label in `.playbackrate-container` both increase.
- **Proof.** Run `npm run screenshot:e2e-obsidian -- .obsidian-e2e-artifacts/player/playing.png` while it plays, and record a toggle or skip with `npm run record:e2e-obsidian -- .obsidian-e2e-artifacts/player/flow.mp4 -- <driver>`. Read `jq '.playedEpisodes' <data.json>` for the stored position.

## Gotchas

- Playing a finished episode starts it over at 0.
- Audio keeps playing on every page, with the full player collapsed, in settings, and with the view closed. The one media element is `audio.podnotes-media` (or `video.podnotes-media`) in the main window, not inside the view.
- After a restart the view opens on its last page, and the mini player shows the last episode paused at its saved position. Nothing loads or plays until you press play. A sync that lands before then updates the shown episode and position, unless you moved the position.
- A video plays in the main window only. With the view in a popout, the player shows the artwork and the video keeps playing hidden in the main window.
- With `Keep a queue of episodes you switch away from` on (the default), switching episodes queues the previous one, and it plays again when the current one ends.
- The skip buttons have no accessible name. Address them by position inside `.controls-container`.
- Headless Obsidian plays to a null audio sink. Prove playback through `api.currentTime` advancing, not by sound.
