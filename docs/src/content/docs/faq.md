---
title: FAQ
slug: faq
description: Short answers about finding the player, adding podcasts, timestamps, sync, and transcription, with links to the full guides.
next: false
---

Find short answers to the questions PodNotes users ask most. Each answer links to the page that covers the topic in full.

## Setup and installation

### Where is the player?

Run **PodNotes: Show player** from the command palette. It opens the PodNotes view, and the full player when an episode is loaded. **Show PodNotes**, the podcast icon in the ribbon, opens the view only.
While an episode is loaded, the mini player at the bottom of the view shows it. Select the mini player to open the full player. See [Use the player](/player/).
PodNotes opens the view by itself only once, on a new install. After that, Obsidian keeps the layout you left. On a phone, see [Use PodNotes on your phone](/mobile/).

### Why are some commands missing?

Most commands appear only while an episode is loaded. A paused episode counts, and so does the episode PodNotes shows when Obsidian starts.
**PodNotes: Create episode note** needs **Episode note path** and **Episode note template**. With both set, it appears when an episode is loaded or you have added a podcast. The transcribe commands need an audio episode and a connection.
**PodNotes: Show player**, **PodNotes: Reorder Queue**, and the capture commands are always available. [Commands](/commands/) lists what each command needs.

### What changes when I update to 2.25.0?

PodNotes transcribes audio with **ElevenLabs**, **Deepgram**, **OpenRouter**, **OpenAI**, and **OpenAI-compatible server**, adds timestamps to audio transcripts, and moves OpenAI from `whisper-1` and `gpt-4o-transcribe-diarize` to **GPT Transcribe**. OpenAI no longer labels speakers, so switch to **ElevenLabs**, **Deepgram**, or a speaker-labeled **OpenRouter** model if you want speaker labels. [Update to 2.25.0](/update-2-25/) lists what your existing setup becomes.

### What changes when I update to 2.22.0?

The PodNotes view, the player, and the settings are redesigned, and your devices merge their changes into one library. Update PodNotes on every device before you use it there. [Update to 2.22.0](/upgrade/) lists what to do.

### How do I install a beta version or install manually?

Install a beta version with the BRAT plugin, or copy a release's files into your vault by hand.
[Other ways to install](/getting-started/#other-ways-to-install) has the steps for both.

## Podcasts and feeds

### Which podcasts can I add?

Any podcast with an RSS feed.
In the PodNotes view, select **Add podcast**, then search the Apple Podcasts directory by name, or paste an RSS feed URL or an Apple Podcasts show link.
A show missing from search can still work if you paste its RSS feed URL. See [Add and play podcasts](/podcasts/).

### Can I add Spotify exclusives or YouTube links?

No. PodNotes plays RSS feeds and cannot open Spotify or YouTube pages.
A show that exists only inside Spotify or another app has no feed to add. If the publisher also offers an RSS feed, add that feed.

### Can I use a private feed?

Yes, if your provider gives you a personal RSS feed address. Add the podcast with the whole address.
PodNotes cannot sign in to providers that require a browser login.
PodNotes keeps the private addresses it recognizes on each device, out of your synced vault, so you enter such an address once on each other device with **Set feed address**. See [Use private feeds](/private-feeds/).

### Can I annotate my own audio or video?

Yes. Play an audio or video file from your vault in PodNotes, then capture timestamps and create an episode note as with any episode.
See [Play your own audio and video](/local_files/#play-your-own-audio-and-video) for the steps and the file types PodNotes plays.

## Notes and timestamps

### Why are my timestamps plain text?

Your **Timestamp template** uses `{{time}}`, which inserts plain text.
Installs set up before PodNotes 2.21.0 keep the old default, which uses `{{time}}`. New installs use `{{linktime}}`, which inserts a link that plays the episode from that moment.
In **Settings → PodNotes**, under **Notes**, set **Timestamp template** to `- {{linktime}}` with a space at the end. If it already uses `{{linktime}}`, the cause is the episode. It has no feed or local file to link to, or it comes from a private feed that you have not added. See [Make timestamps clickable](/timestamps/#make-timestamps-clickable).

### Can I take notes on an episode I listen to in another app?

Yes. Add the podcast to PodNotes, then create the note from the episode's menu. The episode does not have to play. See [Create a note for another episode](/notes/#create-a-note-for-another-episode).
Timestamps come from the PodNotes player, so to capture them, play the episode in PodNotes.
For notes about a whole show, use a podcast note. See [Create a podcast note](/notes/#create-a-podcast-note).

### Do headset buttons control PodNotes?

Yes, on a computer, while an episode is loaded. Play and pause work, the skip buttons jump by your skip lengths, and by default the previous-track action, often a triple press, captures a timestamp. You choose what the previous-track and next-track actions do under **Headset and lock screen** in **Settings → PodNotes**. Not every headset sends every action.
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

### Can I listen offline?

Yes, to episodes you downloaded and to your own media files. Offline, the PodNotes view shows **Offline**, and lists split into **Available offline** and **Needs a connection**. Podcast search, refreshing feeds, and transcription need a connection. See [Listen offline](/local_files/#listen-offline).

### Does playback progress sync between devices?

Yes, when your sync service syncs plugin data. PodNotes saves progress, podcasts, playlists, and settings in `data.json`, and merges the changes your devices make. A paused player takes the synced position by itself. When you switch devices, pause on the device you leave and follow [Use PodNotes on two devices](/sync/#use-podnotes-on-two-devices), so that a device that is still playing does not replace your progress.
If PodNotes shows a notice that it cannot save, see [Fix save problems](/save-problems/).
API keys and the private feed addresses that PodNotes recognizes stay on each device. See [Sync between devices](/sync/).

## Transcription

### Does transcription cost money?

Not for a podcast you added, when its feed lists a transcript in a format that PodNotes reads. PodNotes saves that transcript for free, with no API key.
To transcribe the audio, PodNotes uses your own **ElevenLabs**, **Deepgram**, **OpenRouter**, or **OpenAI** account (which bills your account for API use), or an **OpenAI-compatible server** (which runs at no API cost on your own hardware, or uses your server host's rates).
PodNotes does not import transcripts from Apple Podcasts. See [What transcription costs](/transcripts/#what-transcription-costs) and [Choose a transcription provider](/transcription-providers/).

### Which provider should I use?

Start with **ElevenLabs**. It is the default on new installs, labels speakers, adds timestamps, and fetches public episodes up to 15 hours itself so your device uploads nothing.
Use **OpenRouter** to run speech transcription on the same OpenRouter key and balance as your other AI tools: **Grok STT 2.0** (recommended), **ElevenLabs Scribe v2**, and **MAI-Transcribe 2** label speakers, **Voxtral Mini Transcribe 3** has the lowest measured mean word error on OpenRouter (4.55%), and **Qwen3 ASR 1.7B** costs about $0.03 per hour.
Use **Deepgram** if speed comes first, **OpenAI-compatible server** to keep audio on your machine with a local server or connect a hosted `/v1/audio/transcriptions` endpoint, or **OpenAI** if you already have an OpenAI key and do not need timestamps or speaker labels. See [Choose a transcription provider](/transcription-providers/).

### Why does my transcript have no speaker labels?

Check these four causes:

- **The feed published the transcript.** **PodNotes: Transcribe current episode** saves the feed's own transcript when one exists, and keeps speaker names only if the publisher wrote them into that file. Run **PodNotes: Transcribe current episode from audio** to transcribe with your provider instead.
- **Speaker labels are turned off.** In **Settings → PodNotes**, under **Transcripts**, turn on **Speaker labels**, delete the old transcript note, and run the command again.
- **Your selected model or provider does not label speakers.** OpenRouter's **Voxtral Mini Transcribe 3** and **Qwen3 ASR 1.7B**, **OpenAI** (**GPT Transcribe**), and **OpenAI-compatible server** never label speakers, even when **Speaker labels** was left on. Switch to **ElevenLabs**, **Deepgram**, or an **OpenRouter** model that labels speakers (**Grok STT 2.0**, **ElevenLabs Scribe v2**, or **MAI-Transcribe 2**).
- **The model returned no speaker labels.** A recording with one voice, or a response with no speaker tags, saves with the notice `"Saved without speaker labels, because <Model> returned none."` Try another model or provider if the episode has multiple speakers.

See [Speaker labels](/transcripts/#speaker-labels).

### Why did my transcription fail?

Match the notice PodNotes showed to find what happened and what to do. In the notices below, `<Provider>` is **ElevenLabs**, **Deepgram**, **OpenRouter**, **OpenAI**, or **OpenAI-compatible server**, `<server>` is the host and port from **Server address**, and `<model>` is the model ID sent to that provider.

- **`"Enter the address of your OpenAI-compatible server, starting with http:// or https://, in the transcript settings."`** **Server address** is empty or invalid. Under **Transcripts**, enter a valid `http://` or `https://` URL, such as `http://localhost:8000/v1`.
- **`"Enter a model for your OpenAI-compatible server in the transcript settings."`** **Model** is empty while **OpenAI-compatible server** is selected. Enter the model ID your server expects under **Transcripts**.
- **`"Select or create an <Provider> API key in the transcript settings on this device."`** or **`"Select or create a Deepgram API key in the transcript settings on this device."`** No key is chosen for the active cloud provider on this device. Open **Settings → PodNotes**, scroll to **Transcripts**, and link or create the key. See [Choose a transcription provider](/transcription-providers/).
- **`"The selected <Provider> API key is not available on this device. Select or create it in the transcript settings."`** Your synced settings name a secret that has not been added on this device yet. Under **Transcripts**, link or create the key on this device.
- **`"This version of PodNotes cannot transcribe with <id>. Update PodNotes, or choose another provider in the transcript settings."`** Another device chose a provider that this older PodNotes version does not recognize. Update PodNotes on this device, or pick another **Transcription provider**.
- **`"The published transcript could not be fetched: ..."`** or **`"The published transcript could not be read."`** The feed linked to a broken or unreadable transcript file. Check your connection, or run **PodNotes: Transcribe current episode from audio** to transcribe the audio instead.
- **`"Transcription failed: <Provider> rejected the API key. Check it in the transcript settings."`** or **`"Transcription failed: The server at <server> rejected the API key. Check it in the transcript settings."`** The key was revoked, mistyped, missing, or lacks permission. Create or check the key (on ElevenLabs, enable Speech to Text if you restrict permissions), then update the key row under **Transcripts**.
- **`"Transcription failed: Your <Provider> account is out of credit. Add credit there, then try again."`** Your balance or monthly limit ran out on the provider's site. Add credit in your provider's billing settings, then run the command again.
- **`"Transcription failed: <Provider> does not offer the <model> model to this API key."`** Your account or key tier cannot access the selected model. Under **Transcripts**, set **Model** to the recommended model, or check model access on the provider's site.
- **`"Transcription failed: The server at <server> has no <model> model at that address. Check the address and the model in the transcript settings."`** The server returned HTTP 404 for the endpoint or model. Check **Model**, and check that **Server address** includes `/v1` if your server serves `/v1/audio/transcriptions`.
- **`"Transcription failed: <Provider> does not offer the <model> model under your <Provider> privacy settings. Change them there, or choose another model in the transcript settings."`** On OpenRouter, your [OpenRouter privacy settings](https://openrouter.ai/settings/privacy) block every upstream provider for that model. Relax that setting on OpenRouter, or choose another **Model** under **Transcripts**.
- **`"Transcription failed: <Provider> could not transcribe this audio."`** The provider or server rejected the audio data or request. Check that the episode plays in PodNotes, or try another provider or model.
- **`"Transcription failed: OpenAI-compatible server did not answer in a format PodNotes reads."`** The server rejected both `verbose_json` and `json` for `response_format` with HTTP 400. Check that **Server address** and **Model** point to an OpenAI-compatible `/v1/audio/transcriptions` endpoint.
- **`"Transcription failed: <Provider> could not fetch the episode."`** When a provider cannot fetch a public episode URL itself, PodNotes automatically downloads the episode on your device and uploads it instead. If a request still ends with this notice, check that the episode plays in PodNotes and try again.
- **`"Transcription failed: <Provider> is limiting how fast your key may be used. Try again in a few minutes."`** You hit the provider's rate limit. PodNotes retries up to three times when the server asks to wait a minute or less. Wait a few minutes, then run the command again.
- **`"Transcription failed: <Provider> failed (HTTP <status>). Try again later."`** The provider returned a server error after up to three attempts, or answered HTTP 2xx with non-JSON text. Wait and try again, check **Server address** when using **OpenAI-compatible server**, or switch **Transcription provider** if an outage continues.
- **`"Transcription failed: Could not reach <Provider>. Check your connection."`** or **`"Transcription failed: PodNotes could not reach the server at <server>. Check the address in the transcript settings."`** PodNotes could not connect after up to three attempts. Check your internet connection, check that your server is running, and on a phone use your computer's local network or VPN address instead of `localhost`.
- **`"Transcription failed: <Provider> did not answer within 10 minutes."`** (or **`"30 minutes."`** for **Deepgram**). The request timed out. PodNotes never retries a timed-out request automatically so you are not billed twice if the provider is still finishing it. Wait a few minutes, then try again.
- **`"Transcription failed: <Provider> found no speech in this episode."`** The provider returned no words for the audio, for example on an instrumental or silent file.
