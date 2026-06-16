## Show PodNotes
Opens the PodNotes pane and brings it into focus.

If the pane already exists but is hidden — for example in a collapsed sidebar or out of view because the right sidebar has too many icons — this command reveals it. If it does not exist yet, the command creates it in the right sidebar. You can run it from the command palette or bind it to a hotkey.

PodNotes also adds a **podcast icon to the left ribbon** as a reliable way to reopen the pane. On mobile it appears in the ribbon menu, and you can hide it via Obsidian's *Manage ribbon actions* if you prefer to use the command instead.

If you are having issues with PodNotes not being shown, feel free to create an [issue](https://github.com/chhoumann/PodNotes/issues/new).

## Play Podcast
This will start playback if the current episode is paused.

## Stop Podcast
This will stop playback if the current episode is playing.

## Toggle playback
This will toggle playback between playing and paused.

## Skip Backward
This will skip the current episode back by the amount of seconds specified in the settings.

## Skip Forward
This will skip the current episode forward by the amount of seconds specified in the settings.

## Download Playing Episode
This will download the currently playing episode.

Downloads are stored in the location specified by the **Episode download path** setting. This path is a template and **must include a per-episode token** such as `{{title}}` (the default is `PodNotes/{{podcast}}/{{title}}`). A path without `{{title}}` makes every episode resolve to the same file, so downloads overwrite each other or fail. The file extension is added automatically — do not include one.

## Reload Podnotes
This will reload PodNotes.

## Capture Timestamp
This will capture the current timestamp of the currently playing episode.

See [timestamps](timestamps.md) for more information on timestamp templates.

## Create episode note
This will create a note for the currently playing episode.

(This command was previously named "Create Podcast Note". The name was changed to
distinguish it from the feed-level command below; existing hotkeys are unaffected.)

See [templates](templates.md) for more information on note templates.

## Create podcast feed note
This creates a note for a whole podcast (the feed as a whole), not a single
episode. It does **not** require playing anything: running the command opens a
picker of your saved podcasts, and choosing one creates (or opens) that podcast's
note. You can also create a feed note from an episode's right-click menu
("Create feed note").

See [templates](templates.md#podcast-feed-notes) for the feed note template and
its available tags.

## Copy universal episode link to clipboard
This will copy the universal episode link to the clipboard.

First, it checks for the episode on iTunes to get its ID.
Then, it asks pod.link for an episode ID, after which it constructs the universal episode link and copies it to your clipboard.

Episode links look like this: [https://pod.link/1138055739/episode/1732808e781cc64a30d7feba0467b63a](https://pod.link/1138055739/episode/1732808e781cc64a30d7feba0467b63a).

They can be used to share the episode with others, no matter what podcast app they use.

## Transcribe current episode
This command will transcribe the currently playing episode using OpenAI's Whisper model.

The transcription will be saved in the location specified in the transcript settings.

Note: This feature requires an OpenAI API key to be set in the settings.