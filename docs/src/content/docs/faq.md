---
title: FAQ
slug: faq
description: Short answers about finding the player, adding podcasts, timestamps, sync, and transcription, with links to the full guides.
next: false
---

Find short answers to the questions PodNotes users ask most. Each answer links to the page that covers the topic in full.

## Setup and installation

### Where is the player?

Run **PodNotes: Show player** from the command palette, or select the **Show PodNotes** podcast icon in the ribbon.
Both open the player or reveal it if it is already open.
On a phone, the player stays closed until you open it. See [Use PodNotes on your phone](/mobile/).

### Why are some commands missing?

Most commands appear only while an episode is loaded. A paused episode counts.
**PodNotes: Capture Timestamp** needs a note open in an editor, and **PodNotes: Reorder Queue** needs at least two episodes in the queue.
**PodNotes: Show player** is always available. [Commands](/commands/) lists what each command needs.

### How do I install a beta version or install manually?

Install a beta version with the BRAT plugin, or copy a release's files into your vault by hand.
[Other ways to install](/getting-started/#other-ways-to-install) has the steps for both.

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
When the URL contains a password or a token parameter, PodNotes keeps it on the current device only, so the feed works on one device at a time. See [API keys and private feeds on each device](/sync/#api-keys-and-private-feeds-on-each-device).

### Can I annotate my own audio or video?

Yes. Play an audio or video file from your vault in PodNotes, then capture timestamps and create an episode note as with any episode.
See [Play your own audio and video](/local_files/#play-your-own-audio-and-video) for the steps and the file types PodNotes plays.

## Notes and timestamps

### Why are my timestamps plain text?

Your **Capture timestamp format** uses `{{time}}`, which inserts plain text.
Installs set up before PodNotes 2.21.0 keep the old default, which uses `{{time}}`. New installs use `{{linktime}}`, which inserts a link that plays the episode from that moment.
In **Settings → PodNotes**, set **Capture timestamp format** to `- {{linktime}}` with a space at the end. If it already uses `{{linktime}}`, the episode has no feed URL or local file to link to. See [Make timestamps clickable](/timestamps/#make-timestamps-clickable).

### Can I take notes on an episode I listen to in another app?

Yes. Add the podcast to PodNotes, then create the note from the episode's menu. The episode does not have to play. See [Create a note for another episode](/notes/#create-a-note-for-another-episode).
Timestamps come from the PodNotes player, so to capture them, play the episode in PodNotes.
For notes about a whole show, use a feed note. See [Create a feed note for a podcast](/notes/#create-a-feed-note-for-a-podcast).

### Do headset buttons control PodNotes?

One button does. When your headset sends the previous-track action, PodNotes captures a timestamp. If a note is open in an editor, the timestamp goes in at the cursor. If no note is open in an editor, it goes at the end of the episode note.
This works on a phone or a computer, but not every headset sends that action. PodNotes adds no other headset actions, so play, pause, and skip depend on your device. See [Capture with a headset](/mobile/#capture-with-a-headset).

## Devices and sync

### Do downloads sync with my vault?

Downloads are files in your vault, so they sync only if your sync service includes them.
Syncing PodNotes' `data.json` alone does not move the audio or video. File types and size limits depend on your sync service.
See [Downloads on another device](/sync/#downloads-on-another-device).

### What happens to notes and links when I remove a download?

Your notes and timestamps stay.
Timestamp links point at the feed and the episode, so they stream the episode again while the feed still lists it.
Links to your own media files need the file. See [Removed downloads and existing links](/sync/#removed-downloads-and-existing-links).

### Does playback progress sync between devices?

Yes, when your sync service syncs plugin data. PodNotes saves progress, podcasts, playlists, and settings in `data.json`.
PodNotes does not merge changes from two devices, so one device can overwrite the other's changes. Use one device at a time. When you switch, let sync finish, then restart Obsidian or turn PodNotes off and on before you use it. See [Use PodNotes on two devices](/sync/#use-podnotes-on-two-devices).
API keys and protected private feeds stay on each device. See [Sync between devices](/sync/).

## Transcription

### Does transcription cost money?

PodNotes is free, but transcription uses your own OpenAI or Deepgram account, and the provider bills you for API use.
Plain transcripts use OpenAI Whisper. **Speaker diarization** uses OpenAI or Deepgram.
PodNotes transcribes the audio itself. It does not import transcripts from Apple Podcasts or from a feed. See [What transcription costs](/transcripts/#what-transcription-costs).
