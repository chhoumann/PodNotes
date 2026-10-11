---
title: Capture timestamps
slug: timestamps
description: Insert the current playback time into a note as a link that plays the episode from that moment.
---

Capture a timestamp while you listen, and PodNotes inserts the playback time at your cursor as a link back to that moment in the episode.

![The Notes section of an episode note with three captured timestamp links, each followed by a note](/screenshots/timestamps.webp)

## <span id="capturing-timestamps"></span>Capture a timestamp

1. Play an episode in PodNotes. You can pause it before you capture.
2. Open a note in editing view and place the cursor where you want the timestamp.
3. Run **PodNotes: Capture Timestamp** from the command palette (`Ctrl+P`, or `Command+P` on macOS).

PodNotes inserts a list item with a link such as `00:12:41`, followed by a space for your note. If you selected text, the capture replaces it. Select the link later to open the player and play the episode from that moment.

To keep your timestamps in one note per episode, see [Create episode notes](/notes/).

## Capture from a hotkey, the toolbar, or a headset

You can run the same capture without opening the command palette:

- **Hotkey.** In **Settings → Hotkeys**, search for **PodNotes: Capture Timestamp** and assign a shortcut.
- **Phone toolbar.** Add the command to the mobile editor toolbar, as described in [Add a capture button to the editor toolbar](/mobile/#add-a-capture-button-to-the-editor-toolbar).
- **Headset.** On a phone or a computer, press the headset button that sends the previous-track action. Not every headset sends it. When no note is open for editing, PodNotes adds the timestamp to the end of the episode note. See [Capture with a headset](/mobile/#capture-with-a-headset).

## <span id="capturing-segments"></span>Capture a range

To mark a passage instead of a moment, run **PodNotes: Capture Last 10 Seconds** or **PodNotes: Capture Last 20 Seconds**. PodNotes inserts the range that ends at the current playback time, such as `00:12:31-00:12:41`.

Select a range link to play that passage. Playback pauses at the end of the range. A range is a link to two times in the episode. PodNotes does not cut an audio clip.

Obsidian lists the range commands only while a note is open in an editor, an episode is loaded, and **Capture timestamp format** is set. They use that format, with each time tag replaced by its range tag, as described in [Timestamp tags](#timestamp-tags).

## Make timestamps clickable

If your captures come out as plain text, such as `00:12:41` with no link, your format uses `{{time}}`. Installs from before PodNotes 2.21.0 keep that old default, `- {{time}}` with a space at the end.

1. Open **Settings → PodNotes**.
2. Under **Episode notes**, set **Capture timestamp format** to `- {{linktime}}` with a space at the end.

New captures are links. Timestamps that you captured before stay plain text.

## Compensate for reaction time

By the time you run the command, the moment you wanted has often passed. To capture a few seconds earlier, set **Timestamp offset (s)** under **Episode notes** to that number of seconds.

With an offset of `5`, a capture at `00:12:46` inserts `00:12:41`. Ranges move back by the same amount. The offset is a whole number of seconds, and a blank or negative value counts as `0`. A capture never goes below `00:00:00`.

## <span id="settings"></span>Change the format

**Capture timestamp format** under **Episode notes** decides what a capture inserts. It can hold text, Markdown, and line breaks around the [timestamp tags](#timestamp-tags). While an episode is loaded, the setting shows a preview of the result.

| Format | Inserts |
| --- | --- |
| `- {{linktime}} ` | A list item with a link such as `00:12:41`. This is the default. |
| `{{linktime:H:mm:ss}} ` | A link such as `0:12:41`, with no list marker. |
| `> {{linktime}} ` | A blockquote line that starts with a link. |
| `- {{time}} ` | A list item with the plain text `00:12:41` and no link. |

## Limits of capture and links

Captures and links behave differently in these cases:

- **PodNotes: Capture Timestamp** needs a loaded episode and a **Capture timestamp format** that is not empty. Otherwise it shows "Play an episode and set a Capture timestamp format in settings to capture a timestamp."
- `{{linktime}}` and `{{linksegment}}` insert plain text when the episode has no feed URL or local file to link to.
- A range command at the very start of an episode shows "Play more of the episode before capturing a segment".
- In a table cell, PodNotes escapes pipe characters and turns line breaks into spaces, so the capture stays in its cell.
- A link finds its episode by title. Small changes such as case, punctuation, and word order still match. If the podcast renames the episode with different words, the link shows "Episode not found".
- A link to a private feed works only on a device where you saved that feed.
- A link to a local file needs the file in **Local Files**. See [Sync between devices](/sync/#removal-and-existing-links).

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

The range commands use **Capture timestamp format** as follows. A format that contains `{{segment}}` or `{{linksegment}}` is used as it is. Otherwise `{{time}}` becomes `{{segment}}` and `{{linktime}}` becomes `{{linksegment}}`. A format with no time tag at all becomes `- {{linksegment}}`.

### Time formats

Time tags accept these tokens:

| Part | Tokens | Meaning |
| --- | --- | --- |
| Hours | `H`, `HH` | Total elapsed hours, unpadded or padded to at least two digits. |
| Twelve-hour clock | `h`, `hh` | Hour on a twelve-hour clock, unpadded or padded. |
| Minutes | `m`, `mm` | Minute within the hour, unpadded or padded. |
| Seconds | `s`, `ss` | Second within the minute, unpadded or padded. |
| AM or PM | `A`, `a` | Uppercase or lowercase clock label. |

A backslash makes the next character literal. `{{time:H\h mm\m ss\s}}` inserts `0h 12m 41s`. Square brackets do not mark literal text in time tags. [Date tags](/templates/#date-formats) use a different set of tokens.

### PodNotes URI

Timestamp links and resume links open `obsidian://podnotes`. A captured link looks like this:

```text
obsidian://podnotes?episodeName=The%20Home%20Depot&url=https%3A%2F%2Ffeeds.transistor.fm%2Facquired&time=761
```

The handler accepts these query parameters:

| Parameter | Required | Meaning |
| --- | --- | --- |
| `url` | Yes | Podcast feed URL, vault path of a local file, or the placeholder that stands for a private feed. |
| `episodeName` | Yes | Episode title. |
| `time` | No | Start time in seconds, zero or greater. Decimals are allowed. |
| `endTime` | No | End of a range in seconds, greater than `time`. Needs `time`. |
| `end` | No | Alias of `endTime`. |
| `to` | No | Alias of `endTime`. |

When a link has no `time`, or an empty one, the episode resumes from its saved progress. An unplayed or finished episode starts at zero. When a link has more than one end parameter, `endTime` wins over `end`, and `end` wins over `to`.

Query values are percent-encoded. Current links encode a space as `%20` and a literal plus sign as `%2B`. Links from older versions encode a space as `+`, and PodNotes tries that reading too when it looks up the title or local path.

A feed `url` must be a public HTTP or HTTPS address. A private-feed placeholder resolves only through a saved podcast and the feed address stored on that device. A local `url` needs a registered episode and its media file.

The handler first matches `episodeName` against episode titles, ignoring case and surrounding spaces. If no title matches, it accepts the one episode whose title has the same set of words, ignoring punctuation, word order, and leading zeros in numbers. A title with different words or a different episode number does not match.
