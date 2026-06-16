Timestamps can be created with the `Capture Timestamp` Obsidian command.

This will make PodNotes capture the current playback time to the active note, in the format given in the plugin settings.
PodNotes can also capture recent playback segments with the `Capture Last 10 Seconds` and `Capture Last 20 Seconds` commands.

## Settings
For timestamps, you can use the following format strings:

- `{{time}}`: The current playback time. Default format is `HH:mm:ss`.
- `{{linktime}}`: The current playback time, formatted as a link to the current episode. Default format is `HH:mm:ss`.
- `{{segment}}`: A start-end range for a captured segment. Default format is `HH:mm:ss`.
- `{{linksegment}}`: A start-end range, formatted as a link that opens the current episode at the segment start and pauses at the segment end. Default format is `HH:mm:ss`.

These allow for custom formatting.
By using `{{time:format}}`, `{{linktime:format}}`, `{{segment:format}}`, or `{{linksegment:format}}`, you can specify a custom [Moment.js](https://momentjs.com) format.

For example, you might use `{{time:H\h mm\m ss\s}}` to get the time in the format `0h 20m 37s`.

## Capturing timestamps
You can use the `Capture Timestamp` command by using the `PodNotes: Capture Timestamp` command in the command palette.

The timestamp is inserted at your cursor. When the cursor is inside a markdown table cell, the captured text stays on that row: any pipes are escaped and newlines are collapsed to spaces so the table is not broken.

**On desktop**, it is possible to bind this command to a hotkey, which makes it faster to use while writing.
You can bind hotkeys in the `Hotkeys` tab of the Obsidian settings.

**On mobile**, you can bind the `Capture Timestamp` command to a button in the editor toolbar.
That is the toolbar which appears when you are editing text on mobile devices.

You can set this up by going to the `Mobile` tab of the Obsidian settings.
When there, you can add the `PodNotes: Capture Timestamp` command to the editor toolbar. If it hasn't already been added as an option, it is either under `More toolbar options`, or you can add it manully by entering `PodNotes: Capture Timestamp` in the `Add global command` field.

You can change the order of the buttons in the editor toolbar by dragging them up and down. The further up they are, the more to the left they will be.

## Capturing segments
You can use the `PodNotes: Capture Last 10 Seconds` and `PodNotes: Capture Last 20 Seconds` commands to insert a link for the recent playback range ending at the current playback time.

Segment capture uses the same timestamp template setting. If your template uses `{{time}}` or `{{linktime}}`, PodNotes automatically uses the segment equivalent for these commands, so the default `- {{linktime}}` template inserts a linked range such as `00:01:55-00:02:05`.

Clicking a segment link reopens the episode, seeks to the segment start, starts playback, and pauses when the segment end is reached. Segment links do not extract or save separate audio clips, so they work without ffmpeg or other external dependencies.
