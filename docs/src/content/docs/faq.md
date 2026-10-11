---
title: FAQ
slug: faq
description: Short answers about finding the player, adding podcasts, timestamps, sync, and transcription, with links to the full guides.
---

Find short answers to the questions PodNotes users ask most. Each answer links to the page that covers the topic in full.

## Setup and installation

### Where is the player?

Run **PodNotes: Show player** from the command palette, or select the **Show PodNotes** podcast icon in the ribbon.
Both open the player or reveal it if it is already open.
On a phone, the player stays closed until you open it. See [Use PodNotes on your phone](/mobile/).

### Why are some commands missing?

Most commands appear only while an episode is loaded. A paused episode counts.
**PodNotes: Capture Timestamp** needs an open note, and **PodNotes: Reorder Queue** needs at least two episodes in the queue.
**PodNotes: Show player** is always available. [Commands](/commands/) lists what each command needs.

### How do I install a beta version or install manually?

To install with BRAT:

1. Install and turn on the [BRAT](obsidian://show-plugin?id=obsidian42-brat) plugin.
2. Run **BRAT: Plugins: Add a beta plugin for testing (with or without version)**.
3. Enter `chhoumann/PodNotes` and select **Add plugin**.
4. If PodNotes is not turned on afterwards, turn it on in **Settings → Community plugins**.

To install manually:

1. From the [latest release](https://github.com/chhoumann/PodNotes/releases/latest), download `main.js` and `manifest.json`.
2. In your vault, put both files in `.obsidian/plugins/podnotes/`. Create the folder if it does not exist.
3. In **Settings → Community plugins**, reload the list of installed plugins.
4. Turn on PodNotes.

## Podcasts and feeds

### Which podcasts can I add?

Any podcast with an RSS feed.
In **Settings → PodNotes**, under **Search Podcasts**, search the Apple Podcasts directory by name, or paste an RSS feed URL or an Apple Podcasts show link.
A show missing from search can still work if you paste its RSS feed URL. See [Add and play podcasts](/podcasts/).

### Can I add Spotify exclusives or YouTube links?

No. PodNotes plays RSS feeds and cannot open Spotify or YouTube pages.
A show that exists only inside Spotify or another app has no feed to add. If the publisher also offers an RSS feed, add that feed.

### Can I use a private feed?

Yes, if your provider gives you a personal RSS URL. Paste the whole URL into **Search Podcasts**.
PodNotes cannot sign in to providers that require a browser login.
When the URL contains a password or a token parameter, PodNotes keeps it on the current device only, so the feed works on one device at a time. See [API keys and private feeds on each device](/sync/#secrets-on-each-device).

### Can I annotate my own audio or video?

Yes. In the file explorer, right-click a media file and select **Play with PodNotes**. On a phone, long-press the file.
You can then capture timestamps and create an episode note as with any episode.
For MP4 and WebM files, select **Play as audio with PodNotes** or **Play as video with PodNotes**. See [Downloads and local files](/local_files/).

## Notes and timestamps

### Why are my timestamps plain text?

Your **Capture timestamp format** uses `{{time}}`, which inserts plain text.
Installs set up before PodNotes 2.21.0 keep the old default, `- {{time}} `. New installs use `- {{linktime}} `, which inserts a link that plays the episode from that moment.
In **Settings → PodNotes**, change `{{time}}` to `{{linktime}}` in **Capture timestamp format**. See [Capture timestamps](/timestamps/).

### Can I take notes on an episode I listen to in another app?

Yes. Add the podcast to PodNotes, find the episode in the podcast's episode list, and select **Create Note** from the episode's menu. The episode does not have to play.
Timestamps come from the PodNotes player, so to capture them, play the episode in PodNotes.
For notes about a whole show, use a feed note. See [Create episode notes](/notes/).

### Do headset buttons control PodNotes?

One button does. The previous-track action captures a timestamp into the open note, or into the episode note if no note is open.
PodNotes adds no other headset actions, so play, pause, and skip depend on your device. See [Capture with a headset](/mobile/#capture-with-a-headset).

## Devices and sync

### Do downloads sync with my vault?

Downloads are files in your vault, so they sync only if your sync service includes them.
Syncing PodNotes' `data.json` alone does not move the audio or video. File types and size limits depend on your sync service.
See [Downloads on another device](/sync/#downloads-on-another-device).

### What happens to notes and links when I remove a download?

Your notes and timestamps stay.
Timestamp links point at the feed and the episode, so they stream the episode again while the feed still lists it.
Links to your own media files need the file. See [Removed downloads and existing links](/sync/#removal-and-existing-links).

### Does playback progress sync between devices?

Yes, when your sync service syncs plugin data. PodNotes saves progress, podcasts, playlists, and settings in `data.json`.
PodNotes does not merge changes from two devices. Use one device at a time, because one device can overwrite the other's changes.
API keys and protected private feeds stay on each device. See [Sync between devices](/sync/).

## Transcription

### Does transcription cost money?

PodNotes is free, but transcription uses your own OpenAI or Deepgram account, and the provider bills you for API use.
Plain transcripts use OpenAI Whisper. **Speaker diarization** uses OpenAI or Deepgram.
PodNotes transcribes the audio itself. It does not import transcripts from Apple Podcasts or from a feed. See [Transcribe episodes](/transcripts/#cost).
