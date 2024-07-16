## Show PodNotes
This command is only accessible if there doesn't exist a pane with PodNotes already.

Activating it will spawn a new pane with PodNotes in the right sidebar.

If you are having issues with PodNotes not being shown, feel free to create an [issue](https://github.com/chhoumann/PodNotes/issues/new). However, do make sure to check that the icon isn't just out of view by scrolling on the right sidebar.

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

Downloads are stored in the location specified in settings.

## Reload Podnotes
This will reload PodNotes.

## Capture Timestamp
This will capture the current timestamp of the currently playing episode.

See [timestamps](timestamps.md) for more information on timestamp templates.

## Create Podcast Note
This will create a note for the currently playing episode.

See [templates](templates.md) for more information on note templates.

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