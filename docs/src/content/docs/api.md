# API
```js
export interface IAPI {
	readonly podcast: Episode;
	readonly transcript: Promise<string | null>;
	readonly isPlaying: boolean;
	readonly length: number;
	currentTime: number;
	playbackRate: number;
	volume: number;

	getPodcastTimeFormatted(
		format: string,
		linkify?: boolean,
		offsetSeconds?: number,
	): string;
	getPodcastSegmentFormatted(
		format: string,
		startTime: number,
		endTime: number,
		linkify?: boolean,
	): string;
	getTranscript(episode?: Episode): Promise<string | null>;
	start(): void;
	stop(): void;
	togglePlayback(): void;
	skipBackward(): void;
	skipForward(): void;
	increasePlaybackRate(): void;
	decreasePlaybackRate(): void;
	resetPlaybackRate(): void;
}
```

The above functions are all accessible through `app.plugins.plugins.podnotes.api`.

## `podcast`
This returns the currently playing episode.

```js
export interface Episode {
    title: string,
	streamUrl: string
	url: string,
	description: string,
	content: string,
	podcastName: string,
	feedUrl?: string,
	artworkUrl?: string;
	episodeDate?: Date;
}
```

## `transcript`
This is a convenience getter for `getTranscript()`:

```js
const transcript = await app.plugins.plugins.podnotes.api.transcript;
```

It returns the generated transcript note for the current episode, or `null` if no
episode is loaded or no transcript file exists yet. It does not call OpenAI or
create a new transcript. Generate the transcript first with PodNotes' **Transcribe
current episode** command.

If your transcript template includes metadata such as the title and date, that
metadata is included in the returned text. Set the transcript template to
`{{transcript}}` if your macro should receive only the transcript body.

## `getTranscript(episode?: Episode)`
This reads the generated transcript note for the provided episode. If no episode
is provided, it reads the current episode's transcript.

```js
const api = app.plugins.plugins.podnotes.api;
const transcript = await api.getTranscript();
```

### QuickAdd AI prompt example
PodNotes exposes the transcript text; the AI summarization is done by your
QuickAdd macro or whichever AI service/plugin your macro calls.

```js
module.exports = async (params) => {
	const podnotes = params.app.plugins.plugins.podnotes?.api;
	if (!podnotes) throw new Error("PodNotes is not enabled.");

	const transcript = await podnotes.transcript;
	if (!transcript) {
		throw new Error(
			"Generate a transcript for the current PodNotes episode first.",
		);
	}

	const prompt = `Summarize this podcast transcript in five bullet points.

Transcript:
${transcript}`;

	// Send `prompt` to the AI action/provider used by your QuickAdd macro.
	return prompt;
};
```

## `getPodcastTimeFormatted(format: string, linkify?: boolean, offsetSeconds?: number)`
This function will return the current playback time formatted according to the given (moment) format.
If `linkify` is true, the time will be linked to the current episode at the given time. This is used by PodNotes to play from the recorded time.
`offsetSeconds` is optional (default 0), subtracted from the current playback time before formatting/linking, floored at 0, and also applies to the linkified timestamp.

## `getPodcastSegmentFormatted(format: string, startTime: number, endTime: number, linkify?: boolean)`
This function returns a formatted `start-end` playback range.
If `linkify` is true, the range links to the current episode with both `time` and `endTime` parameters so PodNotes starts at `startTime` and pauses at `endTime`.

## `playbackRate`
Gets or sets the current player playback speed. Values are clamped to the player
range.

## Playback controls
`start()`, `stop()`, and `togglePlayback()` control the current episode.
`skipBackward()` and `skipForward()` use the skip lengths configured in PodNotes
settings.

`increasePlaybackRate()` and `decreasePlaybackRate()` adjust the current playback
speed in `0.1x` steps. `resetPlaybackRate()` returns playback to the default
playback rate configured in settings.
