---
title: API
slug: api
description: Public API members, episode types, playback controls, transcript reads, and timestamp formatting.
legacyTitleId: api
---

```ts
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

The public API is available at `app.plugins.plugins.podnotes.api` when the plugin is enabled.
It reads and controls the current PodNotes player. [PodNotes URI parameters](/timestamps/#podnotes-uri) are documented separately.

## `podcast`
This returns the loaded episode, including when playback is paused.
Although `IAPI` declares `Episode`, the value can be `undefined` before an episode is loaded.

```ts
export type EpisodeMediaType = "audio" | "video";

export interface Episode {
	title: string;
	streamUrl: string;
	url: string;
	description: string;
	content: string;
	podcastName: string;
	feedUrl?: string;
	artworkUrl?: string;
	episodeDate?: Date;
	itunesTitle?: string;
	episodeNumber?: number;
	duration?: number;
	chaptersUrl?: string;
	mediaType?: EpisodeMediaType;
}
```

`streamUrl` is the media source. `url` identifies the episode's page, the feed URL when the item has no link, or a vault link for a local file.
`feedUrl` can contain a private-feed placeholder rather than a fetchable URL.
`duration` is the feed-provided duration in seconds, which can differ from the player's measured `length`.
Local episodes extend this type with `podcastName: "local file"`, empty `description` and `content`, and an optional `filePath`.

## `isPlaying`

Returns the inverse of PodNotes' paused state. It describes the requested player state rather than proof that media playback has started.

## `length`

Returns the player duration in seconds. The value starts at zero before media metadata loads.

## `currentTime`

Gets or sets the player position in seconds. Setting a position clears an active segment's end boundary.

## `volume`

Gets or sets the volume between `0` and `1`.
Finite writes are clamped to this range. Non-finite writes preserve the current volume.
Volume changes also update the saved **Default Volume** preference.

## `transcript`
This is a convenience getter for `getTranscript()`:

```js
const transcript = await app.plugins.plugins.podnotes.api.transcript;
```

It returns the generated transcript note for the current episode, or `null` if no
episode is loaded or no transcript file exists yet. It does not call a transcription provider or
create a new transcript. **Transcribe current episode** creates transcript notes.

If your transcript template includes metadata such as the title and date, that
metadata is included in the returned text. A **Transcript template** containing only
`{{transcript}}` produces a note containing only the transcript body.

## `getTranscript(episode?: Episode)`
This reads the generated transcript note for the provided episode. If no episode
is provided, it reads the current episode's transcript.
The path comes from **Transcript file path** rendered for that episode.
A missing episode or file returns `null`. File read errors reject the promise.

```js
const api = app.plugins.plugins.podnotes.api;
const transcript = await api.getTranscript();
```

### QuickAdd AI prompt example

This macro returns a prompt containing the saved transcript note.
A QuickAdd AI action or another workflow can consume that prompt.

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

	return prompt;
};
```

## `getPodcastTimeFormatted(format: string, linkify?: boolean, offsetSeconds?: number)`
Returns the current playback time using the [supported time tokens](/timestamps/#time-formats).
`linkify` defaults to `false`. With `true`, the result is a Markdown timestamp link when a feed URL or registered local file path is available.
Without a target, the result remains plain text.
`offsetSeconds` defaults to `0`. It is subtracted before formatting and linking, with a minimum result of zero.
The method throws `"No podcast loaded"` without a loaded episode.

## `getPodcastSegmentFormatted(format: string, startTime: number, endTime: number, linkify?: boolean)`
Returns a `start-end` range using the [supported time tokens](/timestamps/#time-formats).
Times are in seconds. `linkify` defaults to `false`.
With `true`, a valid range links to the episode through `time` and `endTime`, so playback pauses at the end.
Negative bounds are normalized to zero. The end must exceed the start after normalization, and both values must be finite.
An invalid range or missing link target returns plain text.
This method has no offset parameter and throws `"No podcast loaded"` without a loaded episode.

## `playbackRate`
Gets or sets the current player speed between `0.5` and `4`, rounded to tenths.
Non-finite writes fall back to **Default Playback Rate**.
Changing the current rate does not change that saved default.

## Playback controls
`start()`, `stop()`, and `togglePlayback()` control the current episode.
`stop()` pauses without resetting the position.
`skipBackward()` and `skipForward()` use **Skip backward length (s)** and **Skip forward length (s)**.
Invalid skip lengths fall back to 15 seconds. Backward skips stop at zero.
With a known duration, forward skips stop up to 0.25 seconds before the end without moving backward.

`increasePlaybackRate()` and `decreasePlaybackRate()` adjust the current playback
speed in `0.1x` steps. `resetPlaybackRate()` returns playback to the default
playback rate configured in settings.
