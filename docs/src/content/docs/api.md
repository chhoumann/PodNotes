---
title: API
slug: api
description: Read and control the PodNotes player from QuickAdd scripts, Templater, or the console, and read transcripts and timestamps.
legacyTitleId: api
---

Read and control the PodNotes player from your own scripts through `app.plugins.plugins.podnotes.api`.
It works wherever a script can reach Obsidian's `app`, such as a QuickAdd script, a Templater template, or the developer console.
The API exists while PodNotes is enabled. For links that open PodNotes, see [PodNotes URI](/timestamps/#podnotes-uri).

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

## `podcast`

The loaded episode, also while it is paused.
`IAPI` declares `Episode`, but the value is `undefined` until an episode is loaded.

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

- `streamUrl` is the media source.
- `url` is the episode's web page. It is the feed URL when the episode has no link, and a vault link for a local file.
- `feedUrl` can hold a private-feed placeholder instead of a URL you can fetch.
- `duration` is the length in seconds that the feed reports. It can differ from the player's measured `length`.
- A local file has `podcastName: "local file"`, an empty `description` and `content`, and an optional `filePath`.

## `isPlaying`

`true` when PodNotes is not paused.
It reports the state PodNotes asked for, so it can be `true` before the media starts playing.

## `length`

The duration of the loaded media in seconds. It is `0` until the media's metadata loads.

## `currentTime`

Gets or sets the playback position in seconds.
Setting it cancels the end of an active segment, so playback no longer pauses there.

## `volume`

Gets or sets the volume, from `0` to `1`.
PodNotes clamps finite values to that range and ignores values that are not finite.
Setting the volume also changes the saved **Default Volume** setting.

## `transcript`

A shortcut for `getTranscript()` with no argument:

```js
const transcript = await app.plugins.plugins.podnotes.api.transcript;
```

It resolves to the text of the current episode's transcript note.
It resolves to `null` when no episode is loaded or the episode has no transcript note yet.
It never calls a transcription provider. Run **PodNotes: Transcribe current episode** to create the note.

The text is the whole note.
If your **Transcript template** adds a title and date, the text includes them. A template of only `{{transcript}}` returns only the transcript.

## <span id="gettranscriptepisode-episode"></span>`getTranscript()`

```ts
getTranscript(episode?: Episode): Promise<string | null>
```

Reads the transcript note of `episode`, or of the current episode when you omit it.
PodNotes finds the note at the **Transcript file path** rendered for that episode.
It resolves to `null` when there is no episode or no note, and rejects when the note cannot be read.

```js
const api = app.plugins.plugins.podnotes.api;
const transcript = await api.getTranscript();
```

### QuickAdd AI prompt example

[Send a transcript to an AI prompt](/QuickAdd/#send-a-transcript-to-an-ai-prompt) has a QuickAdd user script that returns a prompt with the current episode's transcript.

## <span id="getpodcasttimeformattedformat-string-linkify-boolean-offsetseconds-number"></span>`getPodcastTimeFormatted()`

```ts
getPodcastTimeFormatted(format: string, linkify?: boolean, offsetSeconds?: number): string
```

Returns the current playback time, formatted with the [time tokens](/timestamps/#time-formats). `api.getPodcastTimeFormatted("HH:mm:ss", true)` returns a link such as `[00:12:41](obsidian://podnotes?...)`.

- `linkify` defaults to `false`. With `true`, the result is a Markdown link that opens PodNotes at that time. Without a feed URL or a local file path to link to, the result stays plain text.
- `offsetSeconds` defaults to `0`. PodNotes subtracts it before formatting and linking, and never goes below zero.

Throws `"No podcast loaded"` when no episode is loaded.

## <span id="getpodcastsegmentformattedformat-string-starttime-number-endtime-number-linkify-boolean"></span>`getPodcastSegmentFormatted()`

```ts
getPodcastSegmentFormatted(
	format: string,
	startTime: number,
	endTime: number,
	linkify?: boolean,
): string
```

Returns a `start-end` range, formatted with the [time tokens](/timestamps/#time-formats).

- `startTime` and `endTime` are in seconds. Both must be finite. PodNotes raises negative values to zero, and the end must be after the start.
- `linkify` defaults to `false`. With `true`, a valid range becomes a link with `time` and `endTime`, so playback pauses at the end.
- An invalid range, or an episode with nothing to link to, returns plain text.

There is no offset parameter. Throws `"No podcast loaded"` when no episode is loaded.

## `playbackRate`

Gets or sets the current playback speed, from `0.5` to `4`, rounded to tenths.
A value that is not finite sets the speed to **Default Playback Rate**.
Setting the speed does not change **Default Playback Rate**.

## Playback controls

- `start()` and `stop()` play and pause the current episode. `stop()` keeps the position.
- `togglePlayback()` switches between playing and paused.
- `skipBackward()` and `skipForward()` move by **Skip backward length (s)** and **Skip forward length (s)**. An invalid length falls back to 15 seconds.
- A backward skip stops at the start. When the duration is known, a forward skip stops 0.25 seconds before the end, and never moves backward.
- `increasePlaybackRate()` and `decreasePlaybackRate()` change the current speed by `0.1`, within `0.5` to `4`.
- `resetPlaybackRate()` sets the current speed to **Default Playback Rate**.
