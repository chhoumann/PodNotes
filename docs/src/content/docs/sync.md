---
title: Sync between devices
slug: sync
description: What PodNotes saves in your vault, how it merges changes from your other devices, and how to switch devices.
---

Keep one PodNotes library on several devices by syncing your vault.
PodNotes has no sync service of its own, so your vault sync service, such as Obsidian Sync, decides which files reach each device.

## What syncs

| What | How it syncs |
| --- | --- |
| Your podcasts, progress, queue, playlists, templates, and settings | In `data.json`, if your sync service includes plugin data |
| Episode notes, feed notes, and transcripts | As Markdown files |
| Downloads | As media files, if your sync service includes them |
| API keys and private feed addresses | Not at all. Each device keeps its own copy, and only a reference to it syncs. |
| The current playback speed | Not at all. PodNotes does not save it. Only **Default Playback Rate** syncs. |

For your library to sync, your sync service must include PodNotes' plugin folder, `.obsidian/plugins/podnotes/`.
With Obsidian Sync, turn on **Active community plugin list** and **Installed community plugins** under **Vault configuration sync** in **Settings → Sync**. The second one syncs each plugin's files and settings, which hold your PodNotes library. Obsidian keeps these settings per device, so change them on each device. [Sync settings in Obsidian Help](https://obsidian.md/help/sync/settings) describes them.

## Use PodNotes on two devices

PodNotes merges the changes your devices make, so you can switch devices without restarting Obsidian. To continue an episode on another device:

1. On the device you are leaving, pause playback. Pausing saves your position at once.
2. Note the time where you stopped.
3. Wait until your sync service finishes uploading.
4. On the device you are switching to, wait until sync finishes.
5. If this device's player shows the episode at another time, move to the time you noted on the progress bar.
6. Play the episode.

Step 5 matters because the episode in a device's player keeps that device's position once the device has played it or you moved its position. When that device saves its position, for example when you pause or switch apps, the older position replaces the progress from your other device. Other episodes start at their synced position when you play them.

## Changes on two devices

Before each save, PodNotes reads `data.json` and merges it with the changes made on this device. When sync replaces `data.json` while PodNotes runs, PodNotes merges the new file into your library without a restart.
Changes to different things all stay. For example, you add a podcast on your laptop while your phone saves your progress, and both changes stay.

When two devices change the same setting or the same item before either sees the other's change, the device that saves later keeps its own version. PodNotes takes these items whole, without mixing their parts:

- A saved podcast.
- The progress of an episode.
- The current episode, and the current episode of each playlist.
- Each episode in the queue, **Favorites**, **Local Files**, your playlists, and your downloads.

Episodes match by podcast name and title, so episodes with the same title from different podcasts stay apart.

Sync never starts, pauses, or moves the episode in this device's player once this device has played it or you moved its position. That episode keeps this device's position, as step 5 of [Use PodNotes on two devices](#use-podnotes-on-two-devices) explains. Until then, the player shows the synced episode at its synced position.

### A device that starts before sync finishes

Each library has an ID, `libraryId`, in `data.json`. A device that starts PodNotes before sync delivers `data.json` starts a library of its own. When the two files meet, PodNotes combines the two libraries:

- Every podcast, progress record, playlist, and download from both libraries stays.
- A setting changed from its default in only one library keeps that library's value. A setting changed in both libraries keeps this device's value.
- A podcast with different names in the two libraries appears twice, once under each name.
- The combined library keeps the ID of the library that started first.

### Limits of merging

- A change that arrives between PodNotes' read and its write can still be lost.
- PodNotes writes `data.json` in place, so your sync service can pick up a partly written file. Another device then shows a notice that PodNotes could not read the file, until the complete file arrives. See [Fix save problems](/save-problems/).
- PodNotes 2.21.1 and earlier do not merge, so a device that runs one of them can overwrite the whole file. Update PodNotes on every device.

## When PodNotes saves

PodNotes saves a change as soon as you make it. During playback, it saves your position at most every 10 seconds.

PodNotes also saves your position at once when you pause, play another episode, or turn off PodNotes, when an episode ends, and when the Obsidian window is hidden, such as when you switch apps on a phone.
To make sure PodNotes saves your latest position, pause before you quit Obsidian.

After each save, PodNotes reads `data.json` back to check it.

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
- References to your API keys and private feed addresses, but not the keys or addresses themselves.
- Your library's ID.

Episode notes, feed notes, transcripts, and downloads are separate files in your vault. Your sync service transfers them separately from `data.json`.

PodNotes saves where you stopped, not a live session.
Another device resumes from the saved position, but it cannot follow or control the player on this device.

## <span id="secrets-on-each-device"></span>API keys and private feeds on each device

PodNotes stores your OpenAI and Deepgram API keys in Obsidian's secret storage on each device.
Only a reference to the key syncs in `data.json`.
Add the key on every device where you transcribe audio. See [Transcribe episodes](/transcripts/).

PodNotes also keeps the address of each private feed in secret storage on each device.
The podcast and a reference to its address sync, but the address does not. On each other device, enter the address once. See [Use a private feed on another device](/private-feeds/#use-a-private-feed-on-another-device).

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
Timestamp links point at the feed and the episode, not at the file, so they play the episode online again while the feed still lists it.
A link to a local file needs the file in your vault on the current device. [Limits of capture and links](/timestamps/#limits-of-capture-and-links) lists the other cases.

## <span id="unreadable-plugin-data"></span>When PodNotes cannot save

When PodNotes cannot save your library, it shows a notice, and in most cases it keeps your changes and tries again. [Fix save problems](/save-problems/) explains each notice and what to do.
