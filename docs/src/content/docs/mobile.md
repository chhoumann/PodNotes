---
title: Use PodNotes on mobile
slug: mobile
description: Open the player, capture timestamps from the mobile toolbar or headset, and download episodes on a phone.
---

## Enable PodNotes and open the player

1. Open Obsidian settings and go to **Community plugins**.
2. If restricted mode is enabled, turn it off.
3. Browse for **PodNotes**, install it, and enable it.
4. Open the command palette and run **PodNotes: Show player**.

The player appears. The **Show PodNotes** podcast action in the mobile ribbon opens the same view.
On mobile, the player does not open at startup. PodNotes still loads its saved data when Obsidian starts.

To add and play your first podcast, follow [Getting started](/getting-started/#add-a-podcast).
If **Create episode note** is missing, load an episode first. A paused episode is sufficient.

## Add a capture button to the editor toolbar

1. In Obsidian settings, open **Interface** and choose **Configure mobile toolbar**.
2. Add **PodNotes: Capture Timestamp** to the toolbar.
3. Load an episode in PodNotes.
4. Open a Markdown note in edit mode and place the cursor where you want the timestamp.
5. Tap the capture button in the editor toolbar.

The timestamp appears at the cursor. New installs use a clickable episode link.
If your existing format produces plain text, set **Capture timestamp format** to `- {{linktime}} ` in PodNotes settings.
The final space separates the link from the text you type next.

For recent playback ranges, use **PodNotes: Capture Last 10 Seconds** or **PodNotes: Capture Last 20 Seconds**.
These commands need a loaded episode and a non-empty timestamp format.
See [Timestamps](/timestamps/) for formats and the **Timestamp offset (s)** setting.

## Capture with a headset

1. Load an episode in PodNotes.
2. Send your headset's previous-track action.

When the device delivers the Media Session `previoustrack` action, PodNotes captures a timestamp.
It inserts the timestamp into the active editor. Without an active editor, it appends to the current episode note and creates that note if needed.
The fallback requires non-empty **Note creation file path** and **Note creation template** settings.

Headset gestures vary by device. Ordinary play and pause events do not capture timestamps.
PodNotes registers no dedicated Media Session seek-forward or seek-backward handlers.

## Download an episode

1. Load the episode in PodNotes.
2. Run **PodNotes: Download Playing Episode**.
3. Wait for the download to finish before going offline.

The file is saved inside your vault at **Episode download path** and appears in **Local Files**.
You can also tap an episode's **More options** button and choose **Download**.
Offline playback needs the saved file on this device. See [Downloads on another device](/sync/#downloads-on-another-device).

To play your own audio or video, long-press a vault media file and choose **Play with PodNotes**.
For MP4 and WebM files, choose **Play as audio with PodNotes** or **Play as video with PodNotes**.

## Known limits and verified devices

Toolbar capture, local MP3 playback, adding a feed, dormant startup, and a completed download were verified on an Android 14 Pixel 6 emulator.
That check used Obsidian 1.14.4 and PodNotes 2.21.1.
The evidence is recorded on issues [#89](https://github.com/chhoumann/PodNotes/issues/89#issuecomment-6105824251), [#100](https://github.com/chhoumann/PodNotes/issues/100#issuecomment-6105823837), [#109](https://github.com/chhoumann/PodNotes/issues/109#issuecomment-6105824406), [#110](https://github.com/chhoumann/PodNotes/issues/110#issuecomment-6105823950), and [#113](https://github.com/chhoumann/PodNotes/issues/113#issuecomment-6105824122).

These checks do not verify iOS, iPadOS, every physical Android phone, or headset delivery.
Media playback also depends on the device's supported codecs.
Values stored in Obsidian's secret storage do not sync through plugin data. Unprotected private-feed URLs can sync.
Plugin data sync does not guarantee that a media file has arrived.
See [Sync and devices](/sync/) for those limits.
