export type EpisodeMediaType = "audio" | "video";

export interface Episode {
	title: string;
	streamUrl: string;
	url: string;
	description: string;
	content: string;
	podcastName: string;
	feedUrl?: string;
	artworkUrl?: string;
	episodeDate?: Date;
	itunesTitle?: string;
	/**
	 * Episode number. Sourced from `<itunes:episode>` where present, otherwise a
	 * best-effort parse of the title. Undefined when neither yields a number.
	 */
	episodeNumber?: number;
	/** Episode duration in whole seconds, from `<itunes:duration>` where present. */
	duration?: number;
	/** URL to the podcast:chapters JSON file */
	chaptersUrl?: string;
	/** Media element type used to play the enclosure/local file. */
	mediaType?: EpisodeMediaType;
}
