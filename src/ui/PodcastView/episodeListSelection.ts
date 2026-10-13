import { newestFirst } from "src/persistence/dateCodec";
import type { FeedKey, FeedState } from "src/services/FeedRepository";
import type DownloadedEpisode from "src/types/DownloadedEpisode";
import type { Episode } from "src/types/Episode";
import type { PodcastFeed } from "src/types/PodcastFeed";
import { sanitizeEpisodeListLimit } from "src/utility/episodeListLimit";
import { getFinishedPlayedEpisodeRecords, type PlayedEpisodeMap } from "src/utility/episodeStatus";

/** The newest `limit` episodes of each subscription, merged newest first. */
export function selectLatestEpisodes(
	feeds: ReadonlyMap<FeedKey, FeedState>,
	limit: number,
): Episode[] {
	const perFeed = sanitizeEpisodeListLimit(limit);
	return [...feeds.values()]
		.flatMap(({ episodes }) => [...episodes].sort(newestFirst).slice(0, perFeed))
		.sort(newestFirst);
}

/** A feed's episodes, or its downloads while it has no document because loading failed. */
export function selectFeedEpisodes(
	feed: FeedState,
	downloads: Record<string, DownloadedEpisode[]>,
): readonly Episode[] {
	return feed.channel || !feed.error ? feed.episodes : (downloads[feed.feed.title] ?? []);
}

/** Subscriptions with a finished played episode, the ones the Played view needs in full. */
export function feedKeysWithPlayedEpisodes(
	feeds: Record<FeedKey, PodcastFeed>,
	played: PlayedEpisodeMap,
): FeedKey[] {
	const names = new Set(
		getFinishedPlayedEpisodeRecords(played).map(({ episode }) => episode.podcastName),
	);
	return Object.keys(feeds).filter((key) => names.has(feeds[key].title));
}
