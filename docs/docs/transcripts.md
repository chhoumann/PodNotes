# Transcripts

PodNotes allows you to create transcripts of podcast episodes using OpenAI's Whisper model.

## Setting Up

Before you can use the transcription feature, you need to set up a few things:

1. **OpenAI API Key**: You need to have an OpenAI API key. You can get one by signing up at [OpenAI's website](https://openai.com/). Once you have the key, enter it in the PodNotes settings under the "Transcript settings" section.

2. **Transcript File Path**: In the settings, you can specify where you want the transcript files to be saved. You can use placeholders like `{{podcast}}` and `{{title}}` in the path.

3. **Transcript Template**: You can also customize how the transcript content is formatted using a template.

## Creating a Transcript

To create a transcript:

1. Start playing the podcast episode you want to transcribe.
2. Use the "Transcribe current episode" command in Obsidian.
3. PodNotes will fetch the audio for the episode you are playing (reusing an already-downloaded copy when one exists), split it into chunks, and send these chunks to OpenAI for transcription. The transcription always uses the currently playing episode's own audio, regardless of your download path settings.
4. Once the transcription is complete, a new file will be created at the specified location with the transcribed content.

## Transcript Template

The transcript template works similarly to the [note template](./templates.md#note-template), but with the added `{{template}}` placeholder.

## Speaker Diarization

By default the transcription uses OpenAI's Whisper model, which produces plain text with **no speaker labels**. Speaker diarization is an opt-in setting that instead labels each segment of the transcript by speaker, e.g.:

```
**Speaker A:** Welcome to the show.

**Speaker B:** Thanks for having me.
```

### Enabling it

In the **Transcript settings** section, turn on **Speaker diarization** and choose a provider:

- **OpenAI** (`gpt-4o-transcribe-diarize`): reuses the OpenAI API key you already entered above, so there is nothing else to configure. Because OpenAI caps each request at 25 MB, a long episode is split into chunks that are diarized independently — so on long episodes the speaker labels can change across chunk boundaries (the same person may be labelled `A` in one chunk and `B` in the next). A typical-length episode fits in a single request and is fully consistent.
- **Deepgram**: sends the whole episode in one request, so speaker labels stay consistent across the entire episode. This requires a separate **Deepgram API key**, which you can create at [deepgram.com](https://deepgram.com) (new accounts include free credit). Your Deepgram key is stored separately from your OpenAI key and is only used for diarization.

Diarization is off by default, so existing transcripts and the plain-Whisper workflow are unchanged unless you enable it.

### Speaker label format

The **Speaker label format** setting controls the prefix added before each speaker's turn. Use the `{{speaker}}` placeholder for the speaker's label:

- OpenAI labels speakers `A`, `B`, `C`, …
- Deepgram labels speakers `1`, `2`, `3`, …

The default is `**{{speaker}}:** `, which renders as `**Speaker A:**`-style bold prefixes. For example, `> {{speaker}}: ` would put each turn in a blockquote.

The labelled transcript replaces the usual `{{transcript}}` value in your [transcript template](#transcript-template), so you don't need to change your template to use diarization.

### Cost

Diarization providers bill per minute/hour of audio (separately from any plain-Whisper usage). As of mid-2026, OpenAI's diarize model is roughly $0.006 per minute, and Deepgram's diarized pre-recorded transcription is roughly $0.0068 per minute. Check each provider's current pricing before transcribing long back-catalogues.
