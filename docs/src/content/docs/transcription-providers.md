---
title: Choose a transcription provider
slug: transcription-providers
description: Compare ElevenLabs, Deepgram, OpenRouter, and OpenAI for podcast transcription, and set up an API key in PodNotes.
---

Pick a speech-to-text provider and add your API key so PodNotes can transcribe episodes that publish no transcript in their feed.

Start with **ElevenLabs**, the default on new installs: it adds clickable timestamps and speaker labels, fetches public episodes directly so your device uploads nothing, and transcribes episodes up to 15 hours in one request.

PodNotes charges nothing for transcription. Every provider bills your own account directly.

## Provider comparison

| Provider and models | Labels and times | Public podcast feeds | Long episodes | Key and pricing |
| --- | --- | --- | --- | --- |
| **ElevenLabs**<br>**Scribe v3** (recommended) | Speakers (`1`, `2`, `3`) and timestamps | Fetched by provider, so your device uploads nothing | One request up to 5 GB and 15 hours | [API keys](https://elevenlabs.io/app/developers/api-keys), [pricing](https://elevenlabs.io/pricing/api) |
| **Deepgram**<br>**Nova-3** (recommended) | Speakers (`1`, `2`, `3`) and timestamps | Fetched by provider, so your device uploads nothing | One request up to 2 GB | [Console](https://console.deepgram.com/), [pricing](https://deepgram.com/pricing) |
| **OpenRouter**<br>**Grok STT 2.0** (recommended), **ElevenLabs Scribe v2**, **MAI-Transcribe 2** | Speakers (`1`, `2`, `3`) and timestamps | **ElevenLabs Scribe v2** fetches public URLs. Others upload from your device. | **ElevenLabs Scribe v2** takes a public URL in one request. Uploads split past 18 MB (or 30 min for MP3), and **Grok STT 2.0** matches MP3 voices across parts. | [Keys](https://openrouter.ai/settings/keys), [model rates](https://openrouter.ai/models?output_modalities=transcription) |
| **OpenAI**<br>**GPT Transcribe** (recommended) | Plain text only (no speakers or timestamps) | Uploaded from your device | Split past 24 MB (or 34.5 min for MP3) | [API keys](https://platform.openai.com/api-keys), [pricing](https://openai.com/api/pricing/) |

A provider fetches an episode URL directly only when you added the podcast to PodNotes with a public feed address and that feed still lists the episode at a public `http` or `https` address without credentials. For [private feeds](/private-feeds/), [downloads and local files](/local_files/), or an episode URL the provider cannot fetch, PodNotes downloads the audio on your device and uploads it instead.

![The Transcripts group in PodNotes settings with ElevenLabs selected](/screenshots/transcript-settings.webp)

## Set up ElevenLabs

1. On the [ElevenLabs API keys page](https://elevenlabs.io/app/developers/api-keys), create an API key.
2. In Obsidian, open **Settings → PodNotes**.
3. Under **Transcripts**, in **Transcription provider**, select **ElevenLabs**.
4. Next to **ElevenLabs API key**, select **Link...**, or **Change** when a key is already set.
5. In the secret picker, create a secret that holds your key, or select one you saved before.
6. In **Model**, keep **Recommended (Scribe v3)**.

If you restrict key permissions on ElevenLabs, enable Speech to Text.

## Set up Deepgram

1. In the [Deepgram console](https://console.deepgram.com/), create an API key.
2. In Obsidian, open **Settings → PodNotes**.
3. Under **Transcripts**, in **Transcription provider**, select **Deepgram**.
4. Next to **Deepgram API key**, select **Link...**, or **Change** when a key is already set.
5. In the secret picker, create a secret that holds your key, or select one you saved before.
6. In **Model**, keep **Recommended (Nova-3)**.

## Set up OpenRouter

1. On the [OpenRouter keys page](https://openrouter.ai/settings/keys), create an API key.
2. In Obsidian, open **Settings → PodNotes**.
3. Under **Transcripts**, in **Transcription provider**, select **OpenRouter**.
4. Next to **OpenRouter API key**, select **Link...**, or **Change** when a key is already set.
5. In the secret picker, create a secret that holds your key, or select one you saved before.
6. In **Model**, select **Recommended (Grok STT 2.0)**, **ElevenLabs Scribe v2**, or **MAI-Transcribe 2**.

![The Model dropdown in Transcripts settings showing the OpenRouter transcription models](/screenshots/openrouter-models.webp)

PodNotes checks OpenRouter's public transcription catalog at most once a day when you open settings or start a transcription, without sending your key:

- A model with a scheduled retirement date in the future shows that date in the list, such as `, ends 2027-06-01`.
- If OpenRouter withdraws a model you selected earlier, **Model** marks it `, no longer offered`, and PodNotes falls back to **Grok STT 2.0** with a notice when you transcribe.
- If your OpenRouter privacy settings block every route for the model, transcription stops with a notice asking you to change your [OpenRouter privacy settings](https://openrouter.ai/settings/privacy) or choose another model.

## Set up OpenAI

1. On the [OpenAI API keys page](https://platform.openai.com/api-keys), create an API key.
2. In Obsidian, open **Settings → PodNotes**.
3. Under **Transcripts**, in **Transcription provider**, select **OpenAI**.
4. Next to **OpenAI API key**, select **Link...**, or **Change** when a key is already set.
5. In the secret picker, create a secret that holds your key, or select one you saved before.
6. In **Model**, keep **Recommended (GPT Transcribe)**.

**GPT Transcribe** writes plain paragraphs without timestamps or speaker labels. If you used OpenAI in PodNotes 2.24.0 or earlier, see [Update to 2.25.0](/update-2-25/).

## API keys across devices and backups

PodNotes stores your **ElevenLabs**, **Deepgram**, **OpenRouter**, and **OpenAI** API keys in Obsidian's secret storage on each device:

- Only the selected provider's key row appears under **Transcripts**, and keys you saved for other providers stay stored so you can switch **Transcription provider** without entering them again.
- Vault sync copies only a secret reference (such as `podnotes-elevenlabs-api-key`) in `data.json`, never the key itself. On another device where that secret has not been added yet, the key row reads "The selected secret is not available on this device. Select an existing secret or create one." Add or select the key on each device where you transcribe audio. See [API keys and private feeds on each device](/sync/#api-keys-and-private-feeds-on-each-device).
- **Export settings** leaves API keys out unless you turn on **Include API keys** first. An export that includes API keys writes them in plain text, so treat the file like a password. See [API keys in a settings file](/import_export/#api-keys-in-a-settings-file).
- When you update from a version before 2.19.0 that stored plain-text keys in `data.json`, PodNotes moves them into secret storage on first start before finishing load. Old backups or exports keep any plain-text keys they held, so replace a key on the provider's site if it may have leaked.
