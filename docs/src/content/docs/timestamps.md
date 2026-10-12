---
title: Capture timestamps
slug: timestamps
description: Insert the current playback time into a note as a link that plays the episode from that moment.
---

Capture a timestamp while you listen, and PodNotes inserts the playback time at your cursor as a link back to that moment in the episode.

![The Notes section of an episode note with three captured timestamp links, each followed by a note](/screenshots/timestamps.webp)

## <span id="capturing-timestamps"></span>Capture a timestamp

1. Play an episode in PodNotes. You can pause it before you capture.
2. Open a note in editing view.
3. Place the cursor where you want the timestamp.
4. Run **PodNotes: Capture Timestamp** from the command palette (`Ctrl+P`, or `Command+P` on macOS).

PodNotes inserts a list item with a link such as `00:12:41`, followed by a space for your note. A capture replaces any selected text. Select the link, in Live Preview or reading view, to play the episode from that moment. To keep your timestamps in one note per episode, see [Create episode notes](/notes/).

## Capture from a hotkey, the toolbar, or a headset

To capture from a hotkey:

1. Open **Settings → Hotkeys**.
2. Search for **PodNotes: Capture Timestamp**.
3. Assign a shortcut to it.

On a phone, [add a capture button to the editor toolbar](/mobile/#add-a-capture-button-to-the-editor-toolbar).

A headset button that sends the previous-track action also captures. If a note is open in an editor, the timestamp goes in at the cursor. If no note is open in an editor, PodNotes adds it to the end of the episode note. See [Capture with a headset](/mobile/#capture-with-a-headset).

## <span id="capturing-segments"></span>Capture a range

To mark a passage instead of a moment:

1. Play an episode in PodNotes.
2. In a note in editing view, place the cursor where the range goes.
3. Run **PodNotes: Capture Last 10 Seconds** or **PodNotes: Capture Last 20 Seconds**.

PodNotes inserts the range that ends at the current playback time, such as `00:12:31-00:12:41`. It does not cut an audio clip. With the default **Capture timestamp format**, the range is a link that plays that passage and pauses at its end. With a format that uses `{{time}}`, the range is plain text.

The range commands insert a range in the style of your **Capture timestamp format**, as [Timestamp tags](#timestamp-tags) describes. [Commands](/commands/#capture-last-10-seconds--capture-last-20-seconds) lists when they are available.

## Make timestamps clickable

If your captures come out as plain text with no link, your format most likely uses `{{time}}`, the default before PodNotes 2.21.0.

1. Open **Settings → PodNotes**.
2. Under **Episode notes**, set **Capture timestamp format** to `- {{linktime}}` with a space at the end.

New captures are links. Timestamps that you captured before stay plain text. If the format already uses `{{linktime}}`, the episode has no feed URL or local file to link to.

## Compensate for reaction time

To capture a few seconds before you react:

1. Open **Settings → PodNotes**.
2. Under **Episode notes**, set **Timestamp offset (s)** to that whole number of seconds.

With an offset of `5`, a capture at `00:12:46` inserts `00:12:41`, and ranges move back by the same amount. A capture never goes below `00:00:00`.

## <span id="settings"></span>Change the format

**Capture timestamp format** under **Episode notes** decides what a capture inserts. It can hold text, Markdown, and line breaks around the [timestamp tags](#timestamp-tags), and it previews the result while an episode is loaded. See [Example formats](#example-formats).

## Limits of capture and links

Captures and links behave differently in these cases:

- Without a loaded episode or with an empty **Capture timestamp format**, **PodNotes: Capture Timestamp** shows "Play an episode and set a Capture timestamp format in settings to capture a timestamp."
- `{{linktime}}` and `{{linksegment}}` insert plain text when the episode has no feed URL or local file to link to.
- At the very start of an episode, a range command shows "Play more of the episode before capturing a segment".
- In a table cell, PodNotes escapes pipe characters and turns line breaks into spaces.
- A link finds its episode by title, despite changes in case, punctuation, or word order. If the podcast renames the episode with different words, the link shows "Episode not found".
- A link to a private feed works only on a device where you saved that feed.
- A link to a local file needs the file in **Local Files**. See [Downloads and local files](/local_files/).

## Reference

### Timestamp tags

**Capture timestamp format** accepts these four tags:

| Tag | Inserts |
| --- | --- |
| `{{time}}` | The playback time as plain text. |
| `{{linktime}}` | The playback time as a link to that moment. |
| `{{segment}}` | A range as plain text. In a single capture, the playback time. |
| `{{linksegment}}` | A range as a link. In a single capture, a link to the playback time. |

Each tag uses `HH:mm:ss` unless you add a [time format](#time-formats) after a colon, as in `{{linktime:H:mm:ss}}`.

The range commands adapt **Capture timestamp format** as follows. PodNotes uses a format that contains `{{segment}}` or `{{linksegment}}` unchanged. Otherwise `{{time}}` becomes `{{segment}}` and `{{linktime}}` becomes `{{linksegment}}`. A format with no time tag at all becomes `- {{linksegment}}`.

### Example formats

| Format | Inserts |
| --- | --- |
| `- {{linktime}} ` | A list item with a link such as `00:12:41`. This is the default. |
| `{{linktime:H:mm:ss}} ` | A link such as `0:12:41`, with no list marker. |
| `> {{linktime}} ` | A blockquote line that starts with a link. |
| `- {{time}} ` | A list item with the plain text `00:12:41` and no link. |

### Time formats

Time tags accept these tokens:

| Part | Tokens | Meaning |
| --- | --- | --- |
| Hours | `H`,&nbsp;`HH` | Total elapsed hours, unpadded or padded to at least two digits. |
| Twelve-hour clock | `h`,&nbsp;`hh` | Hour on a twelve-hour clock, unpadded or padded. |
| Minutes | `m`,&nbsp;`mm` | Minute within the hour, unpadded or padded. |
| Seconds | `s`,&nbsp;`ss` | Second within the minute, unpadded or padded. |
| AM or PM | `A`,&nbsp;`a` | Uppercase or lowercase clock label. |

A backslash makes the next character literal. `{{time:H\h mm\m ss\s}}` inserts `0h 12m 41s`. Square brackets do not mark literal text in time tags. [Date tags](/templates/#date-formats) use a different set of tokens.

### PodNotes URI

Timestamp links and resume links open `obsidian://podnotes`. A captured link looks like this:

```text wrap
obsidian://podnotes?episodeName=The%20Home%20Depot&url=https%3A%2F%2Ffeeds.transistor.fm%2Facquired&time=761
```

The handler accepts these query parameters:

| Parameter | Required | Meaning |
| --- | --- | --- |
| `url` | Yes | Podcast feed URL, vault path of a local file, or the placeholder that stands for a private feed. |
| `episodeName` | Yes | Episode title. |
| `time` | No | Start time in seconds, zero or greater. It can have decimals. |
| `endTime` | No | End of a range in seconds, greater than `time`. Needs `time`. |
| `end` | No | Alias of `endTime`. |
| `to` | No | Alias of `endTime`. |

When a link has no `time`, or an empty one, the episode resumes from its saved progress. An unplayed or finished episode starts at zero. When a link has more than one end parameter, `endTime` wins over `end`, and `end` wins over `to`.

A feed `url` must be a public HTTP or HTTPS address. A private-feed placeholder resolves only through a saved podcast and the feed address stored on that device. A local `url` needs a registered episode and its media file.

PodNotes percent-encodes query values, and also reads links from older versions that encode a space as `+`. The handler matches `episodeName` to an episode title regardless of case, and otherwise to the one title with the same words in any order and with any punctuation.
