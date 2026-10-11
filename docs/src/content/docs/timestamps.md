---
title: Timestamps
slug: timestamps
description: Timestamp and segment tags, supported time formats, capture behavior, and PodNotes URI parameters.
---

**PodNotes: Capture Timestamp** inserts the current episode's playback time into an active Markdown editor.
New installs use `- {{linktime}} `, including a final space, so captures are clickable links.
Existing saved formats remain unchanged.

![Notes with clickable timestamp links](/resources/timestamps.png)

## Settings

**Capture timestamp format** is the template used by timestamp and segment capture.
**Timestamp offset (s)** subtracts a non-negative whole number of seconds from the playback time, with a minimum result of zero.
Its default is `0`. Blank or invalid setting input becomes `0`.
The offset also shifts the end of a recent segment capture.

The timestamp template supports four tags:

| Tag | Value |
| --- | --- |
| `{{time}}` | Playback time as plain text. |
| `{{linktime}}` | Playback time as a Markdown episode link. |
| `{{segment}}` | Captured start and end times as plain text. |
| `{{linksegment}}` | Captured start and end times as a Markdown episode link. |

Each tag defaults to `HH:mm:ss` and accepts a custom format after a colon, such as `{{linktime:m:ss}}`.
During an ordinary timestamp capture, the segment tags produce a single time rather than a range.
A missing link target produces plain text instead of a link.

### Time formats

Time tags use the following tokens, rather than the full Moment.js format language:

| Part | Tokens | Meaning |
| --- | --- | --- |
| Hours | `H`, `HH` | Total elapsed hours, unpadded or padded to at least two digits. |
| Twelve-hour clock | `h`, `hh` | Hour on a twelve-hour clock, unpadded or padded. |
| Minutes | `m`, `mm` | Minute within the hour, unpadded or padded. |
| Seconds | `s`, `ss` | Second within the minute, unpadded or padded. |
| AM or PM | `A`, `a` | Uppercase or lowercase clock label. |

A backslash escapes a literal character. `{{time:H\h mm\m ss\s}}` can render `0h 20m 37s`.
Square-bracket literal escaping is not supported for time tags.
[Date tags](/templates/#date-formats) use a separate formatter.

## Capturing timestamps

Capture needs a loaded episode, a non-empty **Capture timestamp format**, and an active editor.
The episode can be paused. A missing episode or format produces this notice:

> Play an episode and set a Capture timestamp format in settings to capture a timestamp.

The command inserts at the cursor and replaces selected text.
In a Markdown table, pipes are escaped and newlines become spaces so the capture stays inside the cell.

Obsidian's **Hotkeys** settings can assign a shortcut to **PodNotes: Capture Timestamp**.
The mobile editor toolbar can include the same command. See [Add a capture button](/mobile/#add-a-capture-button-to-the-editor-toolbar).

The headset Media Session `previoustrack` action also captures a timestamp.
It uses the active editor, or appends to the episode note when no editor is active.
See [Headset capture](/mobile/#capture-with-a-headset) for its requirements and device limits.

## Capturing segments

**PodNotes: Capture Last 10 Seconds** and **PodNotes: Capture Last 20 Seconds** insert a recent playback range.
The range ends at the current playback time minus **Timestamp offset (s)**.
Its start is 10 or 20 seconds earlier, with both ends bounded at zero.
A zero-length range produces the notice "Play more of the episode before capturing a segment".

Segment commands use **Capture timestamp format**.
A template containing `{{segment}}` or `{{linksegment}}` is used as a range template.
Otherwise, `{{time}}` becomes `{{segment}}` and `{{linktime}}` becomes `{{linksegment}}`.
A template without either kind of tag falls back to `- {{linksegment}}`.
The default template therefore produces a linked range such as `00:01:55-00:02:05`.

Opening a segment link seeks to its start, plays the episode, and pauses at its end.
Segment capture does not extract an audio clip or create a separate media file.

## PodNotes URI

Timestamp and resume links use the `obsidian://podnotes` handler.
The handler accepts these query parameters:

| Parameter | Required | Meaning |
| --- | --- | --- |
| `url` | Yes | Podcast feed URL, vault media path, or protected private-feed placeholder. |
| `episodeName` | Yes | Episode title. |
| `time` | No | Start time in seconds. The whole value must be a non-negative finite number, so `12abc` is refused. |
| `endTime` | No | Segment end in seconds, greater than `time`. The whole value must be a finite number. Requires a start time. |
| `end` | No | Accepted alias of `endTime`. |
| `to` | No | Accepted alias of `endTime`, after `end` in precedence. |

An omitted or empty `time` resumes from saved progress.
An unplayed or finished episode starts at zero.
A `time` at or past the episode's end stops 0.25 seconds before the end and pauses.
`endTime` takes precedence over `end`, which takes precedence over `to`.

Query values are percent-encoded. Current links encode spaces as `%20` and literal plus signs as `%2B`.
Older links using `+` for spaces are also tried during title and local-path lookup.

Feed targets must use a public HTTP or HTTPS URL. A protected private-feed placeholder resolves only through a saved subscription and its device-local secret.
Local targets need a registered episode and a media file. See [Sync and devices](/sync/#removal-and-existing-links).

A link plays the loaded episode without a feed lookup only when its `url` names that episode's feed, or its file for a local file.
Episode lookup first tries the title, ignoring case and surrounding whitespace.
Its fallback requires a unique match with the same normalized word set, ignoring punctuation, word order, and leading zeros in numeric words.
Different words or episode numbers can prevent a match. Timestamp links do not guarantee recovery after every feed title change.
