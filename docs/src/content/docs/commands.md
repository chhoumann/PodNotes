---
title: Commands
slug: commands
description: Every PodNotes command with its command palette name, its ID, and when it is available.
---

Obsidian lists each PodNotes command with the **PodNotes:** prefix, but only while its condition below holds. The same rule applies in the command palette and when you add a command to the mobile toolbar.

| Command | ID | Available when |
| --- | --- | --- |
| [Show player](/commands/#show-player) | `podnotes:podnotes-show-leaf` | Always |
| [Play Podcast](/commands/#play-podcast) | `podnotes:start-playing` | An episode is loaded, and it is not playing or starting to play |
| [Stop Podcast](/commands/#stop-podcast) | `podnotes:stop-playing` | An episode is playing or starting to play |
| [Toggle playback](/commands/#toggle-playback) | `podnotes:podnotes-toggle-playback` | An episode is loaded |
| [Skip Backward](/commands/#skip-backward) | `podnotes:skip-backward` | An episode is loaded |
| [Skip Forward](/commands/#skip-forward) | `podnotes:skip-forward` | An episode is loaded |
| [Increase playback rate](/commands/#increase-playback-rate) | `podnotes:increase-playback-rate` | An episode is loaded |
| [Decrease playback rate](/commands/#decrease-playback-rate) | `podnotes:decrease-playback-rate` | An episode is loaded |
| [Reset playback rate](/commands/#reset-playback-rate) | `podnotes:reset-playback-rate` | An episode is loaded |
| [Reorder Queue](/commands/#reorder-queue) | `podnotes:reorder-queue` | Always |
| [Download Playing Episode](/commands/#download-playing-episode) | `podnotes:download-playing-episode` | An episode is loaded |
| [Capture Timestamp](/commands/#capture-timestamp) | `podnotes:capture-timestamp` | Always |
| [Capture Last 10 Seconds](/commands/#capture-last-10-seconds--capture-last-20-seconds) | `podnotes:capture-segment-10s` | Always |
| [Capture Last 20 Seconds](/commands/#capture-last-10-seconds--capture-last-20-seconds) | `podnotes:capture-segment-20s` | Always |
| [Create episode note](/commands/#create-episode-note) | `podnotes:create-podcast-note` | **Episode note path** and **Episode note template** are set, and an episode is loaded or you added at least one podcast |
| [Create podcast feed note](/commands/#create-podcast-feed-note) | `podnotes:create-podcast-feed-note` | You added at least one podcast, and **Podcast note path** and **Podcast note template** are set |
| [Copy universal episode link to clipboard](/commands/#copy-universal-episode-link-to-clipboard) | `podnotes:get-share-link-episode` | An episode is loaded |
| [Transcribe current episode](/commands/#transcribe-current-episode) | `podnotes:podnotes-transcribe` | An audio episode is loaded, and the device is online |
| [Transcribe current episode from audio](/commands/#transcribe-current-episode-from-audio) | `podnotes:podnotes-transcribe-audio` | An audio episode is loaded, and the device is online |

A paused episode counts as loaded, and so does the episode that PodNotes restores, paused, when Obsidian starts. Hotkeys and workflow plugins use the ID.

## Show player

Reveals the PodNotes view, or opens it in the right sidebar when it is not open. When an episode is loaded, it also opens the full player. The **Show PodNotes** ribbon action only reveals the view.

## Play Podcast

Plays the loaded episode from where it is. After Obsidian starts, that is the episode PodNotes restored, at its saved position. A finished episode starts over, unless you moved its position after it ended, or another device synced a position before the end.

## Stop Podcast

Pauses the episode and keeps its position.

## Toggle playback

Plays the loaded episode when it is paused, and pauses it when it is playing.

## Skip Backward

Moves back by **Skip back (s)**, 15 seconds by default. It never moves before the start.

## Skip Forward

Moves forward by **Skip forward (s)**, 15 seconds by default, and keeps the episode playing or paused. When the duration is known, a skip that would reach the last 0.25 seconds stops 0.25 seconds before the end, or stays where it is when the position is already closer to the end. A playing episode then ends, and the next episode in the queue starts if **Queue episodes I switch away from** is on.

## Increase playback rate

Raises the speed by 0.1, up to `4×`. The speed keeps hundredths, so `1.25×` becomes `1.35×`.

## Decrease playback rate

Lowers the speed by 0.1, down to `0.5×`.

## Reset playback rate

Sets the speed to **Default speed**.

## Reorder Queue

Opens the PodNotes view on the Queue page, and closes the full player. Drag an episode by its grip to move it, or select its cross to remove it. See [Reorder the queue](/playlists/#reorder-the-queue).

## Download Playing Episode

Downloads the loaded episode to **Download path**, `PodNotes/{{podcast}}/{{title}}` by default. PodNotes adds the file extension.
If another episode's file already exists at that path, the download fails. See [Download an episode](/local_files/#download-an-episode).

## Capture Timestamp

Inserts a timestamp, formatted by **Timestamp template**, at the cursor of the note you are editing. If you are not editing a note, it goes to the note you edited last, if that note is still open in editing view. Otherwise, it goes to the end of the episode's note. See [Choose where a timestamp goes](/timestamps/#choose-where-a-timestamp-goes).
The default format is `- {{linktime}}` with a space at the end. It makes a list item with a timestamp link.
After each capture, a notice says where the timestamp went and offers **Undo**. With **QuickAdd choice** set, the choice decides where it goes, and there is no **Undo**. See [Undo a capture](/timestamps/#undo-a-capture).
Obsidian always lists the command, so you can add it to the mobile toolbar before you play anything. Without a loaded episode, it shows "Play an episode to capture". See [Capture timestamps](/timestamps/).

## <span id="capture-last-10-seconds-capture-last-20-seconds"></span>Capture Last 10 Seconds / Capture Last 20 Seconds

Inserts the last 10 or 20 seconds of playback as a range, in the style of **Timestamp template**, where [Capture Timestamp](/commands/#capture-timestamp) would insert a timestamp. With the default format, the range is a link that plays from the start of the range and pauses at its end.
Obsidian always lists these commands. To add them to the mobile toolbar, see [Add a capture button to the editor toolbar](/mobile/#add-a-capture-button-to-the-editor-toolbar).
Without a loaded episode, they show "Play an episode to capture". Early in an episode, PodNotes shows a notice to play more first. See [Capture a range](/timestamps/#capture-a-range).

## Create episode note

Creates a note for the loaded episode from **Episode note template** at **Episode note path**, or opens the note if it exists.
With no episode loaded, it asks you to select a podcast, then an episode, and creates or opens that episode's note. Nothing starts playing.
The ID keeps the command's former name, Create Podcast Note. See [Create episode notes](/notes/).

## Create podcast feed note

Opens a list of the podcasts you added, with the loaded episode's podcast first. Creates a note for the podcast you select, or opens the note if it exists.
No episode needs to be loaded. See [Create a podcast note](/notes/#create-a-podcast-note).

## Copy universal episode link to clipboard

Copies a pod.link URL for the loaded episode, to share with people who use other podcast apps. It is not a PodNotes timestamp link.
PodNotes finds the show in the Apple Podcasts directory and the episode on pod.link. If either is missing, it shows a notice instead.

## Transcribe current episode

Saves a transcript of the loaded episode at **Transcript path**. For a podcast you added, when the episode's feed lists a transcript in a format that PodNotes reads, PodNotes saves that one, with no API key. Otherwise, it transcribes the audio with the selected provider. It works for podcast episodes and local audio, but not for video.
If the transcript file already exists, PodNotes keeps it and does not transcribe again.
If PodNotes needs to transcribe the audio but this device has no API key for the selected provider, the command transcribes nothing and shows a notice that names the key to add. See [Transcribe episodes](/transcripts/).

## Transcribe current episode from audio

Transcribes the audio of the loaded episode with the selected provider and your API key, even when the feed publishes a transcript. Your provider bills your account for it. Otherwise it works like [Transcribe current episode](/commands/#transcribe-current-episode).
