---
title: Choose a transcription provider
slug: transcription-providers
description: Compare ElevenLabs, Deepgram, OpenRouter, OpenAI, and OpenAI-compatible servers for podcast transcription, and set one up in PodNotes.
---

Pick a speech-to-text provider or connect an OpenAI-compatible server so PodNotes can transcribe episodes that publish no transcript in their feed:

- **ElevenLabs** (default on new installs): speaker labels and clickable timestamps, fetched directly by ElevenLabs for public episodes up to 15 hours.
- **Deepgram**: fast speaker labels and clickable timestamps, fetched directly for public episodes up to 2 GB.
- **OpenRouter**: five models on one key and balance, with speaker-labeled **Grok STT 2.0**, **ElevenLabs Scribe v2**, and **MAI-Transcribe 2**, plus low-error **Voxtral Mini Transcribe 3** and low-cost **Qwen3 ASR 1.7B**.
- **OpenAI**: plain-text transcripts without timestamps or speaker labels on an existing OpenAI key.
- **OpenAI-compatible server**: any `/v1/audio/transcriptions` server, such as local `whisper.cpp`, `faster-whisper`, or `speaches` on your machine, or a hosted endpoint such as Groq.

PodNotes charges nothing for transcription. Compare limits, timestamps, and model details in [Provider and model reference](/transcription-providers/#provider-and-model-reference).

## <span id="set-up-elevenlabs"></span><span id="set-up-deepgram"></span><span id="set-up-openai"></span>Set up ElevenLabs, Deepgram, or OpenAI

1. On your provider's site ([ElevenLabs](https://elevenlabs.io/app/developers/api-keys), [Deepgram](https://console.deepgram.com/), or [OpenAI](https://platform.openai.com/api-keys)), create an API key.
2. In Obsidian, open **Settings → PodNotes**.
3. Under **Transcripts**, in **Transcription provider**, select **ElevenLabs**, **Deepgram**, or **OpenAI**.
4. Next to **ElevenLabs API key**, **Deepgram API key**, or **OpenAI API key**, select **Link...**, or **Change** when a key is already set.
5. In the secret picker, create a secret that holds your key, or select one you saved before.
6. In **Model**, keep **Recommended (Scribe v3)**, **Recommended (Nova-3)**, or **Recommended (GPT Transcribe)**.

If you restrict key permissions on ElevenLabs, enable Speech to Text. On OpenAI, **GPT Transcribe** writes plain paragraphs without timestamps or speaker labels (see [Update to 2.25.0](/update-2-25/) if you used OpenAI in 2.24.0).

![The Transcripts group in PodNotes settings with ElevenLabs selected](/screenshots/transcript-settings.webp)

## Set up OpenRouter

1. On the [OpenRouter keys page](https://openrouter.ai/settings/keys), create an API key.
2. In Obsidian, open **Settings → PodNotes**.
3. Under **Transcripts**, in **Transcription provider**, select **OpenRouter**.
4. Next to **OpenRouter API key**, select **Link...**, or **Change** when a key is already set.
5. In the secret picker, create a secret that holds your key, or select one you saved before.
6. In **Model**, select **Recommended (Grok STT 2.0)**, **ElevenLabs Scribe v2**, **MAI-Transcribe 2**, **Voxtral Mini Transcribe 3**, or **Qwen3 ASR 1.7B**.

The first three models add speaker labels and timestamps, while **Voxtral Mini Transcribe 3** and **Qwen3 ASR 1.7B** add timestamps without speaker labels. Compare all five in [OpenRouter models](/transcription-providers/#openrouter-models).

![Transcripts settings with OpenRouter selected and the Model dropdown](/screenshots/openrouter-models.webp)

## Set up an OpenAI-compatible server

1. On your computer or server host, start your `/v1/audio/transcriptions` server or copy its base URL.
2. In Obsidian, open **Settings → PodNotes**.
3. Under **Transcripts**, in **Transcription provider**, select **OpenAI-compatible server**.
4. In **Server address**, enter the server's `http://` or `https://` URL, for example `http://localhost:8000/v1`.
5. If the server requires an API key, next to **OpenAI-compatible server API key**, select **Link...**, or **Change** when a key is already set. Leave it unlinked if your server needs no key.
6. When the secret picker opens, create a secret that holds your key, or select one you saved before.
7. In **Model**, enter the model ID your server expects, for example `Systran/faster-whisper-large-v3` on an example `speaches` server or `whisper-large-v3-turbo` on an example Groq server.

![The Transcripts group in PodNotes settings with OpenAI-compatible server selected](/screenshots/openai-compatible-settings.webp)

- **Accepted addresses:** Enter `http://` or `https://` with a valid host, an optional port (`1` to `65535`), and no `#` fragment or backslash (otherwise the row shows `"The address must start with http:// or https://."`). PodNotes trims trailing slashes and appends `/audio/transcriptions` unless already present, so include `/v1` when your server serves `/v1/audio/transcriptions`, as in the example addresses `http://localhost:8000/v1`, `http://192.168.1.20:8000/v1`, `https://api.groq.com/openai/v1`, or `http://localhost:8000/v1/audio/transcriptions`.
- **Uploads and privacy:** PodNotes downloads or reads the episode on your device and uploads it in parts up to 24 MB. With a server on the same computer, audio stays on your machine. On a phone, `localhost` points to the phone itself, so enter your computer's local network or VPN address instead.
- **Timestamps and speaker labels:** PodNotes requests `verbose_json` word and segment times, joins Whisper word pieces, and restores punctuation onto unpunctuated words from the full text. You get clickable paragraph timestamps when the server returns times, or plain text without timestamps when it returns text only or refuses timestamp options (`response_format`, `verbose_json`, or `timestamp_granularities`) with HTTP 400, in which case PodNotes retries for `json`. **OpenAI-compatible server** does not label speakers.

## <span id="provider-comparison"></span>Provider and model reference

| Provider and models | Labels and times | Public podcast feeds | Long episodes | Key and pricing |
| --- | --- | --- | --- | --- |
| **ElevenLabs**<br>**Scribe v3** (recommended) | Speakers (`1`, `2`, `3`) and timestamps | Fetched by provider, so your device uploads nothing | One request up to 5 GB and 15 hours | [API keys](https://elevenlabs.io/app/developers/api-keys), [pricing](https://elevenlabs.io/pricing/api) |
| **Deepgram**<br>**Nova-3** (recommended) | Speakers (`1`, `2`, `3`) and timestamps | Fetched by provider, so your device uploads nothing | One request up to 2 GB | [Console](https://console.deepgram.com/), [pricing](https://deepgram.com/pricing) |
| **OpenRouter**<br>5 models (see table below) | Timestamps on all 5. Speakers (`1`, `2`, `3`) on **Grok STT 2.0**, **ElevenLabs Scribe v2**, and **MAI-Transcribe 2**. | **ElevenLabs Scribe v2** fetches public URLs. The other four upload from your device. | **ElevenLabs Scribe v2** takes a public URL in one request. Uploads split past 18 MB / 30 min MP3 (or 12 MB / 15 min MP3 on **Voxtral Mini Transcribe 3** and **Qwen3 ASR 1.7B**). | [Keys](https://openrouter.ai/settings/keys), [model rates](https://openrouter.ai/models?output_modalities=transcription) |
| **OpenAI**<br>**GPT Transcribe** (recommended) | Plain text only (no speakers or timestamps) | Uploaded from your device | Split past 24 MB (or 34.5 min for MP3) | [API keys](https://platform.openai.com/api-keys), [pricing](https://openai.com/api/pricing/) |
| **OpenAI-compatible server**<br>Any model ID your server offers | Timestamps when the server returns word or segment times, otherwise plain text. No speakers. | Uploaded from your device (stays on your machine with a local server) | Split past 24 MB | Optional bearer key, your own server or host's rates |

A provider fetches an episode URL directly only when you added the podcast to PodNotes with a public feed address and that feed still lists the episode at a public `http` or `https` address without credentials. For [private feeds](/private-feeds/), [downloads and local files](/local_files/), or an episode URL the provider cannot fetch, PodNotes downloads the audio on your device and uploads it instead.

### OpenRouter models

| Model | Speaker labels | Timestamps | Long episodes | Notes |
| --- | --- | --- | --- | --- |
| **Grok STT 2.0** (recommended) | Yes (`1`, `2`, `3`) | Word and segment | Splits uploads past 18 MB (or 30 min for MP3), and matches MP3 voices across parts | Default OpenRouter model |
| **ElevenLabs Scribe v2** | Yes (`1`, `2`, `3`) | Word | Fetches public episode URLs in one request. Uploads split past 18 MB (or 30 min for MP3), and speaker numbers restart per part. | No device upload on public feeds |
| **MAI-Transcribe 2** | Yes (`1`, `2`, `3`) | Word | Splits uploads past 18 MB (or 30 min for MP3), and speaker numbers restart per part | Speaker-labeled alternative |
| **Voxtral Mini Transcribe 3** | No | Segment | Splits uploads past 12 MB (or 15 min for MP3) | Lowest measured mean word error on OpenRouter (4.55%) |
| **Qwen3 ASR 1.7B** | No | Word (PodNotes restores punctuation from the response text) | Splits uploads past 12 MB (or 15 min for MP3) | Cheapest on OpenRouter, about $0.03 per hour of audio |

PodNotes checks OpenRouter's public transcription catalog at most once a day when you open settings or start a transcription, without sending your key:

- A model with a scheduled retirement date in the future shows that date in **Model**, such as `, ends 2027-06-01`.
- If OpenRouter withdraws a model you selected earlier, **Model** marks it `, no longer offered`, and PodNotes falls back to **Grok STT 2.0** with a notice when you transcribe.
- If your [OpenRouter privacy settings](https://openrouter.ai/settings/privacy) block every route for a model, transcription stops with a notice asking you to change them or choose another model.

### API keys across devices and backups

PodNotes stores your **ElevenLabs**, **Deepgram**, **OpenRouter**, **OpenAI**, and optional **OpenAI-compatible server** API keys in Obsidian's secret storage on each device:

- Only the selected provider's key row appears under **Transcripts**, and keys you saved for other providers stay stored so you can switch **Transcription provider** without entering them again.
- **Server address** and **Model** sync in `data.json`, while vault sync copies only a secret reference (such as `podnotes-elevenlabs-api-key` or `podnotes-openai-compatible-api-key`), never the key itself. On another device where a selected secret has not been added yet, the key row reads "The selected secret is not available on this device. Select an existing secret or create one." Add or select the key on each device where you transcribe audio. See [API keys and private feeds on each device](/sync/#api-keys-and-private-feeds-on-each-device).
- **Export settings** leaves API keys out unless you turn on **Include API keys** first. An export that includes API keys writes them in plain text, so treat the file like a password. See [API keys in a settings file](/import_export/#api-keys-in-a-settings-file).
- When you update from a version before 2.19.0 that stored plain-text keys in `data.json`, PodNotes moves them into secret storage on first start before finishing load. Old backups or exports keep any plain-text keys they held, so replace a key on the provider's site if it may have leaked.
