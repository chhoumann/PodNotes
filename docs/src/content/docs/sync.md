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

PodNotes saves a snapshot of its local state. It does not merge subscriptions, playlists, preferences, or progress changed on another device.
An open instance does not automatically reload a synced `data.json`.

For example, one device can add a podcast while another updates its playback progress.
The second device's next save can replace the first device's subscription change with its older library snapshot.
The outcome depends on sync timing and your sync service's conflict handling.

Using one device at a time reduces this risk. Allow sync to finish before loading PodNotes on the second device.
If sync is still running when Obsidian starts, PodNotes can load an older snapshot before the synced file arrives.
This includes sync services that run inside Obsidian. On mobile, data loads even while the player stays closed.
Keep PodNotes disabled on the second device while sync finishes, then enable it to load the transferred data.
Syncing a file into an already open session does not update that session's in-memory library.

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

If `data.json` exists but Obsidian cannot read or parse it, PodNotes leaves the file unchanged.
It starts with default settings and shows a persistent notice that nothing is saved.
The notice includes the actual file path.

Saving remains disabled until you restore or delete that file and restart Obsidian.
Restoring a readable backup preserves the previous library. Deleting the file starts a new library.
Changes made while saving is disabled do not become a replacement for the unreadable file.
