import type { Episode } from "src/types/Episode";
import type { PodcastFeed } from "src/types/PodcastFeed";

import FeedDocumentParser, {
	type ParsedEpisodeDocument,
	type ParsedFeedDocument,
} from "./feedDocumentParser";
import { legacyObsidianFeedDocumentSource, type FeedDocumentSource } from "./feedDocumentSource";

const defaultDocumentParser = new FeedDocumentParser();

function projectLegacyFeed(parsed: ParsedFeedDocument): PodcastFeed {
	return {
		title: parsed.title,
		url: parsed.subscriptionUrl,
		artworkUrl: parsed.artworkUrl ?? "",
		...(parsed.siteUrl ? { link: parsed.siteUrl } : {}),
		...(parsed.description ? { description: parsed.description } : {}),
		...(parsed.author ? { author: parsed.author } : {}),
	};
}

function projectLegacyEpisode(parsed: ParsedEpisodeDocument, feed: PodcastFeed): Episode {
	return {
		title: parsed.title,
		streamUrl: parsed.streamUrl,
		url: parsed.itemLink || feed.url,
		description: parsed.description,
		content: parsed.content,
		podcastName: feed.title,
		artworkUrl: parsed.artworkUrl || feed.artworkUrl,
		episodeDate: parsed.episodeDate,
		feedUrl: feed.url,
		itunesTitle: parsed.itunesTitle || "",
		episodeNumber: parsed.episodeNumber,
		duration: parsed.duration,
		chaptersUrl: parsed.chaptersUrl,
		mediaType: parsed.mediaType,
	};
}

/**
 * Compatibility facade for the existing target-shaped runtime.
 * Retrieval stays injected so transport policy can evolve independently from
 * pure feed parsing.
 * Legacy target fallbacks live only here and never erase parser provenance.
 */
export default class FeedParser {
	private feed: PodcastFeed | undefined;

	constructor(
		feed?: PodcastFeed,
		private readonly source: FeedDocumentSource = legacyObsidianFeedDocumentSource,
	) {
		if (typeof source?.load !== "function") {
			throw new TypeError("A feed document source is required.");
		}
		this.feed = feed;
	}

	async getEpisodes(sourceUrl: string): Promise<Episode[]> {
		const xml = await this.source.load(sourceUrl);
		const existingFeed = this.feed;
		// A private feed's sourceUrl is its RESOLVED secret while feed.url holds
		// the placeholder, so the URLs never match. The caller resolved sourceUrl
		// from this very feed, so the pairing holds - and projecting against the
		// saved feed keeps the placeholder (never the secret) on every episode's
		// url/feedUrl, which flow into the persisted episode cache.
		if (existingFeed && (existingFeed.url === sourceUrl || existingFeed.urlSecretId)) {
			return defaultDocumentParser
				.parseEpisodeItems(xml)
				.map((episode) => projectLegacyEpisode(episode, existingFeed));
		}
		const parsed = defaultDocumentParser.parseEpisodes(xml, sourceUrl);
		const feed = projectLegacyFeed(parsed.feed);
		this.feed = feed;
		return parsed.episodes.map((episode) => projectLegacyEpisode(episode, feed));
	}

	async getFeed(sourceUrl: string): Promise<PodcastFeed> {
		const xml = await this.source.load(sourceUrl);
		this.feed = projectLegacyFeed(defaultDocumentParser.parseFeed(xml, sourceUrl));
		return this.feed;
	}
}
