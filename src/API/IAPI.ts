import { Episode } from 'src/types/Episode';

export interface IAPI {
	podcast: Episode;
	isPlaying: boolean;
	length: number;
	currentTime: number;

	getPodcastTimeFormatted(format: string): string;
	start(): void;
	stop(): void;
	clearPodcast(): void;
}
