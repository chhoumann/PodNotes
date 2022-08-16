Timestamps can be created with the `Capture Timestamp` Obsidian command.

This will make PodNotes capture the current playback time to the active note, in the format given in the plugin settings.

## Settings
For timestamps, you can use the following format strings:

- `{{time}}`: The current playback time. Default format is `HH:mm:ss`.
- `{{linktime}}`: The current playback time, formatted as a link to the current episode. Default format is `HH:mm:ss`.

Both of these allow for custom formatting.
By using `{{time:format}}` or `{{linktime:format}}`, you can specify a custom [Moment.js](https://momentjs.com) format.

For example, you might use `{{time:H\h mm\m ss\s}}` to get the time in the format `0h 20m 37s`.
