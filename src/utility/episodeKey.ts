import type { Episode } from "src/types/Episode";

/**
 * Generates a unique key for an episode.
 * Uses podcastName + title to avoid collisions between episodes with the same title
 * from different podcasts.
 *
 * Falls back to title-only for backwards compatibility with episodes that don't have podcastName.
 */
export function getEpisodeKey(episode: Episode | null | undefined): string {
	if (!episode || !episode.title) {
		return "";
	}
	if (episode.podcastName) {
		return `${episode.podcastName}::${episode.title}`;
	}
	// Fallback for legacy episodes without podcastName
	return episode.title;
}

/**
 * Checks if an episode matches a given key.
 * Handles both new composite keys and legacy title-only keys.
 */
export function episodeMatchesKey(episode: Episode | null | undefined, key: string): boolean {
	if (!episode || !key) {
		return false;
	}
	const compositeKey = getEpisodeKey(episode);
	if (compositeKey === key) {
		return true;
	}
	// Also check title-only for backwards compatibility
	return episode.title === key;
}

/**
 * Whether a STORED playlist/favorite entry refers to the same episode as
 * `current`. Matches on the composite key (podcastName::title) and, for LEGACY
 * entries saved before podcastName existed (the entry has no podcastName), by
 * title alone — but never matches a same-titled episode from a DIFFERENT podcast
 * (an entry that does carry a podcastName).
 *
 * episodeMatchesKey alone misses a legacy (title-only) entry when the current
 * episode's key is composite, so a legacy favorite/playlist entry looked absent
 * and got duplicated (or skipped on cleanup). This restores that legacy match
 * without reintroducing the cross-podcast title collision.
 */
export function isSameStoredEpisode(
	entry: Episode | null | undefined,
	current: Episode | null | undefined,
): boolean {
	if (!entry || !current) {
		return false;
	}
	if (episodeMatchesKey(entry, getEpisodeKey(current))) {
		return true;
	}
	return !entry.podcastName && !!current.title && entry.title === current.title;
}
