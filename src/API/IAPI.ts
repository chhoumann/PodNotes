import type { Episode } from 'src/types/Episode';

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
