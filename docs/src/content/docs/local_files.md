---
title: Downloads and local files
slug: local_files
description: Download episodes to listen offline, play audio and video files from your vault, and remove them again.
---

Download episodes to listen offline, and play audio and video files from your vault in the PodNotes player.

## Download an episode

To download the episode in the player:

1. Run **PodNotes: Download Playing Episode**.

To download any other episode:

1. Right-click the episode, or select the three-dot button at the end of its row.
2. Select **Download**.

A notice shows the progress. PodNotes saves the file in your vault at **Download path**, `PodNotes/{{podcast}}/{{title}}` by default, and adds the file extension.
The episode then appears on the **Local files** page and plays from the file. If the episode is playing when its download finishes, it keeps playing without a break, and PodNotes plays the file the next time it loads the episode.

Keep `{{title}}` in **Download path**. Without it, two episodes can resolve to the same file, and the second download fails. **Settings → PodNotes** shows a warning under the setting when `{{title}}` is missing. [Template tags](/templates/#file-path-tags) lists the tags a path accepts.

Offline playback needs the file on the device you listen on. If you sync your vault, see [Downloads on another device](/sync/#downloads-on-another-device).

## Play your own audio and video

1. In the file explorer, right-click an audio or video file. On a phone, long-press it.
2. Select **Play with PodNotes**.

MP4 and WebM files can hold audio or video, so their menu offers **Play as audio with PodNotes** and **Play as video with PodNotes** instead.

You can also pick a file in the PodNotes view:

1. On the **Local files** page, select **Add a vault file**, the plus button at the top right. When your library is empty, select **Play a vault file** instead.
2. Type part of the file's path, and select the file.

The picker plays MP4 and WebM files as video. Either way, PodNotes plays the file, opens the full player, and adds the file to **Local files**.

PodNotes plays MP3, M4A, AAC, OGG, WAV, FLAC, WMA, AMR, MP4, M4V, MOV, WebM, and OGV files. Whether a file plays also depends on the codecs your device supports.

## <span id="find-your-files-in-local-files"></span>Find your files on the Local files page

The **Local files** page lists every episode you have offline: your downloads and the files you played from your vault. In a narrow view, select **Local files** in the Library. In a wide view, select it in the list on the left. Your own files show a music or video icon instead of artwork, and their folder in the vault instead of a podcast's name.

## Remove a download or a local file

1. Right-click the episode, or select the three-dot button at the end of its row.
2. Select **Remove download** for a download, or **Remove from Local files** for your own file.

**Remove from Local files** keeps your file in the vault. **Remove download** removes the episode from **Local files** and moves its file to the trash.
Where a trashed file goes depends on Obsidian's **Deleted files** setting in **Settings → Files and links**. If that setting deletes files permanently, so does PodNotes.

If PodNotes cannot confirm that it downloaded a file, as with downloads from older versions, it asks first. Select **Keep file** to leave the file in your vault, or **Delete file** to move it to the trash. Either way, the episode leaves **Local files**.

Your notes and timestamp links stay. Links to a download stream the episode from its feed again while the feed still lists it. Links to your own file keep working while the file stays in your vault. See [What happens to notes and links when I remove a download?](/faq/#what-happens-to-notes-and-links-when-i-remove-a-download)

## Move or rename your files

When you move or rename a media file in Obsidian, PodNotes follows it in **Local files**, the queue, **Favorites**, your playlists, and the player. It also follows the files of your downloads. The episode keeps its name in PodNotes, its position, and its note. A file that is playing keeps playing.

Timestamp links to a file you added yourself keep the file's old path. After a move, such a link still plays the file if no other vault file has the same name. After a rename, capture the timestamp again. Links to a download point at the feed episode, so they keep working.

PodNotes does not see a move or a rename made while it is off or outside Obsidian. When a file is gone from its path, its episode shows "Could not load this episode's media." when you play it. To clear the entry, remove it as [Remove a download or a local file](/local_files/#remove-a-download-or-a-local-file) describes.

## Listen offline

When the device is offline, the PodNotes view shows **Offline** at the top. Downloads and your own files play as usual.

- Episode lists split into **Available offline** and **Needs a connection**. The Queue and **Local files** pages do not split.
- An episode under **Needs a connection** does not play. Selecting it shows "Not downloaded".
- Lists show the episodes from the copy of each feed on this device. See [When a feed cannot be reached](/podcasts/#when-a-feed-cannot-be-reached).
- Podcast search, refreshing feeds, **Set feed address**, and transcription need a connection. The transcribe commands are missing from the command palette while offline.

Notes, timestamps, the queue, and playlists work offline.

## What works with local files

A local file works like a podcast episode. You can capture timestamps, create an episode note, and resume where you stopped. Transcription works for local audio but not for video. For a local audio file, the full player shows a music icon instead of artwork. A local video plays in the full player, as [Watch video](/player/#watch-video) describes. The **Transcript** panel says "No transcript yet".
PodNotes uses `local file` as the podcast name, so `{{podcast}}` in a note path resolves to `local file`.
A timestamp link to a local file plays on any device where the file is in your vault, whether or not it is in **Local files**. If the file is no longer at the link's path, PodNotes plays the one vault file with the same name. See [Limits of capture and links](/timestamps/#limits-of-capture-and-links).
