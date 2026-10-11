---
title: Getting started
slug: getting-started
description: Install PodNotes, add a podcast, play an episode, and save your first timestamp and episode note in about five minutes.
---

In about five minutes you will have a podcast playing in Obsidian, a timestamp in a note that jumps back to that moment, and a note for the episode.

## Install PodNotes

1. In Obsidian, open **Settings → Community plugins**.
2. If **Restricted mode** is on, turn it off.
3. Select **Browse**, search for PodNotes, and select **Install**.
4. Select **Enable**.

On a computer, the PodNotes view opens in the right sidebar. To open it again later, run **PodNotes: Show player** from the command palette (`Ctrl+P`, or `Command+P` on macOS), or select **Show PodNotes** in the ribbon. On a phone, see [Open the player](/mobile/#enable-podnotes-and-open-the-player).

## Add a podcast

1. Open **Settings → PodNotes**.
2. Under **Search Podcasts**, type a show's name. Results appear as you type. You can also paste the show's RSS feed URL or its Apple Podcasts link.
3. Select **Add** on the show you want.

![PodNotes settings with Search Podcasts results for "the daily", each with an Add button](/screenshots/add-podcast.webp)

The button changes to **Remove**, and the show appears in the PodNotes view. If a show does not appear, see [Which podcasts can I add?](/faq/#which-podcasts-can-i-add)

## Play an episode

1. If the PodNotes view shows an episode list or the player, select the grid button, the first of the three buttons at the top of the view.
2. Select the show's artwork.
3. Select an episode.

The episode starts, and the view switches to the player.

## Capture a timestamp

1. Open a note in editing view and place the cursor where you want the timestamp.
2. Run **PodNotes: Capture Timestamp** from the command palette.

PodNotes inserts the playback time as a link, such as `- [00:12:41](obsidian://podnotes?...)`. Select the link later to play the episode from that moment.

## Create an episode note

1. With the episode still loaded, run **PodNotes: Create episode note**.
2. Write in the note that opens.

PodNotes creates the note in `PodNotes/<podcast>/` with the episode's date, a link to its podcast, and a link that resumes playback.

## Other ways to install

To try a beta version before it reaches **Community plugins**, install PodNotes with BRAT:

1. Install and turn on the [BRAT](obsidian://show-plugin?id=obsidian42-brat) plugin.
2. Run **BRAT: Plugins: Add a beta plugin for testing (with or without version)**.
3. Enter `chhoumann/PodNotes`.
4. Select **Add plugin**.
5. If PodNotes is not turned on afterwards, turn it on in **Settings → Community plugins**.

To install a release by hand:

1. From the [latest release](https://github.com/chhoumann/PodNotes/releases/latest), download `main.js` and `manifest.json`.
2. In your vault, put both files in `.obsidian/plugins/podnotes/`. Create the folder if it does not exist.
3. In **Settings → Community plugins**, reload the list of installed plugins.
4. Turn on PodNotes.

## Next steps

- [Capture timestamps](/timestamps/) from a hotkey, a phone toolbar, or a headset.
- [Create episode notes](/notes/) with your own template, and browse them with Bases.
- [Use PodNotes on your phone](/mobile/).
