---
title: Getting started
slug: getting-started
description: Install PodNotes, add a podcast, play an episode, and save your first timestamp and episode note in about five minutes.
---

In about five minutes you will have a podcast playing in Obsidian, a timestamp in a note that jumps back to that moment, and a note for the episode.

## Install PodNotes

1. In Obsidian, open **Settings → Community plugins**.
2. If **Restricted mode** is on, turn it off.
3. Select **Browse**, search for **PodNotes**, and select **Install**.
4. Select **Enable**.

On a computer, the PodNotes view opens in the right sidebar. To open it at any time, run **PodNotes: Show player** from the command palette (`Ctrl+P`, or `Command+P` on macOS), or select **Show PodNotes** in the ribbon. On a phone, the view stays closed until you open it this way.

## Add a podcast

1. Open **Settings → PodNotes**.
2. Under **Search Podcasts**, type a show's name. You can also paste its RSS feed URL or its Apple Podcasts link.
3. Select **Add** on the show you want.

![PodNotes settings with Search Podcasts results for "planet money" and an Add button on each show](/screenshots/add-podcast.webp)

The button changes to **Remove**, and the show appears in the PodNotes view. If a show does not appear, see [Which podcasts can I add?](/faq/#which-podcasts-can-i-add)

## Play an episode

1. In the PodNotes view, select the show's artwork. If you see an episode list or the player instead, select the grid button at the top first.
2. Select an episode.

The episode starts, and the view switches to the player.

## Capture a timestamp

1. Open a note in editing view and place the cursor where you want the timestamp.
2. Run **PodNotes: Capture Timestamp** from the command palette.

PodNotes inserts the playback time as a link, such as `- [00:12:41](obsidian://podnotes?...)`. Select the link later to play the episode from that moment.

## Create an episode note

1. With the episode still loaded, run **PodNotes: Create episode note**.
2. Write in the note that opens.

PodNotes creates the note in `PodNotes/<podcast>/` with the episode's date, a link to its podcast, and a link that resumes playback.

## Next steps

- [Capture timestamps](/timestamps/) from a hotkey, a phone toolbar, or a headset.
- [Create episode notes](/notes/) with your own template, and browse them with Bases.
- [Use PodNotes on your phone](/mobile/).
