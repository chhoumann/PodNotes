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
