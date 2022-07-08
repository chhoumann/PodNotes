# API
```js
export interface IAPI {
	readonly podcast: Episode;
	readonly isPlaying: boolean;
	readonly length: number;
	currentTime: number;

	getPodcastTimeFormatted(format: string, linkify?: boolean): string;
	start(): void;
	stop(): void;
}
```

The above functions are all accessible through `app.plugins.plugins.podnotes.api`.

## `getPodcastTimeFormatted(format: string, linkify?: boolean)`
This function will return the current playback time formatted according to the given (moment) format.
If `linkify` is true, the time will be linked to the current episode at the given time. This is used by PodNotes to play from the recorded time.
