---
title: API
slug: api
description: Read and control the PodNotes player from QuickAdd scripts, Templater, or the console, and read transcripts and timestamps.
legacyTitleId: api
---

Read and control the PodNotes player from your own scripts through `app.plugins.plugins.podnotes.api`.
It works wherever a script can reach Obsidian's `app`, such as a QuickAdd script, a Templater template, or the developer console.
The API exists while PodNotes is enabled, and it works while the PodNotes view is closed. For links that open PodNotes, see [PodNotes URI](/timestamps/#podnotes-uri).

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

The loaded episode, also while it is paused. After Obsidian starts, it is the episode that PodNotes restored, before you play it.
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
	guid?: string;
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
- `feedUrl` holds the placeholder of a private feed that you added and that PodNotes recognizes, instead of a URL you can fetch. For an episode of a private feed you have not added, opened from a link, it holds the private address.
- `guid` is the episode's ID in its feed, from `<guid>`. Links and notes use it to find the episode after the podcast renames it. It is missing when the feed gives no ID, or gives the same ID to several episodes.
- `duration` is the length in seconds that the feed reports. It can differ from the player's measured `length`.
- A local file has `podcastName: "local file"`, an empty `description` and `content`, and an optional `filePath`.

## `isPlaying`

`true` while the episode plays, and while its media loads to play.
`false` when the episode is paused, has ended, or failed to load, and for the episode PodNotes restores when Obsidian starts, until you play it.

## `length`

The duration of the loaded episode in seconds. Before the media loads, it is the duration PodNotes saved for the episode, or else the duration the feed gives, or else `0`.

## `currentTime`

Gets or sets the playback position in seconds. Before the media loads, it is the position where playback starts, such as the saved position of the episode PodNotes restored.
Setting it cancels the end of an active segment, so playback no longer pauses there.
PodNotes ignores a value that is negative or not a finite number. Once the media loads, a position at or past the end moves to 0.25 seconds before the end, and playback pauses.

## `volume`

Gets or sets the volume, from `0` to `1`.
PodNotes clamps finite values to that range and ignores values that are not finite.
PodNotes uses one volume for every episode, the one the full player's volume button sets, and keeps it when Obsidian restarts.

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
PodNotes finds the note at the **Transcript path** rendered for that episode.
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

- `linkify` defaults to `false`. With `true`, the result is a Markdown link that opens PodNotes at that time, with the episode's `guid` when it has one. The result stays plain text when the episode has no feed or local file to link to, or when a link would show a private feed's address, as for an episode of a private feed that you have not added.
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
- An invalid range returns plain text. So do the cases in which `getPodcastTimeFormatted()` returns plain text.

There is no offset parameter. Throws `"No podcast loaded"` when no episode is loaded.

## `playbackRate`

Gets or sets the current playback speed, from `0.5` to `4`, rounded to hundredths, so `1.25` stays `1.25`.
A value that is not finite sets the speed to **Default speed**.
Setting the speed does not change **Default speed**. The speed lasts until a different episode loads, which starts at **Default speed**.

## Playback controls

- `start()` plays the current episode from where it is. After Obsidian starts, it plays the restored episode from its saved position, and a finished episode starts over, unless you moved its position after it finished.
- `stop()` pauses the current episode and saves its position.
- `togglePlayback()` switches between playing and paused.
- `skipBackward()` and `skipForward()` move by **Skip back (s)** and **Skip forward (s)**. An invalid length falls back to 15 seconds.
- A backward skip stops at the start. A skip keeps the episode playing or paused. When the duration is known, a forward skip that would reach the last 0.25 seconds stops 0.25 seconds before the end, or stays where it is when the position is already closer to the end. A playing episode then ends, and the next episode in the queue starts if **Queue episodes I switch away from** is on.
- `increasePlaybackRate()` and `decreasePlaybackRate()` change the current speed by `0.1`, within `0.5` to `4`.
- `resetPlaybackRate()` sets the current speed to **Default speed**.
