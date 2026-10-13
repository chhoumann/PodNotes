import { newestFirst } from "src/persistence/dateCodec";
import type { FeedKey, FeedState } from "src/services/FeedRepository";
import type DownloadedEpisode from "src/types/DownloadedEpisode";
import type { Episode } from "src/types/Episode";
import type { Playlist } from "src/types/Playlist";
import type { PodcastFeed } from "src/types/PodcastFeed";
import {
	buildPlayedEpisodeListEntries,
	createEpisodeListEntries,
	type EpisodeListEntry,
} from "src/utility/episodeListEntry";
import { sanitizeEpisodeListLimit } from "src/utility/episodeListLimit";
import { getFinishedPlayedEpisodeRecords, type PlayedEpisodeMap } from "src/utility/episodeStatus";
import { ownRecord } from "src/utility/ownRecord";
import { availabilityOf, type Downloads } from "./episodeRow";
import type { ListPage } from "./pages";

/** A row of a list. A Played row names the record it shows, which can be under a legacy key. */
export type ListEntry = EpisodeListEntry & { readonly playedEpisodeKey?: string };

export interface ListSnapshot {
	readonly feeds: ReadonlyMap<FeedKey, FeedState>;
	readonly limit: number;
	readonly played: PlayedEpisodeMap;
	readonly downloads: Record<string, DownloadedEpisode[]>;
	readonly queue: Playlist;
	readonly favorites: Playlist;
	readonly localFiles: Playlist;
	readonly playlists: Record<string, Playlist>;
}

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

/**
 * A list page's rows: Latest newest first, Played as its records resolve against
 * every episode the library holds, a playlist and Local files as stored.
 */
export function selectListEntries(page: ListPage, library: ListSnapshot): ListEntry[] {
	const { feeds, limit, played, downloads, queue, favorites, localFiles, playlists } = library;
	if (page.kind === "latest") return createEpisodeListEntries(selectLatestEpisodes(feeds, limit));
	if (page.kind === "local") return createEpisodeListEntries(localFiles.episodes);
	if (page.kind === "playlist") {
		const list = page.name === favorites.name ? favorites : ownRecord(playlists)[page.name];
		return createEpisodeListEntries(list?.episodes ?? []);
	}
	return buildPlayedEpisodeListEntries(played, [
		...Array.from(feeds.values(), ({ episodes }) => episodes),
		...Object.values(downloads),
		queue.episodes,
		favorites.episodes,
		localFiles.episodes,
		...Object.values(playlists).map(({ episodes }) => episodes),
	]);
}

/** The entries whose rows play offline, then the rest, each in the order given. */
export function splitOffline<T extends EpisodeListEntry>(
	entries: readonly T[],
	downloads: Downloads,
): { readonly offline: T[]; readonly online: T[] } {
	const offline: T[] = [];
	const online: T[] = [];
	for (const entry of entries) {
		const plays =
			availabilityOf(entry.episode, entry.isAvailable, false, downloads) === "available";
		(plays ? offline : online).push(entry);
	}
	return { offline, online };
}
