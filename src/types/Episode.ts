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
	itunesTitle?: string;
	/** URL to the podcast:chapters JSON file */
	chaptersUrl?: string;
}
