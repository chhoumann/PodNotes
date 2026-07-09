import { get, writable } from "svelte/store";
import type { Episode } from "src/types/Episode";
import type DownloadedEpisode from "src/types/DownloadedEpisode";

/**
 * The authoritative set of offline-available episodes, keyed by podcast name.
 * Both the download flow and manually added local files write here; the Local
 * Files playlist is a projection of this store (see `localFiles.syncWithDownloaded`).
 */
export const downloadedEpisodes = (() => {
	const store = writable<{ [podcastName: string]: DownloadedEpisode[] }>({});
	const { subscribe, update, set } = store;

	function isEpisodeDownloaded(episode: Episode): boolean {
		return get(store)[episode.podcastName]?.some((e) => e.title === episode.title);
	}

	return {
		subscribe,
		set,
		update,
		isEpisodeDownloaded,
		/**
		 * Adds or replaces a downloaded/local episode. Returns the file path that
		 * was REPLACED when a different file collapsed onto the same key (a basename
		 * collision), or `undefined` otherwise. The caller surfaces a Notice — this
		 * store stays pure (no UI/side effects), per the PR #211/#212 layering (#LF-06).
		 */
		addEpisode: (episode: Episode, filePath: string, size: number): string | undefined => {
			let replacedFilePath: string | undefined;

			update((downloadedEpisodes: { [podcastName: string]: DownloadedEpisode[] }) => {
				const podcastEpisodes = downloadedEpisodes[episode.podcastName] || [];

				const idx = podcastEpisodes.findIndex((ep) => ep.title === episode.title);
				if (idx !== -1) {
					// Entries are keyed by podcastName+title, so two distinct local
					// files that share a basename in different folders collapse onto
					// the same key and the second replaces the first. The key must stay
					// basename-only (URIHandler/{{episodelink}} resolve local files by
					// basename), so report the collision to the caller instead of
					// overwriting silently (#LF-06).
					const existingFilePath = podcastEpisodes[idx].filePath;
					if (existingFilePath && existingFilePath !== filePath) {
						replacedFilePath = existingFilePath;
					}
					podcastEpisodes[idx] = { ...episode, filePath, size };
				} else {
					podcastEpisodes.push({
						...episode,
						filePath,
						size,
					});
				}

				downloadedEpisodes[episode.podcastName] = podcastEpisodes;
				return downloadedEpisodes;
			});

			return replacedFilePath;
		},
		/**
		 * Drops an episode from the offline set and returns the vault path of the
		 * file it backed (or `undefined` if it wasn't tracked). Pure state only: the
		 * caller deletes the returned file (see `removeDownloadedEpisode`).
		 */
		removeEpisode: (episode: Episode): string | undefined => {
			let removedFilePath: string | undefined;

			update((downloadedEpisodes) => {
				const podcastEpisodes = downloadedEpisodes[episode.podcastName] || [];
				const index = podcastEpisodes.findIndex((e) => e.title === episode.title);

				// Guard against episode not found
				if (index === -1) {
					return downloadedEpisodes;
				}

				removedFilePath = podcastEpisodes[index].filePath;
				podcastEpisodes.splice(index, 1);

				downloadedEpisodes[episode.podcastName] = podcastEpisodes;
				return downloadedEpisodes;
			});

			return removedFilePath;
		},
		getEpisode: (episode: Episode) => {
			return get(store)[episode.podcastName]?.find((e) => e.title === episode.title);
		},
	};
})();
