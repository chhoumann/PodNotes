# Feeds

A user subscribes to a podcast by pasting its feed URL into Settings >
PodNotes, sees it in the view's podcast grid, browses its episodes, and can
remove it again from Settings.

## Sub-features

- `feed-search-url` loads a feed from a pasted http(s) feed URL and shows a result card.
- `feed-add` saves the podcast, and the card's button turns into Remove.
- `feed-browse` shows the podcast in the grid and its episodes, newest first.
- `feed-remove` deletes the podcast from Settings and from the grid.
- `feed-search-name` searches podcasts by name through the iTunes API (network; skip offline).

## How to get to it (user POV)

- Open Settings (`Ctrl+,` or the gear), then select `PodNotes` under Community plugins.
- Type or paste into `Search or enter feed URL...` under `Search Podcasts`.
- In the PodNotes view, click the grid button, then the podcast's artwork.

## Driving it with ui.mjs

Preconditions:

- `FEED=$(node .claude/skills/verify/fixtures.mjs feed)` prints `http://127.0.0.1.nip.io:<port>/feed.xml`.
- `PodNotes Fixture` is not saved yet (`jq '.savedFeeds | keys' <data.json>` lacks it).

- **Open Settings.** Run `CLI command id=app:open-settings` and `UI click '.modal.mod-settings .vertical-tab-nav-item' --text PodNotes`. The `Search Podcasts` heading and the search input are visible.
- **Load the feed.** Run `UI fill 'input[placeholder="Search or enter feed URL..."]' "$FEED"`. A card titled `PodNotes Fixture`, with purple artwork and an `Add` button labelled `Add PodNotes Fixture podcast`, appears within about 1 s.
- **Add it.** Run `UI click '[aria-label="Add PodNotes Fixture podcast"]'`. The button becomes `Remove PodNotes Fixture podcast`, and after about 2 s `data.json` `savedFeeds["PodNotes Fixture"].url` equals `$FEED`.
- **Close Settings.** Run `UI click '.modal.mod-settings .modal-header-button'`.
- **Browse.** Run `CLI command id=podnotes:podnotes-show-leaf`, `UI click '.podcast-view [aria-label="Podcast grid"]'`, `UI click '.podcast-view .pn_image_container:has(img[alt="PodNotes Fixture"])'`. The header reads `PodNotes Fixture`, and the list shows `Fixture Episode 2` (`10 OCTOBER 2026`) above `Fixture Episode 1` (`09 OCTOBER 2026`).
- **Remove it.** Reopen Settings > PodNotes with the search input empty, and run `UI click '[aria-label="Remove PodNotes Fixture podcast"]'`. `savedFeeds` no longer has it, and the grid shows `No saved podcasts.`.
- **Proof.** Run `npm run capture:e2e-obsidian -- screenshot .obsidian-e2e-artifacts/feeds/settings.png --modal` with the result card showing, then `npm run screenshot:e2e-obsidian -- .obsidian-e2e-artifacts/feeds/episodes.png` on the episode list, and save the `savedFeeds` read.

## Gotchas

- PodNotes refuses literal loopback and private hosts (`127.0.0.1`, `localhost`, `*.local`). The fixture URL uses `127.0.0.1.nip.io`, which needs working DNS. If it does not resolve, report the feed path as unreachable instead of editing `data.json`.
- Escape inside a focused settings field does not close Settings. Click `.modal.mod-settings .modal-header-button`.
- The search input debounces for 300 ms. Wait for the result card, not a fixed time.
- The fixture port is fixed per worktree. A saved fixture feed keeps working after `fixtures.mjs stop` and `feed`, but not in another worktree.
