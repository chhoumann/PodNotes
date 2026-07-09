import type { Episode } from "src/types/Episode";

export interface IAPI {
	readonly podcast: Episode;
	readonly transcript: Promise<string | null>;
	readonly isPlaying: boolean;
	readonly length: number;
	currentTime: number;
	playbackRate: number;
	volume: number;

	getPodcastTimeFormatted(format: string, linkify?: boolean, offsetSeconds?: number): string;

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
