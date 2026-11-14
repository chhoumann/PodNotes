---
title: Update to 2.25.0
slug: update-2-25
description: What changes in audio transcription when you update from PodNotes 2.24.0 to 2.25.0, including the OpenAI model change and how to keep speaker labels.
---

Update from PodNotes 2.24.0 to 2.25.0 to transcribe audio with **ElevenLabs**, **Deepgram**, **OpenRouter**, or **OpenAI**, and get clickable timestamps in audio transcripts. If you are updating from 2.21.1 or earlier, read [Update to 2.22.0](/upgrade/) first.

## Why OpenAI transcription changed

OpenAI shuts down `whisper-1` and `gpt-4o-transcribe-diarize` on `2027-02-26`. PodNotes 2.25.0 moves OpenAI transcription to **GPT Transcribe** (`gpt-transcribe`).

**GPT Transcribe** returns plain text only, without timestamps and without speaker labels. **ElevenLabs**, **Deepgram**, and **OpenRouter** all return both clickable timestamps and speaker labels.

## How your 2.24.0 settings migrate

PodNotes maps your 2.24.0 transcript settings automatically on first load:

| Your 2.24.0 setup | Transcription provider in 2.25.0 | Model | Speaker labels | What changes |
| --- | --- | --- | --- | --- |
| **Speaker diarization** on, **Deepgram** | **Deepgram** | **Recommended (Nova-3)** | On | Keeps using your Deepgram key. Audio transcripts now include clickable timestamps, and speakers are numbered `1`, `2`, `3` in the order they first speak. |
| **Speaker diarization** on, **OpenAI (gpt-4o-transcribe-diarize)** | **OpenAI** | **Recommended (GPT Transcribe)** | On | Keeps using your OpenAI key, but OpenAI no longer labels speakers. Each transcript saves as plain paragraphs and shows a notice naming the providers that label speakers. |
| **Speaker diarization** off, OpenAI key linked | **OpenAI** | **Recommended (GPT Transcribe)** | Off | Keeps using your OpenAI key with **GPT Transcribe** in place of `whisper-1`. Transcripts remain plain paragraphs without timestamps or speaker labels. |
| **Speaker diarization** off, no OpenAI key linked | **ElevenLabs** | **Recommended (Scribe v3)** | Off | Ready for ElevenLabs if you decide to add a key later. Turn on **Speaker labels** under **Transcripts** when you want speaker numbers. Feed transcripts still save for free without a key. |

**Transcript path**, **Transcript template**, and **Speaker label format** keep the values you set in 2.24.0. In settings under **Transcripts**, **Speaker diarization** is renamed to **Speaker labels**, and **Diarization provider** is replaced by **Transcription provider** and **Model**.

## Get speaker labels and timestamps after using OpenAI

If you used OpenAI for speaker labels in 2.24.0, or if you want clickable timestamps in audio transcripts, set up **ElevenLabs**, **Deepgram**, or **OpenRouter** in [Choose a transcription provider](/transcription-providers/). Then check that **Speaker labels** is on:

1. In Obsidian, open **Settings → PodNotes**.
2. Under **Transcripts**, turn on **Speaker labels** if it is off.

If you prefer to stay on **OpenAI** without speaker labels, turn off **Speaker labels** under **Transcripts** so PodNotes stops showing the missing-labels notice after each transcription.

## Devices still on 2.24.0

PodNotes 2.25.0 keeps the same `data.json` storage format as 2.24.0 and preserves the 2.24.0 diarization fields alongside the new provider settings:

- A phone or second computer still running 2.24.0 keeps syncing your library and keeps using its 2.24.0 transcription setup without overwriting your 2.25.0 provider choice.
- Importing a 2.24.0 settings file carries over **Deepgram** when that file had **Speaker diarization** on with **Deepgram**, and otherwise keeps your library's current **Transcription provider**.
- Update any 2.24.0 device that uses OpenAI before `2027-02-26`, when OpenAI turns off `whisper-1` and `gpt-4o-transcribe-diarize`.
