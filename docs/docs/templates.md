PodNotes can create notes from templates. These templates can contain certain syntax, which will be expanded to metadata about the podcast episode you are listening to.

To use templates, you can use the `Create podcast note` Obsidian command.
This requires you to have defined a template for both the file path and note text.

## File path
This template will be used to create the file path for the note. You can use the following syntax:

- `{{title}}`: The title of the podcast episode.
- `{{podcast}}`: The name of the podcast.
- `{{date}}`: The publish date of the podcast episode. Please note that this is not always available, and will be empty if it is not.
	- You can use `{{date:format}}` to specify a custom [Moment.js](https://momentjs.com) format. E.g. `{{date:YYYY-MM-DD}}`.

Both syntax items will be formatted such that it is safe to use in a file path.
This means the following characters will be removed: `\ , # % & / { } * < > $ ' " : @ ‣ | ?`.

## Note template
This template will be used to create the note text. You can use the following syntax:

- `{{title}}`: The title of the podcast episode.
- `{{safeTitle}}`: The title of the podcast episode, but with all special characters removed (like `{{title}}` in file path templates).
- `{{description}}`: The description of the podcast episode.
	-  You can use `{{description:> }}` to prepend each new line with a `>` (to put the entire description in a blockquote).
- `{{content}}`: The content of the podcast episode from `<content:encoded>`. Show notes will sometimes land here.
	-  You can use `{{content:> }}` to prepend each new line with a `>` (to put the entire content in a blockquote).

- `{{podcast}}`: The name of the podcast.
- `{{url}}`: The URL of the podcast episode.
- `{{date}}`: The publish date of the podcast episode.
	- You can use `{{date:format}}` to specify a custom [Moment.js](https://momentjs.com) format. E.g. `{{date:YYYY-MM-DD}}`.
- `{{artwork}}`: The URL of the podcast artwork. If no artwork is found, an empty string will be used.
