import { get, writable } from "svelte/store";
import { TFile } from "obsidian";
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
		removeEpisode: (episode: Episode, removeFile: boolean) => {
			update((downloadedEpisodes) => {
				const podcastEpisodes = downloadedEpisodes[episode.podcastName] || [];
				const index = podcastEpisodes.findIndex(
					(e) => e.title === episode.title,
				);

				// Guard against episode not found
				if (index === -1) {
					return downloadedEpisodes;
				}

				const filePath = podcastEpisodes[index].filePath;
				podcastEpisodes.splice(index, 1);

				if (removeFile && filePath) {
					try {
						// @ts-ignore: app is not defined in the global scope anymore, but is still
						// available. Need to fix this later
						const file = app.vault.getAbstractFileByPath(filePath);

						if (file instanceof TFile) {
							// @ts-ignore
							app.vault.delete(file);
						}
					} catch (error) {
						console.error(error);
					}
				}

				downloadedEpisodes[episode.podcastName] = podcastEpisodes;
				return downloadedEpisodes;
			});
		},
		getEpisode: (episode: Episode) => {
			return get(store)[episode.podcastName]?.find(
				(e) => e.title === episode.title,
			);
		},
	};
})();
