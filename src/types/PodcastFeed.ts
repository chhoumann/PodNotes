export interface PodcastFeed {
	title: string;
	url: string;
	artworkUrl: string;
	collectionId?: string;
	/** Channel <description> / <itunes:summary>. May contain HTML. */
	description?: string;
	/** Channel <link> — the podcast's website/homepage (not the RSS url). */
	link?: string;
	/** <itunes:author> (falls back to <author> / <managingEditor>). */
	author?: string;
}
