import { Episode } from 'src/types/Episode';

export interface IAPI {
	readonly podcast: Episode;
	readonly isPlaying: boolean;
	readonly length: number;
	currentTime: number;

	getPodcastTimeFormatted(format: string, linkify?: boolean): string;
	start(): void;
	stop(): void;
}
