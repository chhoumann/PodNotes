---
title: Use PodNotes on your phone
slug: mobile
description: Open the player, capture timestamps from the editor toolbar or a headset, and listen offline on iOS and Android.
---

Open the player, capture timestamps from the editor toolbar or a headset, and listen offline on iOS and Android.
To install PodNotes, follow [Install PodNotes](/getting-started/#install-podnotes). The steps are the same on a phone.

## <span id="enable-podnotes-and-open-the-player"></span>Open the player

On a phone, PodNotes does not open the player when Obsidian starts. Open it yourself:

1. In the navigation bar, select **Open menu**.
2. Select **Show PodNotes**.

You can also run **PodNotes: Show player** from the command palette.
The player opens in the right sidebar. To bring it back after you close it, select **Show PodNotes** again.

To add your first podcast, see [Add and play podcasts](/podcasts/).
Most PodNotes commands appear only after you load an episode. A paused episode counts. [Commands](/commands/) lists when each one is available.

## Add a capture button to the editor toolbar

1. In **Settings → Interface**, select **Configure mobile toolbar**.
2. Under **Manage toolbar options**, select **Add a command...**.
3. Find and select **PodNotes: Capture Timestamp**.
4. In PodNotes, play an episode.
5. In a note in edit mode, place the cursor where the timestamp goes.
6. In the editor toolbar, select the clock button.

PodNotes inserts a timestamp link at the cursor. If no episode is loaded, the button shows a notice instead.
If your timestamps come out as plain text, set **Capture timestamp format** to `- {{linktime}} ` in **Settings → PodNotes**. [Capture timestamps](/timestamps/) explains the format.

**PodNotes: Capture Last 10 Seconds** and **PodNotes: Capture Last 20 Seconds** can go on the toolbar too. Obsidian lists them only while an episode is loaded, so load one before you add them.

## Capture with a headset

While an episode plays, press your headset's previous-track control. PodNotes captures a timestamp:

- If a note is open in an editor, the timestamp goes in at the cursor.
- If no note is open, the timestamp goes at the end of the episode's note. PodNotes creates the note if it does not exist, as long as **Note creation file path** and **Note creation template** are set.

Play and pause do not capture a timestamp.

## Download an episode

Download an episode before you go offline. Run **PodNotes: Download Playing Episode**, or select the ⋮ button next to an episode and select **Download**.
Wait for the notice that says the download succeeded. [Downloads and local files](/local_files/) explains where the file goes and how to remove it.

## Play your own audio and video

In the file explorer, long-press an audio or video file and select **Play with PodNotes**.
For MP4 and WebM files, select **Play as audio with PodNotes** or **Play as video with PodNotes**.
[Downloads and local files](/local_files/#play-your-own-audio-and-video) lists the file types PodNotes plays.

## <span id="known-limits-and-verified-devices"></span>Known limits

- Playback depends on the codecs your phone supports. A file that plays on desktop can fail on a phone.
- Headset gestures vary. Which press sends previous track depends on the headset and the phone, and some send none.
- API keys and private feed URLs that PodNotes keeps in Obsidian's secret storage do not sync. Enter them again on each device. See [Secrets on each device](/sync/#secrets-on-each-device).
- A download made on another device plays only after its media file has synced to this one. See [Downloads on another device](/sync/#downloads-on-another-device).
