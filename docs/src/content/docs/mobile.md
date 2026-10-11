---
title: Use PodNotes on your phone
slug: mobile
description: Open the player, capture timestamps from the editor toolbar or a headset, and listen offline on iOS and Android.
---

On a phone, PodNotes works as it does on a computer, except that you open the player yourself and capture timestamps from the editor toolbar or a headset.
To install PodNotes, follow [Install PodNotes](/getting-started/#install-podnotes). The steps are the same on a phone.

## <span id="enable-podnotes-and-open-the-player"></span>Open the player

On a phone, PodNotes does not open the player when Obsidian starts. Open it yourself:

1. Pull down on a note to open the command palette.
2. Run **PodNotes: Show player**.

You can also select **Show PodNotes** in the menu of the navigation bar at the bottom of the screen.
The player opens in the right sidebar. To bring it back after you close it, run the command again.

![The PodNotes player in Obsidian's right sidebar on a phone, with episode artwork, title, progress, and skip buttons](/screenshots/mobile-player.webp)

To add your first podcast, see [Add and play podcasts](/podcasts/).
Most PodNotes commands appear only after you load an episode. A paused episode counts. [Commands](/commands/) lists when each one is available.

## Add a capture button to the editor toolbar

Obsidian lists **PodNotes: Capture Timestamp** only while a note is open in an editor. It lists **PodNotes: Capture Last 10 Seconds** and **PodNotes: Capture Last 20 Seconds** only while a note is open in an editor, an episode is loaded, and **Capture timestamp format** is set.

### Set up the button once

1. Open a note in editing view.
2. To add the range commands too, play an episode in PodNotes. You can pause it.
3. In **Settings → Interface**, select **Configure mobile toolbar**.
4. Under **Manage toolbar options**, select **Add a command...**.
5. Find and select **PodNotes: Capture Timestamp**.

To add a range button, repeat steps 4 and 5 with **PodNotes: Capture Last 10 Seconds** or **PodNotes: Capture Last 20 Seconds**.

### Capture from the toolbar

1. In PodNotes, play an episode.
2. In a note in editing view, place the cursor where the timestamp goes.
3. In the editor toolbar, select the clock button.

![A note on a phone with three captured timestamp links and the editor toolbar, whose first button is the clock that captures a timestamp](/screenshots/mobile-toolbar.webp)

PodNotes inserts a timestamp link at the cursor. If no episode is loaded, the button shows a notice instead.
If your timestamps come out as plain text, set **Capture timestamp format** in **Settings → PodNotes** to `- {{linktime}}` with a space at the end. [Make timestamps clickable](/timestamps/#make-timestamps-clickable) explains the fix.

## Capture with a headset

While an episode plays, press the headset button that sends the previous-track action. PodNotes captures a timestamp:

- If a note is open in an editor, the timestamp goes in at the cursor.
- If no note is open, the timestamp goes at the end of the episode's note. PodNotes creates the note if it does not exist, as long as **Note creation file path** and **Note creation template** are set.

Headset capture works on a phone or a computer, but not every headset sends the previous-track action. Play and pause do not capture a timestamp.

## Download an episode

Download episodes while you are online, and wait for the notice that says each download succeeded.
On a phone, open an episode's menu with its **More options** button, the three-dot button. [Download an episode](/local_files/#download-an-episode) has the steps and explains where the file goes.

## Play your own audio and video

On a phone, long-press a media file in the file explorer instead of right-clicking it.
[Play your own audio and video](/local_files/#play-your-own-audio-and-video) has the steps and lists the file types PodNotes plays.

## <span id="known-limits-and-verified-devices"></span>Limits on phones

- Playback depends on the codecs your phone supports. A file that plays on a computer can fail on a phone.
- Headset gestures vary. Which press sends previous track depends on the headset and the phone, and some send none.
- API keys stay on each device, so add them on your phone too. A protected private feed works on one device at a time. See [API keys and private feeds on each device](/sync/#secrets-on-each-device).
- A download made on another device plays only after its media file has synced to this one. See [Downloads on another device](/sync/#downloads-on-another-device).
