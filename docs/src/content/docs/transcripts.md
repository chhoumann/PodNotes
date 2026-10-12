---
title: Transcribe episodes
slug: transcripts
legacyTitleId: transcripts
description: Transcribe an episode into a note with your own API key, add speaker labels, and see what it costs.
---

Turn the audio of an episode into a transcript note with your own OpenAI or Deepgram account. Without speaker labels, PodNotes uses OpenAI. With speaker labels, you choose OpenAI or Deepgram, and Deepgram needs no OpenAI key.

## <span id="setting-up"></span>Set up an OpenAI key

Without speaker labels, PodNotes sends the audio to OpenAI with your API key.

1. Create a key on the [OpenAI API keys page](https://platform.openai.com/api-keys).
2. In Obsidian, open **Settings → PodNotes**.
3. Under **Transcripts**, select the secret picker next to **OpenAI API key**.
4. Create a secret that holds your key, or select one that you saved before.

On each other device, select or create the secret again. See [API keys and private feeds on each device](/sync/#api-keys-and-private-feeds-on-each-device).

## <span id="creating-a-transcript"></span>Transcribe an episode

1. Play an audio episode in PodNotes. You can pause it.
2. Run **PodNotes: Transcribe current episode** from the command palette (`Ctrl+P`, or `Command+P` on macOS).

A notice shows the progress, and you can keep listening. When the transcript is ready, PodNotes saves it as a note and opens it. With the default settings, the transcript of the Acquired episode "The Home Depot" is `transcripts/Acquired/The Home Depot.md`.

## <span id="speaker-diarization"></span><span id="enabling-it"></span>Add speaker labels

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

### <span id="speaker-label-format"></span>Change the speaker label format

1. In **Settings → PodNotes**, under **Transcripts**, turn on **Speaker diarization**. **Speaker label format** appears below it.
2. Set **Speaker label format**, for example to `**Speaker {{speaker}}:**` with a space at the end.

The format sets the text before each turn. The default, `**{{speaker}}:**` with a space at the end, starts a turn with **A:** in bold. With `**Speaker {{speaker}}:**`, a turn starts with **Speaker A:**. With Deepgram, the labels are numbers, as in **Speaker 1:**. The labeled text fills `{{transcript}}`, so **Transcript template** needs no change.

## <span id="transcript-template"></span>Change where transcripts go and what they contain

**Transcript file path** under **Transcripts** sets where the note goes, `transcripts/{{podcast}}/{{title}}.md` by default. Keep `.md` at the end, because PodNotes does not add it. **Transcript template** sets the content, and `{{transcript}}` is the transcript text. [Transcript and timestamp tags](/templates/#transcript-and-timestamp-tags) lists every tag and the default template.

## <span id="cost"></span>What transcription costs

PodNotes charges nothing. Your provider bills your account per minute of audio:

- [OpenAI API pricing](https://openai.com/api/pricing/) lists the rate for plain transcription (`whisper-1`) and for speaker labels (`gpt-4o-transcribe-diarize`).
- [Deepgram pricing](https://deepgram.com/pricing) lists the rate for pre-recorded audio with speaker labels.

## Limits and error messages

These cases stop a transcription or change its result:

- PodNotes transcribes audio only. For a video episode, the command is missing.
- When the provider's key is not on this device, a notice asks you to select or create it in the transcript settings.
- When a transcript note already exists at the path, a notice gives its path and PodNotes does nothing else. To transcribe again, delete the note first.
- PodNotes sends long audio to OpenAI in parts of about 20 MB. In a transcript without speaker labels, a part that fails three times leaves the marker `[Error transcribing chunk N]`. To retry, delete the note and run the command again.
- Transcripts have no timestamps, so a line does not link to its moment in the episode.

## <span id="how-api-keys-are-stored"></span>API key storage

PodNotes keeps your API keys in Obsidian's secret storage on each device, and only the name of each key syncs. On the first start after an upgrade from a version that kept plain-text keys in `data.json`, PodNotes moves them to secret storage and does not finish loading until the move succeeds. If it fails, restart PodNotes. The move cannot erase old copies in backups or settings exports, so replace a key at the provider if it may have leaked. See [API keys and private feeds on each device](/sync/#api-keys-and-private-feeds-on-each-device).
