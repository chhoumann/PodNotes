---
title: Use the player
slug: player
description: Play, pause, skip, and change the speed in the mini player and the full player, and use the Chapters, Transcript, and Up next panels.
---

Control playback from the mini player at the bottom of the PodNotes view, or from the full player over it. Playback keeps going while you browse, change settings, or close the PodNotes view.

## Open the full player

When you select an episode in a list, PodNotes plays it and opens the full player over the view. When you select the episode that is already loaded, PodNotes opens the full player without changing playback. If the episode is paused, select **Play** there. To open the full player again later, do one of these:

- Select the mini player's episode title or artwork.
- Run **PodNotes: Show player** from the command palette (`Ctrl+P`, or `Command+P` on macOS).

To close the full player, select **Collapse player**, the down arrow at the top left, or press `Escape`. The episode keeps playing, and the mini player shows it.

## Use the mini player

The mini player sits at the bottom of every page of the view while an episode is loaded. It shows the episode, its podcast, and the time left.

- In a narrow view, such as the sidebar or a phone, a thin line above it shows the progress. It has **Capture timestamp**, the clock button, and **Play** or **Pause**.
- In a wide view, it shows the elapsed time, a progress bar, and the time left, then **Timestamp** and **Play** or **Pause**.

The capture button inserts a timestamp into your note. See [Capture timestamps](/timestamps/).

## Control playback

![The full player in the sidebar: artwork, title, a progress bar split into chapters, playback controls, Timestamp and Open note, and the panel buttons](/screenshots/player.webp)

From top to bottom, the full player shows:

- The artwork, the episode title, and the podcast's name. Select the podcast's name to open its page.
- The progress bar. Drag it, or select a point on it, to move there. With chapters, the bar has a gap at the start of each chapter.
- The elapsed time, the current chapter, and the time left. Select the chapter's title to open **Chapters**.
- The speed, such as `1.25×`, the skip buttons, **Play** or **Pause**, and the volume button.
- **Timestamp** and **Create note** or **Open note**.
- **Chapters**, **Transcript**, and **Up next**. See [Use the panels](/player/#use-the-panels).

The skip buttons show their length in seconds. They move back by **Skip back (s)** and forward by **Skip forward (s)**, 15 seconds by default. Change both under **Playback** in **Settings → PodNotes**.

The volume button opens a slider. PodNotes uses one volume for every episode and keeps it when Obsidian restarts.

**Episode options**, the three-dot button at the top right, opens the [episode menu](/podcasts/#episode-menu-reference), without **Play** and **Mark as played**.

### Change the speed

1. In the full player, select the speed button.
2. Select a speed from `0.75×` to `2×`.

The speed lasts until a different episode loads. That episode, and the first one after Obsidian starts, plays at **Default speed**, which you set under **Playback** in **Settings → PodNotes**. **PodNotes: Increase playback rate** and **PodNotes: Decrease playback rate** change the speed by 0.1, from `0.5×` to `4×`. See [Commands](/commands/#increase-playback-rate).

## Take notes from the player

- **Timestamp** inserts the playback time as a link in your note, and reads **Added** for a moment. See [Capture timestamps](/timestamps/).
- **Create note** creates the episode's note and opens it. Once the note exists, the button reads **Open note**. See [Create episode notes](/notes/).

## Use the panels

The full player has three panels:

- **Chapters** lists the episode's chapters. It appears only when the episode's feed gives chapters.
- **Transcript** shows the transcript that the episode's feed publishes.
- **Up next** shows the queue.

In a narrow view, the panel buttons are at the bottom of the full player. Select one to show its panel in place of the artwork, and select it again to hide the panel. In a wide view, such as a tab in the main area, the panels are tabs beside the player.

### Chapters

Each chapter shows its start time and title, and the current chapter is highlighted. Select a chapter to play from its start.

### Read the transcript

The panel loads the transcript that the episode's feed publishes. Its top line reads **Feed transcript** and **Free**.

![The Transcript panel of the full player, with timed lines, speaker names, and the current line highlighted](/screenshots/transcript.webp)

- Select a line to play from that moment. Lines without a time cannot be selected.
- The panel highlights the line being spoken and scrolls with it. When you scroll yourself, it stops following. Select **Follow** to go back to the current line.
- To search, select **Find in transcript**, the magnifier, and type. The panel shows only the lines that match. Press `Enter` for the next match and `Shift+Enter` for the previous one. Press `Escape` or select **Close find** to show every line again.
- **Save as note** saves the feed's transcript as a note, as **PodNotes: Transcribe current episode** does. It never transcribes the audio. See [Transcribe episodes](/transcripts/#read-the-transcript-in-the-player).

When the feed publishes no transcript, the panel says "No transcript in this feed". For an audio episode, it offers a button marked **Paid**: **Transcribe with OpenAI**, or **Transcribe with Deepgram** when your speaker labels come from Deepgram. It transcribes the audio with your own API key, and your provider bills you for it. Without the key on this device, a notice asks you to add it. The result is a transcript note, which PodNotes opens. The panel shows only transcripts that feeds publish. See [Set up an OpenAI key](/transcripts/#set-up-an-openai-key) and [What transcription costs](/transcripts/#what-transcription-costs). Offline, the transcribe button and **Save as note** are turned off.

### Up next

The panel shows the episodes in the queue and their total time left. Select an episode to play it.

- To reorder, drag an episode by its grip, the six dots on its left. With the keyboard, move the focus to the grip and press `Up` or `Down`.
- To remove an episode, select its **Remove from queue** button, the cross on its right.
- **Edit** opens the Queue page. See [Use the queue and playlists](/playlists/).

## Use the keyboard

These keys work while the full player is open and the PodNotes view is active, for example after you select something in it:

| Key | What it does |
| --- | --- |
| `Space` | Plays or pauses. On a button, a field, or the progress bar, it does that control's own job. |
| `Escape` | Closes the volume slider, then the transcript search, then the full player. A menu closes first. |

These keys work on the control that has focus:

| Control | Keys |
| --- | --- |
| The progress bar | `Left` and `Right` move 5 seconds, `Page Down` and `Page Up` move 30 seconds, and `Home` and `End` go to the start and the end. `Down` and `Up` work as `Left` and `Right`. |
| A panel tab, in a wide view | `Left` and `Right` move to the previous or next panel, and `Home` and `End` go to the first or last. |
| A grip in **Up next** or on the Queue page | `Up` and `Down` move the episode one place. |

## Where playback starts

- An episode resumes where you stopped. An episode you finished starts from the beginning.
- When Obsidian starts, the mini player shows the episode you played last, paused at its saved position. It plays when you play it.
- When an episode ends, PodNotes marks it played and removes it from the queue and from your own playlists. It stays in **Favorites**. With **Queue episodes I switch away from** on, the first episode in the queue then starts.
- A move to the very end pauses the episode 0.25 seconds before its end.
- When you play an episode that ended, it starts from the beginning. It plays from a later position instead when you moved the position after it ended, or when another device synced a position before the end. See [Sync between devices](/sync/#use-podnotes-on-two-devices).

## Watch video

A video episode plays in the full player while the PodNotes view is in the main window. Select the video to play or pause. To watch it on the whole screen, select **Fullscreen**, the button at its bottom right. The button hides in full screen, so press `Escape` to leave it.

When the PodNotes view is in a popout window, the player there shows the episode's artwork, and the video keeps playing. In a narrow view, an open panel takes the video's place while the video plays.

## When an episode cannot play

When an episode's media cannot load, the full player shows "Could not load this episode's media." and a **Retry** button. The playback controls are turned off until the media loads, and **Timestamp** and **Create note** still work. A downloaded or local file that is gone from its path also shows this message. See [Downloads and local files](/local_files/#move-or-rename-your-files).
