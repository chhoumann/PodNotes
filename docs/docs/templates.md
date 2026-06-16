PodNotes can create notes from templates. These templates can contain certain syntax, which will be expanded to metadata about the podcast episode you are listening to.

To use templates, you can use the `Create episode note` Obsidian command (previously named `Create podcast note`).
This requires you to have defined a template for both the file path and note text.

PodNotes can also create a note for a whole podcast (the feed). See [Podcast feed notes](#podcast-feed-notes) below.

## File path
This template will be used to create the file path for the note. You can use the following syntax:

- `{{title}}`: The title of the podcast episode. You can add a format, e.g. `{{title:_}}` to replace spaces with underscores.
- `{{podcast}}`: The name of the podcast. You can add a format, e.g. `{{podcast:_}}` to replace spaces with underscores.
- `{{date}}`: The publish date of the podcast episode. Please note that this is not always available, and will be empty if it is not.
	- You can use `{{date:format}}` to specify a custom [Moment.js](https://momentjs.com) format. E.g. `{{date:YYYY-MM-DD}}`.
- `{{currentDate}}`: The current date (when the note is created), as opposed to `{{date}}` (the episode publish date). Supports the same format argument, e.g. `{{currentDate:YYYY-MM-DD}}`.
- `{{episodeNumber}}`: The episode number (see the [note template](#note-template) section for how it is sourced). Use an all-zeros width to zero-pad for sortable file names, e.g. `{{episodeNumber:000}}` → `042`. Empty when the number is unknown.

`{{title}}` and `{{podcast}}` are sanitized so they are safe to use in a file path: the following characters are removed: `\ , # % & / { } * < > $ ' " : @ ‣ | ?`. `{{episodeNumber}}` is always file-safe. `{{date}}` and `{{currentDate}}` are inserted as-is, so when using them in a path, avoid format strings that contain path-illegal characters (e.g. `{{currentDate:HH:mm}}`).

## Note template
This template will be used to create the note text. You can use the following syntax:

- `{{title}}`: The title of the podcast episode.
- `{{safeTitle}}`: The title of the podcast episode, but with all special characters removed (like `{{title}}` in file path templates).
- `{{description}}`: The description of the podcast episode.
	-  You can use `{{description:> }}` to prepend each new line with a `>` (to put the entire description in a blockquote).
- `{{content}}`: The content of the podcast episode from `<content:encoded>`. Show notes will sometimes land here.
	-  You can use `{{content:> }}` to prepend each new line with a `>` (to put the entire content in a blockquote).

- `{{podcast}}`: The name of the podcast.
- `{{url}}`: The URL of the podcast episode.
- `{{stream}}`: The direct URL of the episode's audio file — the RSS `<enclosure>` URL for podcast feeds, or the underlying audio source for Pocket Casts and local-file episodes. Handy for embedding the raw audio or linking to the source. An empty string is used in the rare case no audio URL is available. Available in episode note templates only.
- `{{date}}`: The publish date of the podcast episode.
	- You can use `{{date:format}}` to specify a custom [Moment.js](https://momentjs.com) format. E.g. `{{date:YYYY-MM-DD}}`.
- `{{currentDate}}`: The current date — i.e. when the note is created — as opposed to `{{date}}`, which is the episode's publish date. Useful for a "captured on" metadata field.
	- Supports the same format argument, e.g. `{{currentDate:YYYY-MM-DD}}`.
- `{{episodeNumber}}`: The episode number. PodNotes uses the feed's `<itunes:episode>` tag when present. If it is missing or not a number, PodNotes makes a **best-effort** guess from the start of the episode title — a leading marker (`#12 ...`, `Ep 12 ...`, `Ep. 12 ...`, `Ep #12 ...`, `Episode 12 ...`, `E12 ...`) or a leading number followed by a separator (`12: ...`, `12 - ...`, `12. ...`, `12) ...`). This guess can be wrong for titles that simply begin with an unrelated number (e.g. `2024: A Year in Review`), so for feeds without `<itunes:episode>` treat it as approximate. The tag is empty when no number can be determined.
	- You can zero-pad with an all-zeros width, e.g. `{{episodeNumber:000}}` → `042` (handy for sortable file names). Any other argument is ignored and the bare number is returned.
- `{{duration}}`: The episode's duration, from the feed's `<itunes:duration>` tag. Empty when the feed doesn't provide one. Not available in file-path/download-path templates — even though `{{duration:seconds}}`/`{{duration:minutes}}` would be file-safe, the tag is excluded from path templates entirely so the default colon-containing clock output can't accidentally end up in a file name. Note: an episode that was already the *current* episode before you upgraded PodNotes may show an empty duration until you re-open it from its feed (older saved episodes predate this field).
	- With no argument it renders a human clock: `4:05` (under an hour) or `1:02:03` (an hour or more).
	- `{{duration:minutes}}` → total whole minutes (e.g. `62`); `{{duration:seconds}}` → total seconds (e.g. `3723`).
	- Any other argument is treated as a clock format using the tokens `H`/`HH`, `h`/`hh`, `m`/`mm`, `s`/`ss`, `A`/`a` — e.g. `{{duration:HH:mm:ss}}` → `01:02:03`. (Unlike `{{date}}`, `[literal]` bracket escaping is not supported here.)
- `{{artwork}}`: The URL of the podcast artwork. If no artwork is found, an empty string will be used.
- `{{episodelink}}`: A clickable `obsidian://podnotes` link that reopens this episode in the PodNotes player and **resumes from where you left off** (or starts at the beginning if you have never played it, or have already finished it). The resume position is resolved when you click the link — not baked in when the note is created — so the link always jumps to your latest position. Put it in your template to get a "back to the episode" link on every note, e.g. `[▶️ Resume in PodNotes]({{episodelink}})`. The value is the bare URL, so wrap it in your own Markdown link text. It is empty when the episode has no feed URL or local file path to address it by. See [issue #35](https://github.com/chhoumann/PodNotes/issues/35).

### Linking an episode to its podcast (feed) note
In an episode note, `{{url}}` and `{{artwork}}` always describe the **episode**. To reference the parent podcast (feed), use these additional tags:

- `{{episodeurl}}` / `{{episodeartwork}}`: Explicit aliases of `{{url}}` / `{{artwork}}` (the episode's own URL and artwork). Use these when you also use the feed tags below and want to be unambiguous.
- `{{feedurl}}`: The podcast's RSS feed URL.
- `{{feedartwork}}`: The podcast's (feed) artwork. Falls back to the episode artwork if the feed isn't saved.
- `{{podcastlink}}`: A ready-made wikilink to the podcast's [feed note](#podcast-feed-notes). It points at the same file the feed note is created at, so episodes and the feed note link up automatically. When the feed-note path has a folder it is path-qualified (e.g. `[[PodNotes/Podcasts/My Show|My Show]]`) so it can't resolve to an unrelated note that shares the basename; otherwise it's a plain `[[My Show]]`. (Avoid putting a `{{date}}` in the feed-note path, since the episode side can't reproduce the feed note's creation date.)

A Bases-friendly episode template that links back to the feed note:

```
---
type: podcastEpisode
podcast: "{{podcastlink}}"
title: "{{title}}"
image: "{{artwork}}"
url: "{{url}}"
date: {{date:YYYY-MM-DD}}
tags:
  - podcastEpisode
---
{{description}}
```

## Podcast feed notes
A *feed note* is a single parent note for an entire podcast (the feed), which episode notes can link to (great for [Obsidian Bases](https://help.obsidian.md/bases) / Dataview rollups).

Create one with the `Create podcast feed note` command (pick a saved podcast — no playback needed) or from an episode's right-click menu. Configure the feed note **file path** and **template** under PodNotes settings → *Podcast feed note settings*. PodNotes ships sensible Bases-friendly defaults.

In a feed note, `{{url}}` and `{{artwork}}` describe the **feed** (the note's subject). Available tags:

- `{{title}}`: The podcast's name.
- `{{podcast}}` / `{{safeTitle}}`: The podcast's name, formatted safely for file paths/links (special characters removed).
- `{{url}}`: The podcast's website (from the feed's `<link>`). May be empty if the feed has no website.
- `{{feedurl}}`: The podcast's RSS feed URL.
- `{{artwork}}` / `{{feedartwork}}`: The URL of the podcast artwork.
- `{{author}}`: The podcast author (`<itunes:author>`), if present.
- `{{description}}`: The podcast's description. Supports the `{{description:> }}` prepend syntax, like episode notes.
- `{{date}}`: The current date (when the note is created). Supports `{{date:format}}`. (In feed notes, `{{date}}` already returns the current date, so `{{currentDate}}` is not registered here — use `{{date}}`.)

The file path template supports `{{title}}`/`{{podcast}}` (with the optional `{{podcast:_}}` whitespace-replacement format) and `{{date}}`.

The default feed note path is `PodNotes/Podcasts/{{podcast}}.md`, so an episode's `{{podcastlink}}` (`[[Podcast Name]]`) resolves to it automatically.
