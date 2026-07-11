export interface PodcastFeed {
	title: string;
	url: string;
	/**
	 * Set for private (credentialed) feeds: the SecretStorage ID holding the
	 * real feed URL. When set, `url` holds a non-fetchable placeholder (see
	 * src/utility/privateFeedUrl.ts) so the secret never enters data.json.
	 */
	urlSecretId?: string;
	artworkUrl: string;
	collectionId?: string;
	/** Channel <description> / <itunes:summary>. May contain HTML. */
	description?: string;
	/** Channel <link> — the podcast's website/homepage (not the RSS url). */
	link?: string;
	/** <itunes:author> (falls back to <author> / <managingEditor>). */
	author?: string;
}
