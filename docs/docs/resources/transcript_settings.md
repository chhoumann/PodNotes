# Transcript Settings

## OpenAI API Key
[API Key field] - Enter your OpenAI API key for transcription functionality.

## Transcript file path
[transcripts/{{podcast}}/{{title}}.md] - The path where transcripts will be saved. Use {{}} for dynamic values.
Example: transcripts/The Daily Stoic/They Have To Be This Way.md

## Transcript template
```
# {{title}}

Podcast: {{podcast}}
Date: {{date}}

## Description
{{description}}

## Transcript
{{transcript}}
```

## Include timestamps in transcripts
[x] - When enabled, transcripts will include timestamps linking to specific points in the episode.

## Timestamp range (seconds)
[|---●------] 2 - The minimum time gap between timestamps in the transcript. Lower values create more timestamps.