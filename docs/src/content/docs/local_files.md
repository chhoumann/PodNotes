---
title: Downloads and local files
slug: local_files
description: Download episodes to listen offline, play audio and video files from your vault, and remove them again.
---

Download episodes to listen offline, and play audio and video files from your vault in the PodNotes player.

## Download an episode

To download the episode in the player, run **PodNotes: Download Playing Episode**.
To download any other episode, right-click it or select its **More options** button, the three-dot button. Then select **Download**.

A notice shows the progress. PodNotes saves the file in your vault at **Episode download path**, `PodNotes/{{podcast}}/{{title}}` by default, and adds the file extension.
The episode then appears in the **Local Files** playlist and plays from the file.

Keep `{{title}}` in **Episode download path**. Without it, two episodes can resolve to the same file, and the second download fails. [Template tags](/templates/#file-path) lists the tags a path accepts.

Offline playback needs the file on the device you listen on. If you sync your vault, see [Downloads on another device](/sync/#downloads-on-another-device).

## Play your own audio and video

1. In the file explorer, right-click an audio or video file. On a phone, long-press it.
2. Select **Play with PodNotes**.

MP4 and WebM files can hold audio or video, so their menu offers **Play as audio with PodNotes** and **Play as video with PodNotes** instead.

PodNotes plays MP3, M4A, AAC, OGG, WAV, FLAC, WMA, AMR, MP4, M4V, MOV, WebM, and OGV files. Whether a file plays also depends on the codecs your device supports.

## Find your files in Local Files

The **Local Files** playlist in the podcast grid lists every episode you have offline. It holds your downloads and the files you played with **Play with PodNotes**.

## Remove a download or a local file

1. Right-click the episode or select its **More options** button.
2. Select **Remove file** for a download, or **Remove from Local Files** for your own file.

**Remove from Local Files** keeps your file in the vault. **Remove file** removes the episode from **Local Files** and moves its file to the trash.
Where a trashed file goes depends on Obsidian's **Deleted files** setting in **Settings → Files and links**. If that setting deletes files permanently, so does PodNotes.

If PodNotes cannot confirm that it downloaded a file, as with downloads from older versions, it asks first. Select **Keep file** to leave the file in your vault, or **Delete file** to move it to the trash. Either way, the episode leaves **Local Files**.

Your notes and timestamp links stay. See [What happens to notes and links when I remove a download?](/faq/#what-happens-to-notes-and-links-when-i-remove-a-download)

## What works with local files

A local file works like a podcast episode. You can capture timestamps, create an episode note, and resume where you stopped. Transcription works for local audio but not for video.
PodNotes uses `local file` as the podcast name, so `{{podcast}}` in a note path resolves to `local file`.
A timestamp link to a local file plays only on a device where the file is in your vault and in **Local Files**.
