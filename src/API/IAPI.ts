import { Podcast } from 'src/types/podcast';

export interface IAPI {
	podcast: Podcast;
	isPlaying: boolean;
	length: number;
	currentTime: number;

	getPodcastTimeFormatted(format: string): string;
	start(): void;
	stop(): void;
	clearPodcast(): void;
}
