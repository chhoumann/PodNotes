
export interface PodcastFeed {
	title: string;
	url: string;
	artworkUrl: string;
}


export type PodcastFeeds = Map<string, PodcastFeed>;
