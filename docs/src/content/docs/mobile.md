---
title: Use PodNotes on your phone
slug: mobile
description: Open the player, capture timestamps from the editor toolbar or a headset, and listen offline on iOS and Android.
---

Listen and capture timestamps on your phone. You open the player yourself, and besides the command palette, you can capture from the editor toolbar or a headset.
To install PodNotes, follow [Install PodNotes](/getting-started/#install-podnotes). The steps are the same on a phone.

## <span id="enable-podnotes-and-open-the-player"></span>Open the player

On a phone, the player stays closed when Obsidian starts.

1. Pull down on a note to open the command palette.
2. Run **PodNotes: Show player**.

You can also select **Show PodNotes** in the menu of the navigation bar at the bottom of the screen. The player opens in the right sidebar. To return to your note, tap outside the sidebar.

![The PodNotes player in Obsidian's right sidebar on a phone, with episode artwork, title, progress, and skip buttons](/screenshots/mobile-player.webp)

To add your first podcast, see [Add and play podcasts](/podcasts/). Most commands appear only after you load an episode. See [Commands](/commands/).

## Add a capture button to the editor toolbar

### Set up the button once

1. Open a note in editing view. Obsidian lists the capture command only while a note is open in an editor.
2. In **Settings → Interface**, select **Configure mobile toolbar**.
3. Under **Manage toolbar options**, select **Add a command...**.
4. Find and select **PodNotes: Capture Timestamp**.

To add a range button, play an episode in PodNotes first. You can pause it. Then repeat steps 3 and 4 with **PodNotes: Capture Last 10 Seconds** or **PodNotes: Capture Last 20 Seconds**. Obsidian lists them only while [the range commands are available](/commands/#capture-last-10-seconds--capture-last-20-seconds).

### Capture from the toolbar

1. In PodNotes, play an episode.
2. Tap outside the sidebar to return to your note.
3. In editing view, place the cursor where the timestamp goes.
4. In the editor toolbar, select the clock button.

![A note on a phone with three captured timestamp links and the editor toolbar, whose first button is the clock that captures a timestamp](/screenshots/mobile-toolbar.webp)

PodNotes inserts a timestamp link at the cursor, or shows a notice when no episode is loaded. If your timestamps come out as plain text, see [Make timestamps clickable](/timestamps/#make-timestamps-clickable).

## Capture with a headset

While an episode plays, press the headset button that sends the previous-track action, often a triple press. This works on a computer too.

- If a note is open in an editor, the timestamp goes in at the cursor.
- If no note is open in an editor, the timestamp goes at the end of the episode's note. PodNotes creates that note if needed, as long as **Note creation file path** and **Note creation template** are set.

## Download an episode

Download episodes while you are online, and wait for the notice that says each download succeeded. On a phone, the episode menu opens from the three-dot **More options** button. See [Download an episode](/local_files/#download-an-episode).

## Play your own audio and video

Long-press a media file in the file explorer, where a computer uses a right-click. See [Play your own audio and video](/local_files/#play-your-own-audio-and-video).

## <span id="known-limits-and-verified-devices"></span>Limits on phones

- PodNotes does not merge changes from two devices. Use one device at a time. When you switch, let sync finish, then restart Obsidian or turn PodNotes off and on before you use it. See [Use PodNotes on two devices](/sync/#use-podnotes-on-two-devices).
- A file that plays on a computer can fail on a phone that lacks its codec.
- Which headset press sends previous track depends on the headset and the phone, and some headsets send none.
- API keys stay on each device, so add them on your phone too. A protected private feed works on one device at a time. See [API keys and private feeds on each device](/sync/#api-keys-and-private-feeds-on-each-device).
- A download made on another device plays only after its media file syncs to this one. See [Downloads on another device](/sync/#downloads-on-another-device).
