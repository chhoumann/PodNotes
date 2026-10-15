export type EpisodeMediaType = "audio" | "video";

export interface Episode {
	title: string;
	streamUrl: string;
	url: string;
	description: string;
	content: string;
	podcastName: string;
	feedUrl?: string;
	/** The feed item's `<guid>`. It finds the episode within its feed for links and notes, and keys its progress. */
	guid?: string;
	/** Another item of its feed has its title, so a record saved under the title alone cannot be told apart for it. */
	sharedTitle?: true;
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
