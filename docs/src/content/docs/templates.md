---
title: Template tags
slug: templates
description: Every template tag PodNotes fills in for note paths, episode notes, feed notes, downloads, and transcripts, with the default templates and date formats.
---

Look up every `{{tag}}` that PodNotes fills in when it creates a note, a download, or a transcript. To change where notes go and what they hold, see [Create episode notes](/notes/). The tags for captured timestamps are under [Timestamp tags](/timestamps/#timestamp-tags).

## Tag rules

These rules apply to every template except **Speaker label format**:

- Tag names ignore case. `{{currentDate}}` and `{{currentdate}}` are the same tag.
- An unknown tag stays in the output as written, and PodNotes shows a notice that suggests a similar tag when it finds one.
- Some tags take an argument after a colon, as in `{{date:YYYY}}`. Everything after the first colon is one argument, commas included.
- An empty argument, as in `{{date:}}`, gives the tag's default.

**Speaker label format** replaces only `{{speaker}}`, in any case and with spaces allowed inside the braces. It shows no notice for other tags. Without `{{speaker}}`, PodNotes puts the label, a colon, and a space before your text.

## <span id="file-path"></span>File path tags

**Note creation file path**, **Transcript file path**, and **Episode download path** accept these tags:

| Tag | Value | Argument |
| --- | --- | --- |
| `{{title}}` | Episode title, cleaned for a file name. | Replaces whitespace, as in `{{title:_}}`. |
| `{{podcast}}` | Podcast name, cleaned for a file name. | Replaces whitespace, as in `{{podcast:_}}`. |
| `{{date}}` | Episode publication date, or empty when the feed has none. | [Date format](#date-formats). Default `YYYY-MM-DD`. |
| `{{currentDate}}` | Date when PodNotes fills in the path. | [Date format](#date-formats). Default `YYYY-MM-DD`. |
| `{{episodeNumber}}` | Episode number from the feed or the title, or empty. | Zero padding, as in `{{episodeNumber:000}}` for `042`. |

`{{duration}}` is not available in paths.

| Setting | Default |
| --- | --- |
| **Note creation file path** | `PodNotes/{{podcast}}/{{title}}.md` |
| **Transcript file path** | `transcripts/{{podcast}}/{{title}}.md` |
| **Episode download path** | `PodNotes/{{podcast}}/{{title}}` |

PodNotes adds `.md` to a note path when it is missing. A transcript path keeps the extension you type, so end it with `.md`. A download path gets the media file's extension, and PodNotes removes any extension you type at its end.

A download path must tell episodes apart. Without `{{title}}`, the setting shows a warning. When a file for another episode already exists at the path, the download fails and does not overwrite it.

### Characters removed from names

The `{{title}}` and `{{podcast}}` path tags remove these characters:

```text wrap
\ , # % & / { } * < > $ ' " : @ ‣ | ? [ ]
```

They also turn control characters into spaces, collapse runs of whitespace, trim the ends, and remove leading and trailing dots. Dots inside a name stay. PodNotes does not clean date values, so a date format that contains `:` can produce a file name that the system rejects.

PodNotes shortens a long folder or file name to fit file system limits, and keeps the extension.

## <span id="note-template"></span>Episode note tags

**Note creation template** accepts these tags:

| Tag | Value |
| --- | --- |
| `{{title}}` | Episode title as Markdown text on one line, with Markdown characters escaped. |
| `{{safeTitle}}` | Episode title cleaned for a file name. |
| `{{podcast}}` | Podcast name cleaned for a file name. |
| `{{description}}` | Episode description, converted from HTML to Markdown. |
| `{{content}}` | Episode content from `<content:encoded>`, converted to Markdown. |
| `{{url}}` | Episode web page from the item's `<link>`, or the feed URL when the item has none. For a private feed that PodNotes recognizes, the placeholder instead of its address. For a local file, the vault link. |
| `{{stream}}` | Public HTTP or HTTPS media URL. Empty for a device-only URL or a blocked address. |
| `{{date}}` | Episode publication date, or empty when the feed has none. |
| `{{currentDate}}` | Date when PodNotes creates the note. |
| `{{episodeNumber}}` | Episode number, or empty when unknown. |
| `{{duration}}` | Episode length from `<itunes:duration>`, or empty when the feed has none. |
| `{{chapters}}` | Chapter list in Markdown, or empty when the episode has no visible chapters. |
| `{{artwork}}` | Episode artwork URL, or empty when there is none or the address is blocked. |
| `{{episodelink}}` | `obsidian://podnotes` link that resumes this episode, with its `guid` when it has one. Empty without a feed or local file to link to, and when the link would show a private feed's address, as for a private feed that you have not added. |

`{{date}}` and `{{currentDate}}` accept a [date format](#date-formats). `{{episodeNumber:000}}` pads to three digits. Any other argument gives the number without padding.

The episode number comes from `<itunes:episode>` when the feed has a valid one. Otherwise PodNotes reads a number at the start of the title, such as `#12`, `Ep. 12`, `Episode 12`, or `12: Interview`. PodNotes can mistake a year at the start of a title, as in `2024: A year in review`, for episode number 2024.

`{{description}}`, `{{content}}`, and `{{chapters}}` accept a prefix for every line, as in `{{description:> }}`. Descriptions and content keep ordinary Markdown formatting, links, and image alt text. PodNotes removes media elements, escapes Markdown embeds, and turns `dataview` and `dataviewjs` code blocks into `text` code blocks.

When the address of a private feed that you added is on this device, PodNotes replaces copies of it in episode text, file names, and your template with the feed's placeholder. See [Private feeds in notes and links](/private-feeds/#private-feeds-in-notes-and-links).

PodNotes percent-encodes URLs from a feed where they contain whitespace, control characters, quotes, backticks, brackets, parentheses, angle brackets, or backslashes. A local file's `{{url}}` stays a vault link. `{{artwork}}` and `{{stream}}` accept only public HTTP or HTTPS addresses without a user name or password. A device-only address, or a private or local IP address, gives an empty value.

### Duration and chapters

With no argument, `{{duration}}` gives `4:05` for an episode under an hour and `1:02:03` for longer ones. `{{duration:minutes}}` gives whole minutes, and `{{duration:seconds}}` gives seconds. Any other argument is a [time format](/timestamps/#time-formats), as in `{{duration:HH:mm:ss}}`. An episode restored from an older version can lack a duration. Create its note from the episode's menu in its podcast's list. That menu uses the feed's copy of the episode, so `{{duration}}` is filled in when the feed gives one.

`{{chapters}}` reads the chapters file from the feed's Podcasting 2.0 `<podcast:chapters>` tag. Each visible chapter becomes a line such as `- 0:00 Chapter title`, sorted by start time, with the title as plain text. PodNotes leaves out chapters marked `toc: false`. A failed request or an empty chapters file gives an empty value.

### <span id="linking-an-episode-to-its-podcast-feed-note"></span>Feed link tags

These episode note tags point to the episode or to its podcast:

| Tag | Value |
| --- | --- |
| `{{episodeurl}}` | Same as `{{url}}`. |
| `{{episodeartwork}}` | Same as `{{artwork}}`. |
| `{{feedurl}}` | Podcast feed URL, or the placeholder for a private feed that PodNotes recognizes. Empty when no feed URL is stored, and for a private feed that you have not added. |
| `{{feedartwork}}` | Saved podcast artwork, or the episode artwork when the podcast has none. |
| `{{podcastlink}}` | Wikilink to the feed note, built from **Feed note file path**. |

With the default **Feed note file path**, `{{podcastlink}}` gives `[[PodNotes/Podcasts/Acquired|Acquired]]`. A path without a folder gives `[[Acquired]]`. The link follows the same name length limit as the feed note. A date tag in the feed note path makes the link use the date when the episode note is created, which can differ from the date in the feed note's name.

## <span id="using-the-default-template-with-bases"></span>Default episode note template

**Note creation template** starts as this template:

```md
---
type: podcastEpisode
podcast: "{{podcastlink}}"
date: {{date:YYYY-MM-DD}}
tags:
  - podcastEpisode
status:
rating:
favorite: false
---
# {{title}}

![]({{artwork}})

[Resume in PodNotes]({{episodelink}})

{{url}}

{{description}}
```

PodNotes also adds the `guid` and `feedUrl` properties to most new episode notes, so it finds a note after you rename or move it. [How PodNotes finds a note](/notes/#how-podnotes-finds-a-note) lists the exceptions.

Its properties work with Obsidian Bases. You fill in `status` and `rating`, and change `favorite` to `true` for the episodes you like. To build a table of episode notes, see [Browse your notes with Bases](/notes/#browse-your-notes-with-bases).

The title and the URL are in the body, not the properties. An escaped title can contain backslashes, and a vault link can contain quotes, so either value can break a quoted property. The quoted `{{podcastlink}}` is safe as long as **Feed note file path** has no quotes or backslashes.

## <span id="podcast-feed-notes"></span>Feed note tags

**Feed note file path** accepts `{{title}}` and `{{podcast}}`, which both give the podcast name cleaned for a file name and accept a whitespace replacement. It also accepts `{{date}}`, the current date, with the default format `YYYY-MM-DD`. The default path is `PodNotes/Podcasts/{{podcast}}.md`.

**Feed note template** accepts these tags:

| Tag | Value |
| --- | --- |
| `{{title}}` | Podcast name as Markdown text on one line, with Markdown characters escaped. |
| `{{safeTitle}}` | Podcast name cleaned for a file name. |
| `{{podcast}}` | Podcast name cleaned for a file name. |
| `{{url}}` | Podcast website from the feed's `<link>`, or empty. |
| `{{feedurl}}` | Podcast feed URL, or the placeholder for a private feed that PodNotes recognizes. |
| `{{artwork}}` | Podcast artwork URL, or empty when there is none or the address is blocked. |
| `{{feedartwork}}` | Same as `{{artwork}}`. |
| `{{author}}` | Author from `<itunes:author>`, with Markdown characters escaped. |
| `{{description}}` | Podcast description, converted to Markdown. Accepts a line prefix. |
| `{{date}}` | Current date. Accepts a [date format](#date-formats). |

`{{currentDate}}` is not available in feed notes or feed note paths. The title, author, description, URL, and artwork tags follow the same rules as their episode note versions.

**Feed note template** starts as this template:

```md
---
type: podcast
podcast: "{{podcast}}"
image: "{{artwork}}"
url: "{{url}}"
feedUrl: "{{feedurl}}"
tags:
  - podcast
---
# {{title}}
{{author}}

![]({{artwork}})

{{description}}
```

## <span id="transcript-and-timestamp-templates"></span>Transcript and timestamp tags

**Transcript template** accepts `{{title}}`, `{{podcast}}`, `{{date}}`, `{{currentDate}}`, `{{episodeNumber}}`, `{{duration}}`, `{{transcript}}`, `{{description}}`, `{{url}}`, and `{{artwork}}`. `{{transcript}}` is the transcript text. A transcript that the feed publishes starts each paragraph with its time when the feed gives times. A transcript of the audio has no times. `{{title}}` and `{{podcast}}` give names cleaned for a file name, as in paths, and accept a whitespace replacement. The other tags follow the episode note rules. `{{stream}}`, `{{chapters}}`, and `{{episodelink}}` are not available in transcripts.

**Transcript template** starts as this template:

```md
# {{title}}

Podcast: {{podcast}}
Date: {{date}}

{{transcript}}
```

**Speaker label format** accepts `{{speaker}}`, the label of the speaker for each turn. See [Transcribe episodes](/transcripts/) for speaker labels.

**Capture timestamp format** accepts `{{time}}`, `{{linktime}}`, `{{segment}}`, and `{{linksegment}}`. See [Timestamp tags](/timestamps/#timestamp-tags). If your captures come out as plain text, see [Make timestamps clickable](/timestamps/#make-timestamps-clickable).

## Date formats

Date tags accept these Moment-style tokens:

| Part | Tokens |
| --- | --- |
| Year | `YYYY`,&nbsp;`YY` |
| Month | `MMMM`,&nbsp;`MMM`,&nbsp;`MM`,&nbsp;`Mo`,&nbsp;`M` |
| Day of month | `Do`,&nbsp;`DD`,&nbsp;`D` |
| Weekday | `dddd`,&nbsp;`ddd` |
| Hour | `HH`,&nbsp;`H`,&nbsp;`hh`,&nbsp;`h` |
| Minute | `mm`,&nbsp;`m` |
| Second | `ss`,&nbsp;`s` |
| AM or PM | `A`,&nbsp;`a` |

Month and weekday names and ordinals are in English. Dates use the device's time zone. Square brackets keep text as it is, as in `{{currentDate:[Captured] YYYY-MM-DD}}`. PodNotes does not support other Moment tokens.
