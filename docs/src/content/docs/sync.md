---
title: Sync between devices
slug: sync
description: What PodNotes saves in your vault, how to use it on two devices, and what vault sync does not carry.
---

Keep one PodNotes library on several devices by syncing your vault.
PodNotes has no sync service of its own, so your vault sync service, such as Obsidian Sync, decides which files reach each device.

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

Episode notes, feed notes, and transcripts are Markdown files in your vault.
Downloads are audio and video files in your vault.
Your sync service transfers these files separately from `data.json`.

PodNotes saves where you stopped, not a live session.
Another device resumes from the saved position, but it cannot follow or control the player on this device.
The current playback speed is not saved. Only **Default Playback Rate** syncs.

## Use PodNotes on two devices

Use one device at a time, and let PodNotes load the synced library before you use it:

1. On the device you are leaving, pause playback.
2. Wait until your sync service finishes uploading.
3. On the device you are switching to, open Obsidian and wait until sync finishes.
4. In **Settings → Community plugins**, turn off PodNotes.
5. Turn on PodNotes. It loads the synced library.

Then use PodNotes on this device until you switch back.
Steps 4 and 5 matter because PodNotes reads `data.json` only when it loads.
On a phone, it loads when Obsidian starts, even if you never open the player.

## Changes on two devices

PodNotes saves its whole library each time something changes.
It does not merge changes made on another device, and a running PodNotes does not reload a `data.json` that sync replaces.

For example, you add a podcast on your laptop, then listen on your phone before the phone has loaded that change.
When the phone saves your progress, its copy of the library replaces the laptop's copy, and the new podcast is gone.
Which copy survives depends on sync timing and on how your sync service handles conflicts.

The same loss can happen when Obsidian starts before sync finishes, including with sync services that run inside Obsidian.
To avoid it, follow [Use PodNotes on two devices](#use-podnotes-on-two-devices).

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

- If PodNotes cannot save the URL to secret storage, the URL stays in `data.json` and syncs. A notice asks you to restart PodNotes to try again.
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

Each remove action does something different:

- **Remove from Local Files** removes a media file you added yourself from the list. The file stays in your vault.
- **Remove file** on a downloaded episode removes its entry and moves the file to the trash.
- If PodNotes has no record that it downloaded the file, it asks first. **Keep file** removes the entry and keeps the file. **Delete file** moves the file to the trash.

PodNotes moves files to the trash the way your **Deleted files** setting in **Settings → Files and links** says. If that setting deletes files permanently, so does PodNotes.
Your sync service decides whether the deletion reaches other devices.

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
It saves nothing until you fix the file, and a notice that stays on screen names the file's path.

To recover:

1. Replace `data.json` with a readable backup to keep your library, or delete it to start a new library.
2. Restart Obsidian.

Changes you make while saving is off are lost.

If `data.json` comes from a newer version of PodNotes, PodNotes does not start, and its notice asks you to update.
Update PodNotes on every device that shares the vault.
