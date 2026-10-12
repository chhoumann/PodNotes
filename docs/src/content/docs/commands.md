---
title: Commands
slug: commands
description: Every PodNotes command with its command palette name, its ID, and when it is available.
---

Obsidian lists each PodNotes command with the **PodNotes:** prefix, but only while its condition below holds. The same rule applies in the command palette and when you add a command to the mobile toolbar.

| Command | ID | Available when |
| --- | --- | --- |
| [Show player](#show-player) | `podnotes:podnotes-show-leaf` | Always |
| [Play Podcast](#play-podcast) | `podnotes:start-playing` | An episode is loaded and paused |
| [Stop Podcast](#stop-podcast) | `podnotes:stop-playing` | An episode is playing |
| [Toggle playback](#toggle-playback) | `podnotes:podnotes-toggle-playback` | An episode is loaded |
| [Skip Backward](#skip-backward) | `podnotes:skip-backward` | An episode is loaded |
| [Skip Forward](#skip-forward) | `podnotes:skip-forward` | An episode is loaded |
| [Increase playback rate](#increase-playback-rate) | `podnotes:increase-playback-rate` | An episode is loaded |
| [Decrease playback rate](#decrease-playback-rate) | `podnotes:decrease-playback-rate` | An episode is loaded |
| [Reset playback rate](#reset-playback-rate) | `podnotes:reset-playback-rate` | An episode is loaded |
| [Reorder Queue](#reorder-queue) | `podnotes:reorder-queue` | The queue has two or more episodes |
| [Download Playing Episode](#download-playing-episode) | `podnotes:download-playing-episode` | An episode is loaded |
| [Capture Timestamp](#capture-timestamp) | `podnotes:capture-timestamp` | A note is open in an editor |
| [Capture Last 10 Seconds](#capture-last-10-seconds--capture-last-20-seconds) | `podnotes:capture-segment-10s` | A note is open in an editor, an episode is loaded, and **Capture timestamp format** is set |
| [Capture Last 20 Seconds](#capture-last-10-seconds--capture-last-20-seconds) | `podnotes:capture-segment-20s` | A note is open in an editor, an episode is loaded, and **Capture timestamp format** is set |
| [Create episode note](#create-episode-note) | `podnotes:create-podcast-note` | An episode is loaded, and **Note creation file path** and **Note creation template** are set |
| [Create podcast feed note](#create-podcast-feed-note) | `podnotes:create-podcast-feed-note` | You follow at least one podcast, and **Feed note file path** and **Feed note template** are set |
| [Copy universal episode link to clipboard](#copy-universal-episode-link-to-clipboard) | `podnotes:get-share-link-episode` | An episode is loaded |
| [Transcribe current episode](#transcribe-current-episode) | `podnotes:podnotes-transcribe` | An audio episode is loaded |

A paused episode counts as loaded. Hotkeys and workflow plugins use the ID.

## Show player

Opens the player in the right sidebar, or reveals it when it is already open. The **Show PodNotes** ribbon action does the same.

## Play Podcast

Starts the loaded episode.

## Stop Podcast

Pauses the episode and keeps its position.

## Toggle playback

Plays the loaded episode when it is paused, and pauses it when it is playing.

## Skip Backward

Moves back by **Skip backward length (s)**, 15 seconds by default. It never moves before the start.

## Skip Forward

Moves forward by **Skip forward length (s)**, 15 seconds by default. When the duration is known, a forward skip stops 0.25 seconds before the end.

## Increase playback rate

Raises the speed by 0.1x, up to 4x.

## Decrease playback rate

Lowers the speed by 0.1x, down to 0.5x.

## Reset playback rate

Sets the speed to **Default Playback Rate**.

## Reorder Queue

Opens the **Reorder Queue** window. Each episode has buttons to move it to the top, up, down, or to the bottom, and to remove it from the queue. See [Reorder the queue](/playlists/#reorder-the-queue).

## Download Playing Episode

Downloads the loaded episode to **Episode download path**, `PodNotes/{{podcast}}/{{title}}` by default. PodNotes adds the file extension.
If another episode's file already exists at that path, the download fails. See [Download an episode](/local_files/#download-an-episode).

## Capture Timestamp

Inserts a timestamp at the cursor, formatted by **Capture timestamp format**. The default format is `- {{linktime}}` with a space at the end. It makes a list item with a timestamp link.
Obsidian lists the command only while a note is open in an editor. It does not need a loaded episode, so you can add it to the mobile toolbar before you play anything. Without an episode or with an empty format, it shows a notice. See [Capture timestamps](/timestamps/).

## <span id="capture-last-10-seconds-capture-last-20-seconds"></span>Capture Last 10 Seconds / Capture Last 20 Seconds

Inserts the last 10 or 20 seconds of playback at the cursor as a range, in the style of **Capture timestamp format**. With the default format, the range is a link that plays from the start of the range and pauses at its end.
Obsidian lists these commands only while a note is open in an editor, an episode is loaded, and **Capture timestamp format** is set. To add them to the mobile toolbar, see [Add a capture button to the editor toolbar](/mobile/#add-a-capture-button-to-the-editor-toolbar).
Early in an episode, PodNotes shows a notice to play more first. See [Capture a range](/timestamps/#capture-a-range).

## Create episode note

Creates a note for the loaded episode from **Note creation template** at **Note creation file path**, or opens the note if it exists.
The ID keeps the command's former name, Create Podcast Note. See [Create episode notes](/notes/).

## Create podcast feed note

Opens a list of the podcasts you follow, with the playing episode's podcast first. Creates a note for the podcast you select, or opens the note if it exists.
No episode needs to be loaded. See [Create a feed note for a podcast](/notes/#create-a-feed-note-for-a-podcast).

## Copy universal episode link to clipboard

Copies a pod.link URL for the loaded episode, to share with people who use other podcast apps. It is not a PodNotes timestamp link.
PodNotes finds the show in the Apple Podcasts directory. If the show or the episode is not there, it shows a notice instead.

## Transcribe current episode

Transcribes the loaded episode and saves the transcript at **Transcript file path**. It works for podcast episodes and local audio, but not for video.
If the transcript file already exists, PodNotes keeps it and does not transcribe again.
Without an API key for the selected provider, it shows a notice that names the key to add. See [Transcribe episodes](/transcripts/).
