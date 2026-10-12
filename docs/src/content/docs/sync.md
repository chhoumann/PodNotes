---
title: Sync between devices
slug: sync
description: What PodNotes saves in your vault, how to use it on two devices, and what vault sync does not carry.
---

Keep one PodNotes library on several devices by syncing your vault.
PodNotes has no sync service of its own, so your vault sync service, such as Obsidian Sync, decides which files reach each device.

## What syncs

| What | How it syncs |
| --- | --- |
| Your podcasts, progress, queue, playlists, templates, and settings | In `data.json`, if your sync service includes plugin data |
| Episode notes, feed notes, and transcripts | As Markdown files |
| Downloads | As media files, if your sync service includes them |
| API keys and protected private-feed URLs | Not at all. They stay on each device. |
| The current playback speed | Not at all. PodNotes does not save it. Only **Default Playback Rate** syncs. |

For your library to sync, your sync service must include PodNotes' plugin folder, `.obsidian/plugins/podnotes/`.
With Obsidian Sync, turn on **Active community plugin list** and **Installed community plugins** under **Vault configuration sync** in **Settings → Sync**. The second one syncs each plugin's files and settings, which hold your PodNotes library. Obsidian keeps these settings per device, so change them on each device. [Sync settings in Obsidian Help](https://obsidian.md/help/sync/settings) describes them.

## Use PodNotes on two devices

Use one device at a time, and let PodNotes load the synced library before you use it:

1. On the device you are leaving, pause playback.
2. Wait until your sync service finishes uploading.
3. On the device you are switching to, open Obsidian and wait until sync finishes.
4. Restart Obsidian, or turn PodNotes off and on again in **Settings → Community plugins**.

Step 4 matters because PodNotes reads `data.json` only when it loads, which is usually as Obsidian starts and before sync finishes.
Then use PodNotes on this device until you switch back.

## Changes on two devices

PodNotes saves its whole library each time something changes.
It does not merge changes made on another device, and a running PodNotes does not reload a `data.json` that sync replaces.

For example, you add a podcast on your laptop, then listen on your phone before the phone has loaded that change.
When the phone saves your progress, its copy of the library replaces the laptop's copy, and the new podcast is gone.
Which copy survives depends on sync timing and on how your sync service handles conflicts.

The same loss can happen when Obsidian starts before sync finishes, including with sync services that run inside Obsidian.
To avoid it, follow [Use PodNotes on two devices](#use-podnotes-on-two-devices).

## <span id="plugin-data-and-notes"></span>What PodNotes saves

PodNotes keeps your library in `.obsidian/plugins/podnotes/data.json`.
If your vault uses a different configuration folder, the path starts with that folder instead of `.obsidian`.

`data.json` holds:

- Your saved podcasts.
- Played status and the saved position in each episode.
- The current episode, the queue, favorites, and your playlists.
- The list of downloaded episodes and local files, with their paths in the vault.
- Your note, timestamp, transcript, and download templates.
- Your playback, skip, and feed cache preferences.
- References to your API keys and protected private-feed URLs, but not the keys or URLs themselves.

Episode notes, feed notes, transcripts, and downloads are separate files in your vault. Your sync service transfers them separately from `data.json`.

PodNotes saves where you stopped, not a live session.
Another device resumes from the saved position, but it cannot follow or control the player on this device.

## <span id="secrets-on-each-device"></span>API keys and private feeds on each device

PodNotes stores your OpenAI and Deepgram API keys in Obsidian's secret storage on each device.
Only a reference to the key syncs in `data.json`.
Add the key on every device where you transcribe. See [Transcribe episodes](/transcripts/).

PodNotes also moves a private feed URL into secret storage when the URL contains a user name, a password, or a query parameter such as `auth`, `token`, or `key`.
The synced subscription then holds a placeholder.
On another device, PodNotes cannot fetch that feed or open its timestamp links, and it asks you to remove the feed and add it again with its private URL.
Adding it again stores a new reference. When that reference syncs back, the first device loses access instead.
A protected private feed works on one device at a time.

Limits:

- If PodNotes cannot save the URL to secret storage, the URL stays in `data.json` and syncs. When this happens as PodNotes moves an existing URL at startup, a notice asks you to restart PodNotes to try again. When it happens as you add a feed, no notice appears.
- PodNotes does not detect a token in the URL path, such as `https://example.com/feeds/a1b2c3/rss`. That URL stays in `data.json`, syncs, and works on every device.
- OPML exports contain the real feed URLs, private ones included.

## Downloads on another device

PodNotes saves downloads at **Episode download path** in your vault.
The default is `PodNotes/{{podcast}}/{{title}}`, and PodNotes adds the file extension.

To play a download offline on another device, that device needs both the file and the download's entry in `data.json`.
PodNotes does not transfer the file. Your sync service does.

The entry can arrive before the file.
While the entry exists, PodNotes plays the downloaded file instead of streaming.
If the file has not arrived, the episode does not play on that device, and PodNotes does not stream it instead. Wait until the file arrives.

**Local Files** lists your downloads and the media files you added yourself.
A media file copied to another device does not appear there until its PodNotes entry also arrives.
To add it on that device, select **Play with PodNotes** in the file's menu. See [Downloads and local files](/local_files/).

Your sync service's file type support, size limits, and exclusions still apply, and so does the free storage on each device.

## <span id="removal-and-existing-links"></span>Removed downloads and existing links

To remove a download or a media file you added yourself, see [Remove a download or a local file](/local_files/#remove-a-download-or-a-local-file).
Your sync service decides whether the removal reaches other devices.

Removing a download never deletes episode notes or timestamps.
Timestamp links point at the feed URL and the episode title, not at the file.
They play the episode online again as long as the feed still lists an episode with that title.
A title with the same words in a different order still matches, if no other episode has those words.
A link stops working when the episode leaves the feed or its title changes words.

A link to a local file needs the file and its PodNotes entry on the current device.
A link to a protected private feed needs that feed's URL in secret storage on the current device.
Links captured before PodNotes protected a private feed contain the original private URL, and PodNotes does not rewrite them.

## Unreadable plugin data

If `data.json` exists but PodNotes cannot read it, PodNotes leaves the file unchanged and starts with default settings.
PodNotes saves nothing until you fix the file, and a notice that stays on screen names the file's path. Changes you make in the meantime are lost.

To recover:

1. Replace `data.json` with a readable backup to keep your library, or delete it to start a new library.
2. Restart Obsidian.

If `data.json` comes from a newer version of PodNotes, PodNotes does not start, and its notice asks you to update.
Update PodNotes on every device that shares the vault.
