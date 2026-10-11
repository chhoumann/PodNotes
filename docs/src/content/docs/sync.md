---
title: Sync and devices
slug: sync
description: What PodNotes saves, what vault sync can transfer, and the limits of downloads and changes on several devices.
---

PodNotes saves its state in your vault. It does not run a sync service.
Using the same library on several devices depends on the files your vault sync service transfers.

## Plugin data and notes

PodNotes stores preferences and library state in `.obsidian/plugins/podnotes/data.json`.
If you use a different Obsidian configuration folder, the path starts with that folder instead of `.obsidian`.
A `libraryId` in `data.json` records which library the file belongs to.

The file contains the following data:

- Saved podcast subscriptions.
- Played status and saved playback positions.
- The current episode, queue, favorites, and custom playlists.
- Registrations and vault paths for downloaded episodes and local files.
- Note, timestamp, transcript, and download templates.
- Playback preferences, skip lengths, and feed cache preferences.
- References to API keys and protected private-feed URLs, without their secret values.

Episode notes, feed notes, and transcript notes are separate Markdown files.
Audio and video downloads are separate media files. A sync service can transfer these files independently of `data.json`.

The current episode's temporary playback speed and paused state are not saved as a live session.
The **Default Playback Rate** preference is saved. Saved progress provides a resume position, not control of another device's player.

## Changes on two devices

Before each save, PodNotes reads `data.json`.
For files from the same library, it compares the file with the last loaded or saved copy and this device's changes.
It merges changes to different entries, including subscriptions, progress, playlists, and preferences.

For example, one device can add a podcast while another updates its playback progress.
Once the subscription reaches the second device's `data.json`, its next save keeps both changes.

When `data.json` files identify different libraries, PodNotes combines their podcasts, progress records, and playlists.
This includes a new device that starts PodNotes before its synced data arrives.
A setting changed from its default in only one library keeps that library's value.
The combined file keeps the identity of the library that started first.
If a podcast has different names in the two libraries, both names appear.

When Obsidian reports a synced file change, PodNotes updates its library without a restart.
Sync does not switch an episode already loaded in the player or seek to another device's position.
The loaded episode stays current on this device.
The player saves its own position for that episode, even after progress from another device arrives.

For other changes, conflicts favor the device saving when both devices edit the same setting or entry before seeing each other's changes.
PodNotes takes these entries whole, rather than combining their fields:

- A saved feed, including its URL and private-feed secret reference.
- An episode's progress record or note mapping.
- The current episode, including a playlist's current episode.
- Each episode in the queue, favorites, Local Files, custom playlists, or downloads.

Episodes match by podcast name and title, so equal titles from different podcasts stay separate.
A download's stream URL, file path, and ownership record stay together.

A change that arrives between the read and write can still be overwritten.
Sync can also see a partly written file because PodNotes writes `data.json` in place.
An older PodNotes version on another device can overwrite the whole file.
Keep PodNotes updated on every device and let sync finish before switching devices.

## When PodNotes saves

User changes request a save at once. Changes made during a save share the next save.
During playback, periodic position checkpoints write at most once every 10 seconds.
Pausing, hiding the player's window, or closing the player requests a position save at once, including in a popout.
Once the Obsidian window starts closing, PodNotes starts no new writes.
When Obsidian quits, it lets an in-flight write finish.

PodNotes reads the file back after each write to check that the saved data matches.
A mismatch counts as a failed save.

## Secrets on each device

OpenAI and Deepgram API keys live in Obsidian's device-local secret storage.
The selected secret reference can sync in `data.json`, but the key value does not.
Each device needs its own available key for the chosen transcription provider.

Private feed URLs with embedded credentials or recognized secret query parameters also use device-local secret storage when storage succeeds.
The synced subscription then contains a placeholder and a secret reference.
Without the corresponding secret, the device cannot fetch that feed or resolve its private-feed timestamp links.
PodNotes' notice asks you to remove the feed and add it again with its private URL on that device.
Re-adding creates a new secret reference. When that reference reaches another device, the other device cannot resolve the feed with its old secret.
Protected private-feed subscriptions therefore do not work across devices through plugin data sync alone.

If secret storage fails, the real private URL stays in `data.json` and can sync.
A failed migration shows a persistent notice asking you to restart PodNotes to retry.

Private tokens embedded in a URL path are not detected and remain in `data.json`.
OPML exports contain real feed URLs, including private URLs.

## Downloads on another device

**Episode download path** determines where PodNotes writes media inside the vault.
The default is `PodNotes/{{podcast}}/{{title}}`, with the media extension added automatically.

Offline playback needs both the media file at its registered vault path and the episode's registration in `data.json`.
A synced registration can appear before the file arrives. PodNotes does not transfer the file itself.
A matching download registration takes priority over streaming.
If its file has not arrived, the episode does not play on that device. PodNotes does not stream it instead.

The **Local Files** playlist includes manually added media and downloaded episodes.
Copying a local file to another device does not register it there unless its PodNotes data also arrives.
**Play with PodNotes** can register a local file on that device.

Sync exclusions, attachment size limits, available storage, and file type support still apply.

## Removal and existing links

**Remove from Local Files** removes a manually added file's registration and keeps the file.
**Remove file** on a downloaded episode removes the registration and trashes a file that PodNotes knows it downloaded.

For an older download or another file without that ownership record, PodNotes asks for confirmation.
**Keep file** leaves the file in place but removes the registration. **Delete file** trashes the file.
The trash action follows Obsidian's **Files and links** setting for **Deleted files**, including permanent deletion if you selected it.
Your sync service determines whether that deletion reaches other devices.

Removal does not delete episode notes or timestamp text.
Podcast links use the feed URL and episode title rather than the downloaded file path, so they can still resolve to online media.
They need an available feed and a matching episode title. Word reordering can still match when the normalized word set is identical and unique.
An episode removed from its feed or retitled with different words may no longer resolve.

Local-file links need a usable local registration and an existing media file.
Protected private-feed links also need the saved feed's secret on the current device.
Older links can contain the original private URL and are not rewritten by the settings migration.

## Unreadable plugin data

If a non-empty `data.json` cannot be read or parsed, PodNotes leaves it unchanged and shows a persistent notice that saving has stopped.
The notice includes the file path. If the file is unreadable at startup, PodNotes starts with default settings.
After an unreadable startup, a replacement must load without repairs before saving resumes.
When PodNotes already has a loaded library, entries dropped while reading a synced file do not count as deletions.
PodNotes keeps their last known values while merging other changes.

If a copy from an older data format arrives during a session, PodNotes stops saving and shows a notice asking you to restart Obsidian.
Restarting runs the migration, including moving old API keys into secret storage.

An empty file counts as missing. At startup, PodNotes starts a new library.
After a failed write leaves the file empty, the next save can write the data again, including changes merged from another device.
PodNotes does not repair a non-empty, partly written file.

### Restore saving after a notice

1. For an unreadable file, let sync finish. Check available disk space and file permissions if the notice remains.
2. Restore a readable backup of the file named in the notice if needed. PodNotes resumes saving when it reads a usable copy.
   If the notice remains, restart Obsidian.
3. For an older-format notice, update PodNotes on every device, let sync finish, and restart Obsidian to migrate the file.

If you want to discard the old library, back up the file, delete it, and restart Obsidian.
Deletion starts a new library.
After an unreadable startup, PodNotes adopts the recovered library instead of merging changes made while saving was disabled.
If PodNotes had already loaded a library, it merges those changes with the recovered file.
