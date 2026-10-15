---
title: Getting started
slug: getting-started
description: Install PodNotes, add a podcast, play an episode, and save your first timestamp and episode note in about five minutes.
---

In about five minutes, you get a podcast playing in Obsidian, a timestamp in a note that jumps back to that moment, and a note for the episode. PodNotes needs Obsidian 1.13 or later.

## Install PodNotes

1. In Obsidian, open **Settings → Community plugins**.
2. If you see **Exit Restricted mode**, select it.
3. Select **Browse**.
4. Search for PodNotes.
5. Select **Install**.
6. Select **Enable**.

On a new install, the PodNotes view opens once, in the right sidebar. To open it again later, run **PodNotes: Show player** from the command palette (`Ctrl+P`, or `Command+P` on macOS), or select **Show PodNotes**, the podcast icon in the ribbon. On a phone, see [Open the player](/mobile/#open-the-player).

## Add a podcast

The empty PodNotes view shows **Add your first podcast**.

![The empty PodNotes view in the sidebar, with Add your first podcast above a search field and the Play a vault file and Import OPML buttons](/screenshots/add-podcast.webp)

1. In the search field, type a show's name. Results appear as you type.
2. Select the show you want.

PodNotes adds the show and opens its page, which lists its episodes.

You can also paste the show's RSS feed URL or its Apple Podcasts link into the search field. One result then appears. If a show does not appear, see [Which podcasts can I add?](/faq/#which-podcasts-can-i-add)

## Play an episode

1. On the show's page, select an episode.

The episode starts, and the full player opens over the view. Select **Play** or **Pause** to pause and play again. To see your lists again, select **Collapse player**, the down arrow at the top left. The episode keeps playing in the mini player at the bottom of the view. [Use the player](/player/) covers every control.

This clip searches for "archive", adds Notes from the Archive, and plays its first episode:

![A search for archive in the empty PodNotes view adds Notes from the Archive, and its first episode plays in the full player](/videos/add-and-play.mp4)

## Create an episode note

1. In the full player, select **Create note**, beside **Timestamp**.

PodNotes creates the note, opens it, and puts it in `PodNotes/<podcast>/` with the episode's date, a link to its podcast, and a link that resumes playback. The button then reads **Open note**. To change what a new note holds, see [Change what notes contain](/notes/#change-what-notes-contain).

## Capture a timestamp

1. In the episode note, in editing view, place the cursor where you want the timestamp.
2. Run **PodNotes: Capture Timestamp** from the command palette. **Timestamp** in the full player does the same.

PodNotes inserts the playback time as a link, and a notice says "Timestamp added to" and the note's name:

```md wrap
- [00:12:41](obsidian://podnotes?...)
```

Select the link, in Live Preview or reading view, to play the episode from that moment. Capture works the same in any note. To take the timestamp back before you type more, select **Undo** in the notice. See [Undo a capture](/timestamps/#undo-a-capture).

## Other ways to install

To try a beta version before it reaches **Community plugins**, install PodNotes with BRAT:

1. Install the [BRAT](obsidian://show-plugin?id=obsidian42-brat) plugin.
2. In **Settings → Community plugins**, turn on BRAT.
3. Run **BRAT: Plugins: Add a beta plugin for testing (with or without version)**.
4. Enter `chhoumann/PodNotes`.
5. Select **Add plugin**.
6. If PodNotes is not turned on afterwards, turn it on in **Settings → Community plugins**.

To install a release by hand:

1. From the [latest release](https://github.com/chhoumann/PodNotes/releases/latest), download `main.js` and `manifest.json`.
2. In your vault, put both files in `.obsidian/plugins/podnotes/`. Create the folder if it does not exist.
3. In **Settings → Community plugins**, select **Reload plugins**.
4. Turn on PodNotes.

## Next steps

- [Use the player](/player/) with chapters, the transcript, and the queue.
- [Capture timestamps](/timestamps/) from a hotkey, a phone toolbar, or a headset.
- [Create episode notes](/notes/) with your own template, and browse them with Bases.
- [Use PodNotes on your phone](/mobile/).
