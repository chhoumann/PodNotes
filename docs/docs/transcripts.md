# Transcripts

PodNotes allows you to create transcripts of podcast episodes using OpenAI's Whisper model, complete with configurable timestamps that link directly to specific points in the audio.

## Setting Up

Before you can use the transcription feature, you need to set up a few things:

1. **OpenAI API Key**: You need to have an OpenAI API key. You can get one by signing up at [OpenAI's website](https://openai.com/). Once you have the key, enter it in the PodNotes settings under the "Transcript settings" section.

2. **Transcript File Path**: In the settings, you can specify where you want the transcript files to be saved. You can use placeholders like `{{podcast}}` and `{{title}}` in the path.

3. **Transcript Template**: You can customize how the transcript content is formatted using a template.

4. **Timestamp Settings**: Configure timestamp behavior with these options:
   - **Include timestamps in transcripts**: Toggle whether timestamps should be included in the transcripts. When enabled, clickable timestamp links are added to the transcript that allow you to jump directly to that point in the episode.
   - **Timestamp range (seconds)**: Control the density of timestamps by setting the minimum time gap between timestamps (1-10 seconds). Lower values create more frequent timestamps.

## Creating a Transcript

To create a transcript:

1. Start playing the podcast episode you want to transcribe.
2. Use one of these options:
   - Use the "Transcribe current episode" command in Obsidian's command palette
   - Click the "Transcribe" button in the player interface
   - Use the transcription option in the episode context menu (right-click an episode)
3. PodNotes will:
   - Validate your OpenAI API key
   - Download the episode (if it hasn't been downloaded already)
   - Display a progress indicator with file size and estimated completion time
   - Split the audio into memory-efficient chunks
   - Process chunks in parallel (up to 3 at a time)
   - Send these chunks to OpenAI for transcription
4. Once the transcription is complete, a new file will be created at the specified location with the transcribed content.

## Monitoring and Managing Transcriptions

Transcribing long episodes can take significant time. PodNotes provides several features to help manage this process:

### Progress Tracking
During transcription, you'll see a detailed progress indicator showing:
- Percentage complete
- Number of chunks processed
- Processing speed
- Estimated time remaining

### Cancelling Transcriptions
If you need to stop a transcription in progress:

1. Use the "Cancel Current Transcription" command from Obsidian's command palette
2. The partial progress will be saved for later resumption

### Resuming Interrupted Transcriptions
If a transcription was interrupted or cancelled:

1. When you return to the episode, you'll see a notification that there's an interrupted transcription
2. Choose "Resume" to continue from where the transcription stopped
3. Choose "New" to start a fresh transcription

This is useful when:
- You accidentally cancelled a transcription
- Obsidian was closed during transcription
- There was a temporary API error

## Working with Timestamped Transcripts

Transcripts can include clickable timestamp links that help you navigate your podcast content efficiently:

![Example of a timestamped transcript](resources/timestamped_transcript.png)

* **Timestamp Ranges**: Timestamps appear as ranges (e.g., **[00:01:15] - [00:01:45]**) to help you understand the duration of each segment.
* **Navigation**: Click any timestamp to immediately jump to that position in the podcast when playing the episode.
* **Note Taking**: Timestamps make it easy to reference specific parts of episodes in your notes.

## Transcript Template

The transcript template works similarly to the [note template](./templates.md#note-template), but with the added `{{transcript}}` placeholder which will be replaced with the transcribed content.

## Customizing Timestamps

You can control how timestamps appear in your transcripts using the settings:

1. **Without Timestamps**: If you prefer clean text without timestamps, disable the "Include timestamps in transcripts" option.

2. **Dense Timestamps**: For detailed navigation, set the timestamp range to a lower value (1-2 seconds).

3. **Sparse Timestamps**: For a cleaner look with fewer timestamps, set the timestamp range to a higher value (5-10 seconds).
