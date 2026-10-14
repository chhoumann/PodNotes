---
title: Update to 2.22.0
slug: upgrade
description: What changes when you update from PodNotes 2.21.1 to 2.22.0, and what to do on each device.
---

Update from PodNotes 2.21.1 or earlier to 2.22.0 without losing your library. PodNotes 2.22.0 redesigns the PodNotes view, the player, and the settings, and changes how your devices share one library. Go through the sections below in order.

## Update every device first

PodNotes 2.22.0 merges the changes your devices make, but 2.21.1 and earlier overwrite `data.json`. A device that still runs an older version can wipe the changes from your other devices.

1. On each device that shares your vault, open **Settings → Community plugins**.
2. Select **Check for updates**.
3. Next to PodNotes, select **Update**.

Do this on a device before you play anything there. With Obsidian Sync's **Installed community plugins** on, sync can also bring the update, so check the version under PodNotes in **Settings → Community plugins** before you play. Then let your sync service finish on every device. See [Sync between devices](/sync/).

## Set private feed addresses on your other devices

On its first start, PodNotes 2.22.0 moves the address of each private feed from a host it now recognizes, such as Supercast or Substack, out of `data.json`, and shows "Moved private feed URLs out of data.json." The podcast keeps working on that device. On each other device, the podcast says **Address not on this device**.

Each other device needs each such address once, copied again from your podcast provider, because PodNotes does not show it. [Use a private feed on another device](/private-feeds/#use-a-private-feed-on-another-device) has the steps.

## Find your way around the new view

- To add a podcast, select **Add podcast** in the PodNotes view. Search is no longer in the settings. See [Add and play podcasts](/podcasts/).
- To remove a podcast or create its note, use **Podcast options** on the podcast's page.
- The queue and your playlists have their own pages, and you make and delete playlists there. See [Use the queue and playlists](/playlists/).
- The mini player sits at the bottom of the view, and the full player opens over it, with the **Chapters**, **Transcript**, and **Up next** panels. See [Use the player](/player/).
- PodNotes opens its view by itself only once, on a new install. To open it, run **PodNotes: Show player**.

## Check your settings

The settings tab has seven new sections, and many settings have new names. [Settings that moved or were removed](/settings/#settings-that-moved-or-were-removed) lists each change. In short:

- **Default Volume** is gone. The full player's volume button sets one volume for every episode. PodNotes starts with the **Default Volume** you set in 2.21.1.
- The feed cache settings are gone. PodNotes always keeps a copy of each feed on the device, and fetches the feed again when the copy is more than six hours old, even if you turned caching off before.
- The headset's next-track button moves forward by **Skip forward (s)**. Under **Headset and lock screen**, you choose what the previous-track and next-track buttons do.
- A text or number setting saves half a second after you stop typing.

## Check your notes and templates

- Notes you created before 2.22.0 lack the `guid` and `feedUrl` properties, so PodNotes finds them only at their path, or by their title in that path's folder. Before you rename or move such a note, see [How PodNotes finds a note](/notes/#how-podnotes-finds-a-note).
- Your saved episode note template keeps its old resume line. To leave out empty resume links, see [Update the resume link in an existing template](/notes/#update-the-resume-link-in-an-existing-template).
- A capture no longer needs a note open, and it shows a notice with **Undo**. See [Capture timestamps](/timestamps/).
- **PodNotes: Transcribe current episode** saves the transcript that the feed publishes, for free, when there is one. Only otherwise does it transcribe the audio with your provider. See [Transcribe episodes](/transcripts/).

## Check your backups

After you import a settings file from PodNotes 2.21.1 or earlier, some private podcasts can need **Set feed address** again. Settings files and copies of `data.json` from before the update keep any private addresses they held, so keep them private. See [Limits of private feeds](/private-feeds/#limits-of-private-feeds).
