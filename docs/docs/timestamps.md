# Timestamps

Timestamps can be created with the `Capture Timestamp` Obsidian command or generated automatically in transcripts.

This will make PodNotes capture the current playback time to the active note, in the format given in the plugin settings.

## Timestamp Types

PodNotes supports two main ways of working with timestamps:

1. **Manual timestamps**: Captured on demand while listening to episodes
2. **Transcript timestamps**: Automatically generated in transcriptions

## Settings
For timestamps, you can use the following format strings:

- `{{time}}`: The current playback time. Default format is `HH:mm:ss`.
- `{{linktime}}`: The current playback time, formatted as a link to the current episode. Default format is `HH:mm:ss`.
- `{{timerange}}`: A time range showing start and end times. Format: `HH:mm:ss - HH:mm:ss`.
- `{{linktimerange}}`: A time range with clickable links to start and end times. Format: `[HH:mm:ss] - [HH:mm:ss]`.

All of these allow for custom formatting.
By using `{{time:format}}`, `{{linktime:format}}`, `{{timerange:format}}`, or `{{linktimerange:format}}`, you can specify a custom [Moment.js](https://momentjs.com) format.

For example, you might use `{{time:H\h mm\m ss\s}}` to get the time in the format `0h 20m 37s`.

The timestamp range templates (`{{timerange}}` and `{{linktimerange}}`) are primarily used in transcript generation, but can also be used in custom templates.

## Capturing Manual Timestamps
You can use the `Capture Timestamp` command by using the `PodNotes: Capture Timestamp` command in the command palette.

**On desktop**, it is possible to bind this command to a hotkey, which makes it faster to use while writing.
You can bind hotkeys in the `Hotkeys` tab of the Obsidian settings.

**On mobile**, you can bind the `Capture Timestamp` command to a button in the editor toolbar.
That is the toolbar which appears when you are editing text on mobile devices.

You can set this up by going to the `Mobile` tab of the Obsidian settings.
When there, you can add the `PodNotes: Capture Timestamp` command to the editor toolbar. If it hasn't already been added as an option, it is either under `More toolbar options`, or you can add it manully by entering `PodNotes: Capture Timestamp` in the `Add global command` field.

You can change the order of the buttons in the editor toolbar by dragging them up and down. The further up they are, the more to the left they will be.

## Transcript Timestamps

Transcript timestamps are automatically generated when you create a transcript. They appear as timestamp ranges that mark the beginning and end of each segment of speech.

Example: **[00:01:15] - [00:01:45]** Some transcribed content...

These timestamps are clickable links that will open the podcast player and seek to that specific time when clicked. This makes it easy to reference and revisit specific sections of a podcast.

For more information about transcript timestamps, see the [Transcripts](./transcripts.md) documentation.
