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
3. PodNotes will download the episode (if it hasn't been downloaded already), split it into chunks, and send these chunks to OpenAI for transcription.
4. Once the transcription is complete, a new file will be created at the specified location with the transcribed content.

## Transcript Template

The transcript template works similarly to the [note template](./templates.md#note-template), but with the added `{{template}}` placeholder.
