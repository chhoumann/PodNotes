---
title: Use PodNotes on your phone
slug: mobile
description: Open the player, capture timestamps from the editor toolbar, control playback from a headset, and listen offline on iOS and Android.
---

Listen and capture timestamps on your phone. You open the player yourself, and besides the command palette, you can capture from the editor toolbar.
To install PodNotes, follow [Install PodNotes](/getting-started/#install-podnotes). The steps are the same on a phone.

## <span id="enable-podnotes-and-open-the-player"></span>Open the player

On a new install, PodNotes opens its view once. After that, the view stays closed when Obsidian starts. To open it:

1. Pull down on a note to open the command palette.
2. Run **PodNotes: Show player**.

You can also select **Show PodNotes** in the menu of the navigation bar at the bottom of the screen. The player opens in the right sidebar. To return to your note, select outside the sidebar.

![The PodNotes player in Obsidian's right sidebar on a phone, with episode artwork, title, progress, and skip buttons](/screenshots/mobile-player.webp)

To add your first podcast, see [Add and play podcasts](/podcasts/). Most commands appear only while an episode is loaded. When Obsidian starts, PodNotes restores the episode you played last, paused, so these commands work before you open the view. See [Commands](/commands/).

## Add a capture button to the editor toolbar

### Set up the button once

1. In **Settings → Interface**, select **Configure mobile toolbar**.
2. Select **Add a command...** under **Manage toolbar options**.
3. Find and select **PodNotes: Capture Timestamp**. Its button shows a clock.

To add a range button, repeat steps 2 and 3 with **PodNotes: Capture Last 10 Seconds** or **PodNotes: Capture Last 20 Seconds**.

### Capture from the toolbar

1. In PodNotes, play an episode.
2. Select outside the sidebar to return to your note.
3. In editing view, place the cursor where the timestamp goes.
4. In the editor toolbar, select the clock button.

![A note on a phone with three captured timestamp links and the editor toolbar, whose first button is the clock that captures a timestamp](/screenshots/mobile-toolbar.webp)

PodNotes inserts a timestamp link at the cursor, or shows "Play an episode to capture" when no episode is loaded. If your timestamps come out as plain text, see [Make timestamps clickable](/timestamps/#make-timestamps-clickable).

## <span id="capture-with-a-headset"></span>Control playback from a headset or the lock screen

On Android, Obsidian does not pass headset buttons or lock screen controls to PodNotes, so they do not work there. On an iPhone or iPad, they should work as on a computer, but they are not tested yet.

Where your system passes them on, these controls work while an episode is loaded, playing or paused:

| Control | What it does |
| --- | --- |
| Play and pause | Plays or pauses the episode. |
| Skip backward and skip forward | Moves by **Skip backward length (s)** or **Skip forward length (s)**, 15 seconds by default. |
| Next track | Jumps forward 30 seconds. |
| Previous track | Captures a timestamp. |
| A point on the system's progress bar | Jumps to that point. |

The lock screen and your system's media controls show the episode's title, the podcast's name, and the artwork. Which press sends which control depends on the headset. A triple press often sends previous track, and some headsets send none.

A capture from a headset goes where a capture command goes: into the note you are editing, else into the note you edited last, else at the end of the episode's note. See [Choose where a timestamp goes](/timestamps/#choose-where-a-timestamp-goes).

## Download an episode

Download episodes while you are online, and wait for the notice that says each download succeeded. On a phone, the episode menu opens from the three-dot **More options** button. See [Download an episode](/local_files/#download-an-episode).

If the episode is playing when its download finishes, it keeps playing without a break. PodNotes plays the downloaded file the next time it loads the episode.

## Play your own audio and video

Long-press a media file in the file explorer, where a computer uses a right-click. See [Play your own audio and video](/local_files/#play-your-own-audio-and-video).

## <span id="known-limits-and-verified-devices"></span>Limits on phones

- A file that plays on a computer can fail on a phone that lacks its codec.
- On Android, headset buttons and lock screen controls do not reach PodNotes.
- API keys and private feed addresses stay on each device, so add them on your phone too. See [Use a private feed on another device](/private-feeds/#use-a-private-feed-on-another-device).
- A download made on another device plays only after its media file syncs to this one. See [Downloads on another device](/sync/#downloads-on-another-device).
- Before you switch to your phone, pause on your other device and let sync finish. See [Use PodNotes on two devices](/sync/#use-podnotes-on-two-devices).
