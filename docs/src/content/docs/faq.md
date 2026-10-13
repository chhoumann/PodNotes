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

Most commands appear only while an episode is loaded. A paused episode counts, and so does the episode PodNotes shows when Obsidian starts.
**PodNotes: Create episode note** also appears once you add a podcast, if **Note creation file path** and **Note creation template** are set, and **PodNotes: Reorder Queue** needs at least two episodes in the queue.
**PodNotes: Show player** and the capture commands are always available. [Commands](/commands/) lists what each command needs.

### How do I install a beta version or install manually?

Install a beta version with the BRAT plugin, or copy a release's files into your vault by hand.
[Other ways to install](/getting-started/#other-ways-to-install) has the steps for both.

## Podcasts and feeds

### Which podcasts can I add?

Any podcast with an RSS feed.
In **Settings → PodNotes**, under **Search Podcasts**, search the Apple Podcasts directory by name, or paste an RSS feed URL or an Apple Podcasts show link.
A show missing from search can still work if you paste its RSS feed URL. See [Add and play podcasts](/podcasts/).

### Can I add Spotify exclusives or YouTube links?

No. PodNotes plays RSS feeds and cannot open Spotify or YouTube pages.
A show that exists only inside Spotify or another app has no feed to add. If the publisher also offers an RSS feed, add that feed.

### Can I use a private feed?

Yes, if your provider gives you a personal RSS feed address. Add the podcast with the whole address.
PodNotes cannot sign in to providers that require a browser login.
PodNotes keeps a private address on each device, out of your synced vault, so you enter it once on each other device with **Set feed address**. See [Use private feeds](/private-feeds/).

### Can I annotate my own audio or video?

Yes. Play an audio or video file from your vault in PodNotes, then capture timestamps and create an episode note as with any episode.
See [Play your own audio and video](/local_files/#play-your-own-audio-and-video) for the steps and the file types PodNotes plays.

## Notes and timestamps

### Why are my timestamps plain text?

Your **Capture timestamp format** uses `{{time}}`, which inserts plain text.
Installs set up before PodNotes 2.21.0 keep the old default, which uses `{{time}}`. New installs use `{{linktime}}`, which inserts a link that plays the episode from that moment.
In **Settings → PodNotes**, set **Capture timestamp format** to `- {{linktime}}` with a space at the end. If it already uses `{{linktime}}`, the episode has no feed or local file to link to, or it comes from a private feed that you have not added. See [Make timestamps clickable](/timestamps/#make-timestamps-clickable).

### Can I take notes on an episode I listen to in another app?

Yes. Add the podcast to PodNotes, then create the note from the episode's menu. The episode does not have to play. See [Create a note for another episode](/notes/#create-a-note-for-another-episode).
Timestamps come from the PodNotes player, so to capture them, play the episode in PodNotes.
For notes about a whole show, use a feed note. See [Create a feed note for a podcast](/notes/#create-a-feed-note-for-a-podcast).

### Do headset buttons control PodNotes?

Yes, on a computer, while an episode is loaded. Play and pause work, the skip buttons jump by your skip lengths, and the previous-track action, often a triple press, captures a timestamp. Not every headset sends every action.
On an iPhone or iPad, the same controls should work, but they are not tested yet. On Android, Obsidian does not pass headset buttons or lock screen controls to PodNotes. See [Control playback from a headset or the lock screen](/mobile/#control-playback-from-a-headset-or-the-lock-screen).

## Devices and sync

### Do downloads sync with my vault?

Downloads are files in your vault, so they sync only if your sync service includes them.
Syncing PodNotes' `data.json` alone does not move the audio or video. File types and size limits depend on your sync service.
See [Downloads on another device](/sync/#downloads-on-another-device).

### What happens to notes and links when I remove a download?

Your notes and timestamps stay.
Timestamp links point at the feed and the episode, so they stream the episode again while the feed still lists it.
Links to your own media files need only the file in your vault. See [Removed downloads and existing links](/sync/#removed-downloads-and-existing-links).

### Does playback progress sync between devices?

Yes, when your sync service syncs plugin data. PodNotes saves progress, podcasts, playlists, and settings in `data.json`, and merges the changes your devices make. When you switch devices, pause first and let sync finish. See [Use PodNotes on two devices](/sync/#use-podnotes-on-two-devices).
If PodNotes shows a notice that it cannot save, see [Fix save problems](/save-problems/).
API keys and private feed addresses stay on each device. See [Sync between devices](/sync/).

## Transcription

### Does transcription cost money?

Not when the podcast's feed publishes a transcript. PodNotes saves that transcript for free, with no API key.
To transcribe the audio, PodNotes uses your own OpenAI or Deepgram account, and the provider bills you for API use. Plain transcripts use OpenAI Whisper. **Speaker diarization** uses OpenAI or Deepgram.
PodNotes does not import transcripts from Apple Podcasts. See [What transcription costs](/transcripts/#what-transcription-costs).
