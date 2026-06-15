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

Both syntax items will be formatted such that it is safe to use in a file path.
This means the following characters will be removed: `\ , # % & / { } * < > $ ' " : @ ‣ | ?`.

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
- `{{date}}`: The publish date of the podcast episode.
	- You can use `{{date:format}}` to specify a custom [Moment.js](https://momentjs.com) format. E.g. `{{date:YYYY-MM-DD}}`.
- `{{artwork}}`: The URL of the podcast artwork. If no artwork is found, an empty string will be used.

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
- `{{date}}`: The current date (when the note is created). Supports `{{date:format}}`.

The file path template supports `{{title}}`/`{{podcast}}` (with the optional `{{podcast:_}}` whitespace-replacement format) and `{{date}}`.

The default feed note path is `PodNotes/Podcasts/{{podcast}}.md`, so an episode's `{{podcastlink}}` (`[[Podcast Name]]`) resolves to it automatically.
