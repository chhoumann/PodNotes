---
title: Capture timestamps
slug: timestamps
description: Insert the current playback time into a note as a link that plays the episode from that moment.
---

Capture a timestamp while you listen, and PodNotes inserts the playback time at your cursor as a link back to that moment in the episode.

## <span id="capturing-timestamps"></span>Capture a timestamp

1. Play an episode in PodNotes, as [Add and play podcasts](/podcasts/#play-an-episode) describes. You can pause it before you capture.
2. In a note in editing view, place the cursor where you want the timestamp.
3. Run **PodNotes: Capture Timestamp** from the command palette (`Ctrl+P`, or `Command+P` on macOS).

PodNotes inserts a list item with a link such as `00:12:41`, followed by a space for your note, and shows a notice with **Undo**. A capture replaces any selected text. Select the link, in Live Preview or reading view, to play the episode from that moment. To keep your timestamps in one note per episode, see [Create episode notes](/notes/).

**Timestamp** in the full player and the clock button in the mini player capture the same way. See [Use the player](/player/).

![The Notes section of an episode note with four captured timestamp links, each followed by a note, and a Follow up list](/screenshots/timestamps.webp)

## Undo a capture

After each capture, a notice says "Timestamp added to" and the note's name, or "Created" and the name when the capture created the episode's note. The notice has an **Undo** button for seven seconds.

1. In the notice, select **Undo**.

PodNotes takes the timestamp out, and puts back any selected text that it replaced, but only while the note is exactly as the capture left it. If you typed in the note since, the notice says "The note isn't as the capture left it, so the timestamp stays", and the note stays as it is. Delete the timestamp by hand instead. The editor's own undo, `Ctrl+Z` or `Command+Z` on macOS, also works, but it takes back your typing first. Undo never deletes a note that the capture created. It removes only the timestamp.

## Choose where a timestamp goes

The capture commands work from anywhere, so you can capture while you browse episodes in the PodNotes view. A capture goes to the first of these:

1. The note you are editing, at the cursor. A note in reading view does not count.
2. The note you edited last, at its cursor, if it is still open in editing view. A capture from the PodNotes view, or from a headset, usually goes here.
3. The end of the episode's note, found as [How PodNotes finds a note](/notes/#how-podnotes-finds-a-note) describes. If PodNotes finds none, it creates the note, without opening it. For a note created before PodNotes 2.22.0 that you renamed or moved, PodNotes then creates a second note. Creating the note needs **Episode note path** and **Episode note template**.

## Capture from a hotkey, the toolbar, or a headset

To capture from a hotkey:

1. Open **Settings → Hotkeys**.
2. Search for **PodNotes: Capture Timestamp**.
3. Assign a shortcut to it.

On a phone, [add a capture button to the editor toolbar](/mobile/#add-a-capture-button-to-the-editor-toolbar).

By default, a headset's previous-track button also captures, except on Android. You can give the capture to the next-track button too, or give either button another action, under **Headset and lock screen** in **Settings → PodNotes**. The timestamp goes where [a capture goes](/timestamps/#choose-where-a-timestamp-goes), and the same notice appears in Obsidian. See [Control playback from a headset or the lock screen](/mobile/#control-playback-from-a-headset-or-the-lock-screen).

## <span id="capturing-segments"></span>Capture a range

To mark a passage instead of a moment:

1. Play an episode in PodNotes.
2. In a note in editing view, place the cursor where the range goes.
3. Run **PodNotes: Capture Last 10 Seconds** or **PodNotes: Capture Last 20 Seconds**.

PodNotes inserts the range that ends at the current playback time, such as `00:12:31-00:12:41`. It does not cut an audio clip. With the default **Timestamp template**, the range is a link that plays that passage and pauses at its end. While the range plays, PodNotes does not save your position in the episode. When a range reaches the end of the episode, PodNotes does not mark the episode played or start the next episode. After the range pauses, play the episode again to return to normal playback. Moving to another point does the same. With a template that uses `{{time}}`, the range is plain text.

The range commands insert a range in the style of your **Timestamp template**, as [Timestamp tags](/timestamps/#timestamp-tags) describes. They show the same notice with **Undo**. [Commands](/commands/#capture-last-10-seconds--capture-last-20-seconds) lists when they are available.

## Make timestamps clickable

If your captures come out as plain text with no link, your **Timestamp template** most likely uses `{{time}}`, the default before PodNotes 2.21.0.

1. Open **Settings → PodNotes**.
2. Under **Notes**, set **Timestamp template** to `- {{linktime}}` with a space at the end.

New captures are links. Timestamps that you captured before stay plain text. If the template already uses `{{linktime}}`, the cause is the episode. It has no feed or local file to link to, or a link would show a private feed's address, as for a private feed that you have not added. See [Private feeds in notes and links](/private-feeds/#private-feeds-in-notes-and-links).

## Compensate for reaction time

To capture a few seconds before you react:

1. Open **Settings → PodNotes**.
2. Under **Notes**, set **Timestamp offset (s)** to that whole number of seconds.

With an offset of `5`, a capture at `00:12:46` inserts `00:12:41`, and ranges move back by the same amount. A capture never goes below `00:00:00`.

## <span id="settings"></span><span id="change-the-format"></span>Change what a capture inserts

**Timestamp template** under **Notes** decides what a capture inserts. It can hold text, Markdown, and line breaks around the [timestamp tags](/timestamps/#timestamp-tags). While an episode is loaded, the setting shows the result below its name. See [Example templates](/timestamps/#example-templates).

## Limits of capture and links

Captures and links behave differently in these cases:

- Without a loaded episode, a capture shows "Play an episode to capture". With an empty **Timestamp template**, it shows "Set a Timestamp template in settings to capture a timestamp."
- When a capture goes to the episode's note and **Episode note path** or **Episode note template** is empty, PodNotes shows "Set an episode note path and template to capture timestamps".
- `{{linktime}}` and `{{linksegment}}` insert plain text when the episode has no feed or local file to link to, or when a link would show a private feed's address.
- At the very start of an episode, a range command shows "Play more of the episode before capturing a segment".
- In a table cell, in Source mode and Live Preview, repeated captures stay in the cell you selected. PodNotes escapes pipe characters and turns line breaks into spaces. **Undo** works only while the whole note is as the capture left it.
- A link finds its episode by the ID the feed gives it, so it still works after the podcast renames the episode. A link without that ID, such as one captured before PodNotes 2.22.0, finds its episode by title, despite changes in case, punctuation, or word order. If the podcast renames such an episode with different words, the link shows "Episode not found".
- When PodNotes cannot fetch the feed, a link plays the episode from the copy of the feed that PodNotes saved on this device, if the copy lists the episode.
- A link that PodNotes captures for a private feed works on each device where you set that feed's address. See [Use private feeds](/private-feeds/).
- A link to a local file needs the file in your vault. If the file moved, PodNotes plays the one vault file with the same name. With no such file, it shows `No vault file is named "<name>".` With several, it asks you to update the link with the correct path. See [Downloads and local files](/local_files/).

## Reference

### Timestamp tags

**Timestamp template** accepts these four tags:

| Tag | Inserts |
| --- | --- |
| `{{time}}` | The playback time as plain text. |
| `{{linktime}}` | The playback time as a link to that moment. |
| `{{segment}}` | A range as plain text. In a single capture, the playback time. |
| `{{linksegment}}` | A range as a link. In a single capture, a link to the playback time. |

Each tag uses `HH:mm:ss` unless you add a [time format](/timestamps/#time-formats) after a colon, as in `{{linktime:H:mm:ss}}`.

The range commands adapt **Timestamp template** as follows. PodNotes uses a template that contains `{{segment}}` or `{{linksegment}}` unchanged. Otherwise `{{time}}` becomes `{{segment}}` and `{{linktime}}` becomes `{{linksegment}}`. A template with no time tag at all becomes `- {{linksegment}}`.

### <span id="example-formats"></span>Example templates

| Template | Inserts |
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
| `url` | Yes | Podcast feed URL, vault path of a media file, or the placeholder that stands for a private feed. |
| `episodeName` | Yes | Episode title. |
| `guid` | No | The episode's ID in the feed, its `<guid>`. PodNotes tries it before `episodeName`. |
| `time` | No | Start time in seconds, zero or greater. It can have decimals, but the whole value must be a number, so PodNotes refuses `12abc`. |
| `endTime` | No | End of a range in seconds, greater than `time`. Needs `time`. |
| `end` | No | Alias of `endTime`. |
| `to` | No | Alias of `endTime`. |

When a link has no `time`, or an empty one, the episode resumes from its saved progress. An unplayed or finished episode starts at zero. A `time` at or past the end of the episode pauses the episode 0.25 seconds before its end. When a link has more than one end parameter, `endTime` wins over `end`, and `end` wins over `to`.

A feed `url` must be an HTTP or HTTPS address on the internet, not on a local or private network. A private-feed placeholder resolves only through a saved podcast, with the feed address stored on that device or the copy of the feed saved there. A `url` that holds the private address of a saved podcast opens that podcast.

A vault path in `url` plays the file at that path, whether or not it is in **Local files**. When no file is at that path, PodNotes looks for the one vault file with the same file name.

PodNotes percent-encodes query values, and also reads links from older versions that encode a space as `+`. For a vault path, PodNotes tries the path as written first, then with each `+` as a space.

When the link points at the loaded episode, PodNotes plays it without fetching the feed. Otherwise it looks for the episode in the feed by `guid`, if exactly one episode has that ID. Then it matches `episodeName` to an episode title regardless of case, and otherwise to the one title with the same words in any order and with any punctuation.
