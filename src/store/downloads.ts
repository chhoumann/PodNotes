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
		return get(store)[episode.podcastName]?.some(
			(e) => e.title === episode.title,
		);
	}

	return {
		subscribe,
		set,
		update,
		isEpisodeDownloaded,
		addEpisode: (episode: Episode, filePath: string, size: number) => {
			update(
				(downloadedEpisodes: {
					[podcastName: string]: DownloadedEpisode[];
				}) => {
					const podcastEpisodes = downloadedEpisodes[episode.podcastName] || [];

					const idx = podcastEpisodes.findIndex(
						(ep) => ep.title === episode.title,
					);
					if (idx !== -1) {
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
				},
			);
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
				const index = podcastEpisodes.findIndex(
					(e) => e.title === episode.title,
				);

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
			return get(store)[episode.podcastName]?.find(
				(e) => e.title === episode.title,
			);
		},
	};
})();
