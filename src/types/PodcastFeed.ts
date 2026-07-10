export interface PodcastFeed {
	/** PodNotes' canonical stable identity. */
	feedId?: string;
	/** Direct-child Podcasting 2.0 channel GUID. Never used as feed identity alone. */
	guid?: string;
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
