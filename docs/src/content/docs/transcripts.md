---
title: Transcribe episodes
slug: transcripts
legacyTitleId: transcripts
description: Save the transcript a podcast feed publishes for free, or transcribe the audio with a cloud provider or an OpenAI-compatible server.
---

Turn an episode into a transcript note with clickable timestamps and speaker labels. When a podcast you added publishes a transcript in its feed, PodNotes saves that transcript at no cost and without an API key. Otherwise, PodNotes transcribes the audio through **ElevenLabs**, **Deepgram**, **OpenRouter**, **OpenAI**, or an **OpenAI-compatible server**.

## <span id="creating-a-transcript"></span>Transcribe an episode

**PodNotes: Transcribe current episode** uses the transcript the episode's feed publishes whenever one is available for a podcast in your library. When the feed has none in a format PodNotes reads, or for any other audio episode, it sends the audio to the provider selected in **Settings → PodNotes** under **Transcripts**. Before you set up a provider on this device, the command still saves feed transcripts and never bills you. For an episode that needs audio transcription, it shows a notice asking for your provider's API key, or for your **Server address** and **Model** when **OpenAI-compatible server** is selected.

1. In PodNotes, play an audio episode.
2. From the command palette (`Ctrl+P`, or `Command+P` on macOS), run **PodNotes: Transcribe current episode**.

A paused episode, or the episode PodNotes restores on startup, works too.

<span id="setting-up"></span><span id="set-up-an-openai-key"></span><span id="cost"></span><span id="what-transcription-costs"></span><span id="how-api-keys-are-stored"></span><span id="api-key-storage"></span>To transcribe audio, [choose a transcription provider or connect an OpenAI-compatible server](/transcription-providers/). That guide also covers provider pricing and how PodNotes stores keys on each device.

A notice tracks progress while you keep listening. When the transcript finishes, PodNotes saves the note and opens it, as [Where a note opens](/notes/#where-a-note-opens) describes. With the default path, the transcript of the Slow Thinking episode "Walking as thinking" saves to `transcripts/Slow Thinking/Walking as thinking.md`.

![A saved transcript note with clickable timestamps and numbered speaker labels](/screenshots/transcript-note.webp)

### Transcribe the audio instead

After you [set up a transcription provider](/transcription-providers/) on this device, you can transcribe the audio even when the feed publishes a transcript:

1. In your vault, rename, move, or delete any transcript note you already saved for the episode, because PodNotes keeps an existing note.
2. In PodNotes, play the audio episode.
3. From the command palette (`Ctrl+P`, or `Command+P` on macOS), run **PodNotes: Transcribe current episode from audio**.

This command always sends the episode to your chosen provider. Cloud providers use credit on your account there, and **OpenAI-compatible server** sends the audio to the server at **Server address**.

## Read the transcript in the player

The full player's **Transcript** panel displays the transcript that an episode's feed publishes, without saving a note. It shows **Feed transcript** and **Free** at the top.

1. In the full player, select **Transcript**.
2. In the transcript list, select a line with a time to play the episode from that moment. A transcript without times can only be read.

The panel highlights the line being spoken and scrolls with playback. Select **Find in transcript** to filter lines by word, or select **Save as note** to save the feed transcript without calling a provider. Where the panel is narrower than 340 px, such as in a narrow sidebar, **Save as note** shows only its page-with-plus icon. Once the note exists, the button reads **Open note**. See [Read the transcript](/player/#read-the-transcript) for every control.

This clip opens **Transcript**, selects a line to jump to its time, and searches for "walk":

![The full player's Transcript panel: a selected line plays from its time, and a search for walk shows only the lines that contain it](/videos/transcript.mp4)

When an episode has no feed transcript, the panel says "No transcript in this feed", or "No transcript yet" for a local file. For an audio episode, it offers **Transcribe with ElevenLabs** (or your chosen cloud **Transcription provider**) with a **Paid** tag, or **Transcribe with your server** without a **Paid** tag when **OpenAI-compatible server** is selected. Selecting the button runs the same audio transcription as **PodNotes: Transcribe current episode from audio**. Once the transcript note exists, the panel shows **Open note** instead. While your device is offline, the transcribe button and **Save as note** are disabled, and **Open note** remains available.

## <span id="transcripts-that-feeds-publish"></span>Timestamps in transcripts

Audio transcripts from **ElevenLabs**, **Deepgram**, all five **OpenRouter** models, and an **OpenAI-compatible server** that returns word or segment times include paragraph timestamps, matching timed transcripts from podcast feeds:

- Each paragraph starts with its start time, formatted from **Timestamp template** under **Notes** in **Settings → PodNotes**.
- With the default **Timestamp template**, `- {{linktime}}` followed by a space, each time is a link that plays the episode from that moment. With `{{time}}`, PodNotes writes plain text such as `00:00:08`. PodNotes ignores surrounding text in **Timestamp template**, such as the `-` list marker.
- **OpenAI** (**GPT Transcribe**), an **OpenAI-compatible server** that refuses timestamp options with HTTP 400 or returns text without word or segment times, plain-text feed transcripts, and HTML feed transcripts without cue times produce paragraphs without timestamps.
- When a podcast feed lists several `<podcast:transcript>` tags for one episode, PodNotes picks WebVTT first, then SRT, JSON, HTML, and plain text.

With the default settings, the Markdown of an audio transcript with timestamps and speaker labels looks like this:

```md wrap
[00:00:00](obsidian://podnotes?...) **1:** Why do so many writers say the sentence only came together once they stood up from the desk?

[00:00:08](obsidian://podnotes?...) **2:** At a desk your eyes stay fixed on the page, and the argument narrows to whatever is already in front of you.
```

## <span id="speaker-diarization"></span><span id="enabling-it"></span><span id="add-speaker-labels"></span>Speaker labels

In an audio transcript with **Speaker labels** turned on, PodNotes numbers speakers `1`, `2`, `3` in the order they first speak. With the default **Speaker label format**, `**{{speaker}}:**` followed by a space, each turn starts with **1:** or **2:** right after the timestamp.

In a transcript that a feed publishes, PodNotes uses the speaker names from the feed, such as **Maya Lind:**, whether **Speaker labels** is on or off.

**Speaker labels** is on by default in new installs. To turn it on or off:

1. Open **Settings → PodNotes**.
2. Under **Transcripts**, toggle **Speaker labels**.

### Models and speaker labels

- **ElevenLabs** (**Scribe v3**), **Deepgram** (**Nova-3**), and three **OpenRouter** models (**Grok STT 2.0**, **ElevenLabs Scribe v2**, and **MAI-Transcribe 2**) label speakers.
- OpenRouter's **Voxtral Mini Transcribe 3** and **Qwen3 ASR 1.7B**, **OpenAI** (**GPT Transcribe**), and **OpenAI-compatible server** do not label speakers. When one of them is selected, the **Speaker labels** row reads `"\<Model\> does not label speakers."` (for example `"Voxtral Mini Transcribe 3 does not label speakers."` or `"OpenAI-compatible server does not label speakers."`). If **Speaker labels** is off, the toggle is disabled. If **Speaker labels** was already on, the toggle stays active so you can turn it off. Transcribing with one of them while **Speaker labels** is on saves the note without speaker labels and shows a notice: `"Saved without speaker labels, because \<Model\> does not label speakers. These providers do: ElevenLabs, Deepgram, OpenRouter."`
- If a model that supports speaker labels returns no speaker tags for an episode, PodNotes saves the note without labels and shows `"Saved without speaker labels, because \<Model\> returned none."`

### Long episodes on OpenRouter

**ElevenLabs** and **Deepgram** transcribe a full episode in one request, so each speaker keeps the same number from start to finish. **OpenRouter** also transcribes a full public podcast episode in one request when you select **ElevenLabs Scribe v2** and OpenRouter can fetch the episode URL directly.

When **OpenRouter** uploads audio from your device, PodNotes splits the episode into parts past 18 MB (or 30 minutes for MP3) on **Grok STT 2.0**, **ElevenLabs Scribe v2**, and **MAI-Transcribe 2**, and past 12 MB (or 15 minutes for MP3) on **Voxtral Mini Transcribe 3** and **Qwen3 ASR 1.7B**:

- **Grok STT 2.0** (the recommended OpenRouter model): for MP3 episodes, PodNotes cuts a short clip reel of voices that speak for at least 2.6 seconds and sends one extra request to match them across parts. Matched voices keep one speaker number for the whole episode.
- **ElevenLabs Scribe v2** (on private feeds, local files, or other uploads) and **MAI-Transcribe 2**: speaker numbers restart in each part, so speaker `1` in part two may be a different person from speaker `1` in part one. The same happens on **Grok STT 2.0** when a split upload is not MP3, has fewer than two voice turns of at least 2.6 seconds across parts, or cannot complete the matching request. PodNotes saves the note and shows a warning: `"OpenRouter transcribed this episode in \<N\> parts, and speaker labels restart in each, so one person can have several labels."`
- **Voxtral Mini Transcribe 3** and **Qwen3 ASR 1.7B**: neither model labels speakers, and timestamps continue from the start of the episode across parts.

### <span id="speaker-label-format"></span>Change the speaker label format

If the selected model or provider does not label speakers and **Speaker labels** is disabled, switch **Transcription provider** or **Model** to one that labels speakers first.

1. In **Settings → PodNotes**, under **Transcripts**, turn on **Speaker labels** so **Speaker label format** appears below it.
2. In **Speaker label format**, enter the text to place before each speaker's turn, such as `**Speaker {{speaker}}:**` followed by a space.

`{{speaker}}` becomes the speaker number or feed speaker name, and the formatted text fills `{{transcript}}` in **Transcript template**. Transcripts that feeds publish keep using **Speaker label format** even if you turn **Speaker labels** off afterwards.

## <span id="transcript-template"></span>Change where transcripts go and what they contain

Under **Transcripts** in **Settings → PodNotes**, **Transcript path** sets where each transcript note is saved (`transcripts/{{podcast}}/{{title}}.md` by default). Keep `.md` at the end of **Transcript path**, because PodNotes does not add it. **Transcript template** sets the note's contents, where `{{transcript}}` inserts the transcript body. See [Transcript and timestamp tags](/templates/#transcript-and-timestamp-tags) for every available tag.

## <span id="limits-and-error-messages"></span>Limits

- PodNotes transcribes audio episodes only. For video episodes, both transcribe commands are hidden, though the **Transcript** panel can still read and save a video's published feed transcript.
- Both commands check that your device is online and are hidden while Obsidian reports your device as offline, even when **OpenAI-compatible server** points to a local server.
- PodNotes transcribes the audio instead of using a feed transcript when the episode is a local file, when you have not added the podcast to PodNotes, when the feed no longer lists the episode or lists no supported transcript format, or when PodNotes cannot reach the feed and has no cached copy listing the episode on this device.
- When a published transcript fails to download or parse, PodNotes shows a notice starting with "The published transcript could not be fetched" or "The published transcript could not be read." PodNotes never falls back to audio transcription on its own. When your chosen provider is ready on this device, the notice names **Transcribe current episode from audio** (noting API credit use for cloud providers, or naming your **OpenAI-compatible server**) so you can choose to run it. PodNotes waits 30 seconds for a feed transcript and reads up to 16 MB.
- When a note already exists at **Transcript path**, PodNotes leaves it untouched and shows its path. Rename, move, or delete the note to transcribe the episode again.
- When **OpenRouter** (past 18 MB or 30 minutes for MP3, or past 12 MB or 15 minutes for MP3 on **Voxtral Mini Transcribe 3** and **Qwen3 ASR 1.7B**), **OpenAI** (past 24 MB, or 34.5 minutes for MP3), or **OpenAI-compatible server** (past 24 MB) uploads an episode in parts, a part that fails leaves `[Error transcribing chunk N]` in that spot of the note, and a notice reports how many parts failed. Delete the note and run the command again to retry. If every part fails, PodNotes saves no note.
- For provider error notices and how to fix each one, see [Why did my transcription fail?](/faq/#why-did-my-transcription-fail).
