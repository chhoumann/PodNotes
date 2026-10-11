---
title: FAQ
slug: faq
description: Answers about the player, supported podcasts, private feeds, downloads, links, transcription, and devices.
---

## Where is the player?

Run **PodNotes: Show player** from Obsidian's command palette. The command opens the player or reveals its existing pane.
The podcast ribbon action, **Show PodNotes**, opens the same view.

On mobile, the player stays closed at startup until you open it. See [Use PodNotes on mobile](/mobile/).

## Why are some commands missing?

Most playback commands need a loaded episode. **PodNotes: Create episode note** also needs a non-empty note path and template.
The episode can be paused. **PodNotes: Reorder Queue** appears when the queue contains at least two episodes.

**PodNotes: Show player** is always available. **PodNotes: Capture Timestamp** is an editor command, so it needs an active note editor.
The [command reference](/commands/) lists each command's requirements.

## Which podcasts can I add?

PodNotes plays media published through podcast RSS feeds. Search uses the Apple Podcasts directory and requests up to 20 results.
You can also paste an RSS feed URL or an Apple Podcasts show link into **Search Podcasts** in PodNotes settings.
An Apple link works when the directory provides a feed for that show.

A missing search result does not mean a podcast is unsupported. Its publisher's RSS URL can work without a directory listing.
An ordinary website or episode page is not an RSS feed. See [Getting started](/getting-started/).

## Can I add Spotify exclusives or YouTube links?

PodNotes does not import Spotify or YouTube page links. A show available only inside a service, with no accessible RSS feed, cannot be added.
If the publisher also offers an RSS feed, use that feed. A Spotify subscription does not provide PodNotes with access to Spotify-only media.

## Can I use a private feed?

Yes, when your provider gives you a personal RSS URL that PodNotes can fetch. Paste the complete URL into **Search Podcasts**.
PodNotes has no provider sign-in flow for feeds that require a browser login.

When secret storage succeeds, URLs with embedded credentials or recognized secret query parameters move into Obsidian's device-local secret storage.
The saved subscription and new links then use a placeholder.
On another device, PodNotes asks you to remove the saved feed and add it again with its private URL.
Re-adding creates a new device-local secret reference. Once that reference syncs back, the first device cannot resolve it with its old secret.
Protected private-feed subscriptions do not work across devices through plugin data sync alone.

If secret storage fails, the real URL stays in `data.json` and can sync.
A failed migration shows a persistent notice asking you to restart PodNotes to retry.

Tokens embedded in a URL path are not detected. Those URLs remain in `data.json`.
OPML exports include the real subscription URLs. Treat a private feed URL and an export containing it as credentials.
See [Sync and devices](/sync/).

## Do downloads sync with my vault?

Downloads are files inside your vault. Your sync service must include the media files as well as PodNotes' plugin data.
PodNotes records file paths in `data.json`; syncing that file alone does not transfer audio or video.

File types, size limits, and exclusions depend on your sync service. See [Downloads on another device](/sync/#downloads-on-another-device).

## What happens to notes and links when I remove a download?

Removing a download leaves your notes and captured timestamps unchanged.
Podcast timestamp links address the feed and episode, so they can play online again when the feed and media remain available.
A local-file link needs the media file and its registration in PodNotes on that device.

**Remove from Local Files** keeps a manually added file in the vault.
For a downloaded episode, **Remove file** removes its registration and trashes the file.
If PodNotes cannot confirm that it downloaded the file, it asks whether to **Keep file** or **Delete file**.
The [sync page](/sync/#removal-and-existing-links) explains the limits of older links and downloads.
File deletion follows Obsidian's **Deleted files** setting under **Files and links**, including permanent deletion if selected.

## Can I annotate my own audio or video?

Yes. Open a vault media file's context menu and choose **Play with PodNotes**.
On mobile, long-press the file. You can capture timestamps, create an episode note, and resume playback.
For MP4 and WebM files, choose **Play as audio with PodNotes** or **Play as video with PodNotes**.

Playback depends on the codecs supported by Obsidian and your device. Transcription accepts audio episodes, including local audio, but not video episodes.
See [Local files](/local_files/).

## Does transcription cost money?

PodNotes has no transcription subscription. The transcription provider bills your API account.
Plain transcription uses OpenAI Whisper. Optional **Speaker diarization** uses OpenAI or Deepgram, selected through **Diarization provider**.

Configure the matching **OpenAI API key** or **Deepgram API key** in PodNotes settings under **Transcripts**.
Your provider account needs the billing or credit required for API use. PodNotes does not include API credit.
Costs depend on the provider, model, and audio length. Check your provider's current API pricing before a long transcription.

PodNotes generates transcript notes from audio. It does not import transcripts shown in Apple Podcasts or automatically read transcripts published in a feed.
See [Transcripts](/transcripts/).

## Does playback progress sync between devices?

Saved progress, subscriptions, playlists, templates, and preferences can travel with PodNotes' `data.json` when your sync service includes plugin data.
PodNotes has no separate sync account or live playback handoff. Two devices can overwrite each other's changes.
API key values and protected private-feed URLs remain local to each device.
See [Sync and devices](/sync/) before switching between devices.
