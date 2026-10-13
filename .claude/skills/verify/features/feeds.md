# Feeds

A user adds a podcast on the PodNotes view's Add podcast page, by name or by
pasting its feed or Apple Podcasts link, sees it in the Library's grid, browses
its episodes on its page, and removes it from the podcast menu.

## Sub-features

- `feed-search-url` resolves a pasted http(s) feed URL to one result with the `RSS feed` chip.
- `feed-search-apple` resolves a pasted Apple Podcasts show link to its RSS feed, with the `podcasts.apple.com` chip (network; skip offline).
- `feed-search-name` searches podcasts by name through the iTunes API (network; skip offline).
- `feed-add` saves the podcast on one tap of its result and opens its page. Its result then reads `Open <title>`.
- `feed-browse` shows the podcast in the Library's grid and its episodes, newest first.
- `feed-error` shows a `Feed didn't load` banner with `Retry` on the podcast's page and a badge on its card, and keeps the episodes it cached.
- `feed-address` asks for a private feed's address this device lacks, with `Set feed address` in the banner and the podcast menu.
- `feed-remove` deletes the podcast with `Remove podcast` in the podcast menu.

## How to get to it (user POV)

- With an empty library, type into First run's `Search or paste a link`. The first keystroke opens Add podcast.
- Otherwise click `+` (`Add podcast`) in the Library's head, or `Add podcast` at the top of the rail when the view is wide.
- In the PodNotes view, go Back to the Library, then click the podcast's card.
- The podcast menu is the `...` button (`Podcast options`) in a podcast page's head, or a right-click on its card.

## Driving it with ui.mjs

Preconditions:

- `FEED=$(node .claude/skills/verify/fixtures.mjs feed)` prints `http://podnotes.test:<port>/feed.xml`.
- `PodNotes Fixture` is not saved yet (`jq '.savedFeeds | keys' <data.json>` lacks it).

- **Open Add podcast.** Run `CLI command id=podnotes:podnotes-show-leaf`, then `UI click '.podcast-view .pn-head button[aria-label^="Back to"]'` until the Library shows. An empty library shows First run, whose field is focused already. Otherwise run `UI click '.podcast-view .pn-head button[aria-label="Add podcast"]'`, or `UI click '.podcast-view .pn-railsearch'` when the rail shows.
- **Load the feed.** Run `UI fill '.podcast-view input[aria-label="Search or paste a link"]' "$FEED"`. Within about 1 s the page reads `1 show` above one result, `PodNotes Fixture`, with the `RSS feed` chip and the label `Add PodNotes Fixture`.
- **Add it.** Run `UI click '.podcast-view button.pn-result[aria-label="Add PodNotes Fixture"]'`. The podcast's page opens, headed by its artwork and `PodNotes Fixture`, and lists `Fixture Episode 2` (`Oct 10`) above `Fixture Episode 1` (`Oct 9`). After about 2 s `data.json` `savedFeeds["PodNotes Fixture"].url` equals `$FEED`.
- **Browse.** Run `UI click '.podcast-view .pn-head button[aria-label^="Back to"]'` until `h1.pn-head-title` reads `Library`, then `UI click '.podcast-view button.pn-gridcard[aria-label="PodNotes Fixture"]'`.
- **Feed error.** Run `node .claude/skills/verify/fixtures.mjs stop`, then `UI click '.podcast-view [aria-label="Refresh episodes"]'`. A `Feed didn't load` banner names `podnotes.test:<port>` and offers `Retry`, and both episodes stay listed. The card's label becomes `PodNotes Fixture, feed didn't load`. Run `fixtures.mjs feed` again, then `UI click '.podcast-view .pn-banner button' --text Retry`. The banner goes.
- **Remove it.** On its page run `UI click '.podcast-view .pn-head button[aria-label="Podcast options"]'`, or on the Library `UI click '.podcast-view button.pn-gridcard[aria-label="PodNotes Fixture"]' --right`. Then run `UI click '.menu .menu-item' --text 'Remove podcast'`. The view shows the Library and `savedFeeds` no longer has it. With nothing else in the library, the view shows `Add your first podcast`.
- **Proof.** Run `npm run screenshot:e2e-obsidian -- .obsidian-e2e-artifacts/feeds/add-podcast.png` with the result showing, then `npm run screenshot:e2e-obsidian -- .obsidian-e2e-artifacts/feeds/episodes.png` on the podcast's page, and save the `savedFeeds` read.

## Gotchas

- PodNotes refuses literal loopback and private hosts (`127.0.0.1`, `localhost`, `*.local`). The fixture URL uses `podnotes.test`, which this worktree's instance resolves to 127.0.0.1 through Chromium's host resolver rules. Start Obsidian through `start:e2e-obsidian` so the rule is present.
- A name searches after 300 ms of quiet, and a pasted link resolves at once. Wait for the result, not a fixed time.
- Add podcast keeps its text while the view lives. `Clear` (the `x` in the field) empties it.
- `Set feed address` shows only while this device lacks a private feed's address. The banner never shows a private address. It reads `Private feed` or `Address not on this device` instead.
- The fixture port is fixed per worktree. A saved fixture feed keeps working after `fixtures.mjs stop` and `feed`, but not in another worktree.
