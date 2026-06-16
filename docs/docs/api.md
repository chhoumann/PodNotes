# API
```js
export interface IAPI {
	readonly podcast: Episode;
	readonly isPlaying: boolean;
	readonly length: number;
	currentTime: number;
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
	start(): void;
	stop(): void;
	togglePlayback(): void;
	skipBackward(): void;
	skipForward(): void;
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

## `getPodcastTimeFormatted(format: string, linkify?: boolean)`
This function will return the current playback time formatted according to the given (moment) format.
If `linkify` is true, the time will be linked to the current episode at the given time. This is used by PodNotes to play from the recorded time.

## `getPodcastSegmentFormatted(format: string, startTime: number, endTime: number, linkify?: boolean)`
This function returns a formatted `start-end` playback range.
If `linkify` is true, the range links to the current episode with both `time` and `endTime` parameters so PodNotes starts at `startTime` and pauses at `endTime`.
