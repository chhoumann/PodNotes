---
title: Transcribe episodes
slug: transcripts
legacyTitleId: transcripts
description: Transcribe an episode into a note with your OpenAI or Deepgram key, add speaker labels, and see what it costs.
---

Turn the audio of an episode into a transcript note, with speaker labels if you want them, using your own OpenAI or Deepgram account.

## <span id="setting-up"></span>Set up an OpenAI key

Without speaker labels, PodNotes sends the audio to OpenAI with your API key.

1. Create a key on the [OpenAI API keys page](https://platform.openai.com/api-keys).
2. In Obsidian, open **Settings → PodNotes**.
3. Under **Transcripts**, select the secret picker next to **OpenAI API key**.
4. Create a secret that holds your key, or select one that you saved before.

The key stays in Obsidian's secret storage on this device. On each other device, select or create the secret again, as described in [Sync between devices](/sync/#secrets-on-each-device).

## <span id="creating-a-transcript"></span>Transcribe an episode

1. Play an audio episode in PodNotes. You can pause it.
2. Run **PodNotes: Transcribe current episode** from the command palette (`Ctrl+P`, or `Command+P` on macOS).

A notice shows the progress, and you can keep listening while it runs. When the transcript is ready, PodNotes saves it as a note and opens it. With the default settings, the transcript of the Acquired episode "The Home Depot" is `transcripts/Acquired/The Home Depot.md`.

PodNotes reads a downloaded episode or a local audio file from your vault. For any other episode, it fetches the audio from the feed without saving a download. Long audio goes to OpenAI in parts of about 20 MB. PodNotes runs two transcriptions at a time and queues the rest.

Workflow plugins such as QuickAdd can read a saved transcript through the [PodNotes API](/api/#transcript).

## <span id="speaker-diarization"></span><span id="enabling-it"></span>Add speaker labels

A plain transcript is text without speaker names. To label each turn by speaker:

1. Open **Settings → PodNotes**.
2. Under **Transcripts**, turn on **Speaker diarization**.
3. In **Diarization provider**, select **OpenAI (gpt-4o-transcribe-diarize)** or **Deepgram**.
4. If you selected **Deepgram**, create a key in the [Deepgram console](https://console.deepgram.com/) and select it under **Deepgram API key**.

The providers differ in these ways:

| Provider | Key | Labels | Long episodes |
| --- | --- | --- | --- |
| OpenAI | Your OpenAI key | `A`, `B`, `C` | Sent in parts of about 20 MB. Labels can restart in each part, so `A` in one part may be `B` in the next. |
| Deepgram | A Deepgram key. No OpenAI key needed. | `1`, `2`, `3` | Sent in one request. Labels stay the same for the whole episode. |

### <span id="speaker-label-format"></span>Change the speaker label format

**Speaker label format** sets the text before each speaker's turn. `{{speaker}}` is the label from the provider.

| Format | Turn starts with |
| --- | --- |
| `**{{speaker}}:** ` | **A:** in bold. This is the default. |
| `**Speaker {{speaker}}:** ` | **Speaker A:** in bold. |
| `> {{speaker}}: ` | A blockquote line that starts with `A:`. |

The labeled text fills `{{transcript}}` in **Transcript template**, so you do not need to change the template.

## <span id="transcript-template"></span>Change where transcripts go and what they contain

Under **Transcripts** in **Settings → PodNotes**, two settings shape the note:

- **Transcript file path** sets where the note goes. The default is `transcripts/{{podcast}}/{{title}}.md`. Keep `.md` at the end, because PodNotes does not add it to a transcript path.
- **Transcript template** sets the content. `{{transcript}}` is the transcript text. The default adds the title, the podcast, and the date above it.

[Transcript and timestamp tags](/templates/#transcript-and-timestamp-templates) lists every tag and the default template.

## <span id="cost"></span>What transcription costs

PodNotes has no subscription and charges nothing. Your provider bills your account per minute of audio, at its current rates:

- [OpenAI API pricing](https://openai.com/api/pricing/) lists the rate for plain transcription (`whisper-1`) and for speaker labels (`gpt-4o-transcribe-diarize`).
- [Deepgram pricing](https://deepgram.com/pricing) lists the rate for pre-recorded audio with speaker labels.

Check the rates before you transcribe a long back catalog.

## Limits and error messages

These cases stop a transcription or change its result:

- PodNotes transcribes audio episodes only. For a video episode, the command is missing.
- When the provider's key is not available on this device, PodNotes shows a notice that asks you to select or create it in the transcript settings. Select the key as described in [Set up an OpenAI key](#setting-up), or under **Deepgram API key** for Deepgram.
- When a transcript note already exists at the path, PodNotes shows a notice that you already transcribed the episode, with the note's path, and does nothing else. To transcribe again, delete the note first.
- In a transcript without speaker labels, a part of the audio that fails three times leaves the marker `[Error transcribing chunk N]`, and the note keeps the rest of the text. To retry, delete the note and run the command again.
- Transcripts have no timestamps, so a line of the transcript does not link to its moment in the episode.

## How API keys are stored

PodNotes keeps your API keys in Obsidian's secret storage on this device, not in its own files.
Only the name of each key syncs in `data.json`, so select the key again on each device.

Older versions of PodNotes kept the keys as plain text in `data.json`. On the first start after you upgrade, PodNotes moves them to secret storage and removes the plain-text copies.
If the move fails, PodNotes leaves `data.json` unchanged and shows a notice that stays until you close it. PodNotes does not finish loading until the move succeeds. Restart PodNotes to try again.

The move cannot erase copies in backups, sync version history, or old settings exports. If a key may have leaked, replace it at the provider.
