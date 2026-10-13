---
title: Transcribe episodes
slug: transcripts
legacyTitleId: transcripts
description: Save the transcript an episode's feed publishes, or transcribe the audio with your own API key, add speaker labels, and see what it costs.
---

Turn an episode into a transcript note. When you added the podcast and its feed publishes a transcript, PodNotes saves that one, with no API key and at no cost. Otherwise, PodNotes transcribes the audio with your own OpenAI or Deepgram account.

## <span id="creating-a-transcript"></span>Transcribe an episode

**PodNotes: Transcribe current episode** first uses the transcript the episode's feed publishes, at no cost, when you added the podcast to PodNotes. For any other episode, and when the feed publishes none, it transcribes the audio with your provider and API key, and your provider bills you for it. On a device without an API key, the command never bills you. It saves only transcripts that feeds publish, and otherwise shows a notice that asks for a key.

1. Play an audio episode in PodNotes. You can pause it.
2. Run **PodNotes: Transcribe current episode** from the command palette (`Ctrl+P`, or `Command+P` on macOS).

To transcribe audio, [set up an OpenAI key](#set-up-an-openai-key), or a Deepgram key for [speaker labels](#add-speaker-labels) with Deepgram.

A notice shows the progress, and you can keep listening. When the transcript is ready, PodNotes saves it as a note and opens it. With the default settings, the transcript of the Acquired episode "The Home Depot" is `transcripts/Acquired/The Home Depot.md`.

To transcribe the audio even when the feed publishes a transcript, first rename, move, or delete any transcript note you saved for the episode, because PodNotes does not replace an existing transcript. Then run **PodNotes: Transcribe current episode from audio**. It always uses your provider and your API key. A transcript of the audio has paragraphs without times, so its lines do not link to their moment in the episode. With speaker labels, each turn starts with a label such as **A:** with OpenAI or **1:** with Deepgram.

## Transcripts that feeds publish

Some feeds list a transcript for each episode with the Podcasting 2.0 `<podcast:transcript>` tag. PodNotes uses it when you added the podcast to PodNotes and the feed still lists the episode.

- When an episode lists several transcripts, PodNotes picks WebVTT, then SRT, then JSON, then HTML, then plain text.
- In a transcript with times, each paragraph starts with the time it begins. The time uses the time format in **Capture timestamp format**. With the default format, `- {{linktime}}` with a space at the end, the time is a link that plays the episode from that moment. With `{{time}}`, it is plain text. PodNotes ignores the rest of the format, such as the `-` list marker.
- When the transcript names its speakers, each speaker's turn starts with **Speaker label format**, even with **Speaker diarization** off.
- A plain text transcript, or an HTML transcript without times, has paragraphs but no times.

With the default settings, the Markdown of a transcript with times and speakers looks like this:

```md wrap
[00:00:00](obsidian://podnotes?...) **Ben:** Welcome back to the show. Today we look at how the company started.

[00:00:41](obsidian://podnotes?...) **David:** It started with two founders and one store.
```

## <span id="setting-up"></span>Set up an OpenAI key

To transcribe the audio without speaker labels, PodNotes sends it to OpenAI with your API key. A transcript that the feed publishes needs no key.

1. Create a key on the [OpenAI API keys page](https://platform.openai.com/api-keys).
2. In Obsidian, open **Settings → PodNotes**.
3. Under **Transcripts**, select the secret picker next to **OpenAI API key**.
4. Create a secret that holds your key, or select one that you saved before.

On each other device, select or create the secret again. See [API keys and private feeds on each device](/sync/#api-keys-and-private-feeds-on-each-device).

## <span id="speaker-diarization"></span><span id="enabling-it"></span>Add speaker labels

To label who speaks in a transcript of the audio:

1. Open **Settings → PodNotes**.
2. Under **Transcripts**, turn on **Speaker diarization**.
3. In **Diarization provider**, select **OpenAI (gpt-4o-transcribe-diarize)** or **Deepgram**.
4. If you selected **Deepgram**, create a key in the [Deepgram console](https://console.deepgram.com/).
5. If you selected **Deepgram**, under **Deepgram API key**, select or create a secret that holds the Deepgram key. With OpenAI, PodNotes uses your OpenAI key.

The providers differ in these ways:

| Provider | Key | Labels | Long episodes |
| --- | --- | --- | --- |
| OpenAI | Your OpenAI key | `A`, `B`, `C` | Sent in parts of about 20 MB. `A` in one part may be `B` in the next. |
| Deepgram | A Deepgram key. No OpenAI key needed. | `1`, `2`, `3` | Sent in one request. Labels stay the same for the whole episode. |

A transcript that the feed publishes uses the speaker names in the feed, whatever this setting says.

### <span id="speaker-label-format"></span>Change the speaker label format

1. In **Settings → PodNotes**, under **Transcripts**, turn on **Speaker diarization**. **Speaker label format** appears below it.
2. Set **Speaker label format**, for example to `**Speaker {{speaker}}:**` with a space at the end.

The format sets the text before each turn. The default, `**{{speaker}}:**` with a space at the end, starts a turn with **A:** in bold. With `**Speaker {{speaker}}:**`, a turn starts with **Speaker A:**. With Deepgram, the labels are numbers, as in **Speaker 1:**. The labeled text fills `{{transcript}}`, so **Transcript template** needs no change.

Transcripts that feeds publish use the format too. If you turn **Speaker diarization** off again afterwards, they keep using it.

## <span id="transcript-template"></span>Change where transcripts go and what they contain

**Transcript file path** under **Transcripts** sets where the note goes, `transcripts/{{podcast}}/{{title}}.md` by default. Keep `.md` at the end, because PodNotes does not add it. **Transcript template** sets the content, and `{{transcript}}` is the transcript text. [Transcript and timestamp tags](/templates/#transcript-and-timestamp-tags) lists every tag and the default template.

## <span id="cost"></span>What transcription costs

A transcript that the feed publishes costs nothing. To transcribe the audio, PodNotes charges nothing, and your provider bills your account per minute of audio:

- [OpenAI API pricing](https://openai.com/api/pricing/) lists the rate for plain transcription (`whisper-1`) and for speaker labels (`gpt-4o-transcribe-diarize`).
- [Deepgram pricing](https://deepgram.com/pricing) lists the rate for pre-recorded audio with speaker labels.

## Limits and error messages

These cases stop a transcription or change its result:

- PodNotes transcribes audio episodes only. For a video episode, both commands are missing.
- PodNotes transcribes the audio instead of using the feed's transcript for a local file, for a podcast you have not added to PodNotes, and when the feed no longer lists the episode or lists no transcript in a format PodNotes reads.
- When PodNotes transcribes the audio and the provider's key is not on this device, a notice asks you to select or create it in the transcript settings.
- When PodNotes cannot fetch or read the feed's transcript, a notice starts with "The published transcript could not be fetched" or "The published transcript could not be read." PodNotes does not transcribe the audio on its own. If your provider's key is on this device, the notice names **Transcribe current episode from audio**, which uses your API credit. To try the feed again, run **PodNotes: Transcribe current episode** again.
- PodNotes waits 30 seconds for a feed's transcript and reads at most about 16 MB of it.
- When a transcript note already exists at the path, a notice gives its path and PodNotes does nothing else. To transcribe again, rename, move, or delete the note first.
- PodNotes sends long audio to OpenAI in parts of about 20 MB. In a transcript without speaker labels, a part that fails three times leaves the marker `[Error transcribing chunk N]`. With OpenAI speaker labels, the marker is `[Error diarizing chunk N]`. To retry, delete the note and run the command again. When every part fails, PodNotes saves no note.

## <span id="how-api-keys-are-stored"></span>API key storage

PodNotes keeps your API keys in Obsidian's secret storage on each device, and only the name of each key syncs. On the first start after an upgrade from a version that kept plain-text keys in `data.json`, PodNotes moves them to secret storage and does not finish loading until the move succeeds. If it fails, restart PodNotes. The move cannot erase old copies in backups or settings exports, so replace a key at the provider if it may have leaked. See [API keys and private feeds on each device](/sync/#api-keys-and-private-feeds-on-each-device).
