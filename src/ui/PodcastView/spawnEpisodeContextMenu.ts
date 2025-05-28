import { Menu, Notice } from "obsidian";
import createPodcastNote, { getPodcastNote, openPodcastNote } from "src/createPodcastNote";
import downloadEpisodeWithProgessNotice from "src/downloadEpisode";
import { currentEpisode, downloadedEpisodes, favorites, playedEpisodes, playlists, plugin, queue, viewState } from "src/store";
import type { Episode } from "src/types/Episode";
import { ViewState } from "src/types/ViewState";
import { get } from "svelte/store";

interface DisabledMenuItems {
	play: boolean;
	markPlayed: boolean;
	download: boolean;
	createNote: boolean;
	favorite: boolean;
	queue: boolean;
	playlists: boolean;
}

// Cache episode lookups to avoid repeated searches
const episodeLookupCache = new Map<string, {
	isPlayed: boolean;
	isFavorite: boolean;
	isInQueue: boolean;
	playlists: Set<string>;
}>();

function getCacheKey(episode: Episode): string {
	return `${episode.title}-${episode.podcastName}`;
}

function getEpisodeCachedState(episode: Episode) {
	const cacheKey = getCacheKey(episode);
	let cached = episodeLookupCache.get(cacheKey);
	
	if (!cached) {
		const playedEps = get(playedEpisodes);
		const favs = get(favorites);
		const q = get(queue);
		const pls = get(playlists);
		
		cached = {
			isPlayed: Object.values(playedEps).some(e => e.title === episode.title && e.finished),
			isFavorite: favs.episodes.some(e => e.title === episode.title),
			isInQueue: q.episodes.some(e => e.title === episode.title),
			playlists: new Set(
				Object.entries(pls)
					.filter(([_, playlist]) => playlist.episodes.some(e => e.title === episode.title))
					.map(([name]) => name)
			)
		};
		
		episodeLookupCache.set(cacheKey, cached);
		
		// Clear cache after a short delay to handle rapid updates
		setTimeout(() => episodeLookupCache.delete(cacheKey), 5000);
	}
	
	return cached;
}

export default function spawnEpisodeContextMenu(
	episode: Episode,
	event: MouseEvent,
	disabledMenuItems?: Partial<DisabledMenuItems>
) {
	const menu = new Menu();
	const cachedState = getEpisodeCachedState(episode);

	if (!disabledMenuItems?.play) {
		menu.addItem(item => item
			.setIcon("play")
			.setTitle("Play")
			.onClick(() => {
				currentEpisode.set(episode);
				viewState.set(ViewState.Player);
			}));
	}

	if (!disabledMenuItems?.markPlayed) {
		menu.addItem(item => item
			.setIcon(cachedState.isPlayed ? "cross" : "check")
			.setTitle(`Mark as ${cachedState.isPlayed ? "Unplayed" : "Played"}`)
			.onClick(() => {
				episodeLookupCache.delete(getCacheKey(episode)); // Invalidate cache
				if (cachedState.isPlayed) {
					playedEpisodes.markAsUnplayed(episode);
				} else {
					playedEpisodes.markAsPlayed(episode);
				}
			})
		);
	}

	if (!disabledMenuItems?.download) {
		const isDownloaded = downloadedEpisodes.isEpisodeDownloaded(episode);

		menu.addItem(item => item
			.setIcon(isDownloaded ? "cross" : "download")
			.setTitle(isDownloaded ? "Remove file" : "Download")
			.onClick(() => {
				if (isDownloaded) {
					downloadedEpisodes.removeEpisode(episode, true);
				} else {
					const downloadPath = get(plugin).settings.download.path;
					if (!downloadPath) {
						new Notice(`Please set a download path in the settings.`);
						return;
					}

					downloadEpisodeWithProgessNotice(episode, downloadPath);
				}
			}));
	}

	if (!disabledMenuItems?.createNote) {
		const episodeNoteExists = Boolean(getPodcastNote(episode));

		menu.addItem(item => item
			.setIcon("pencil")
			.setTitle(`${episodeNoteExists ? "Open" : "Create"} Note`)
			.onClick(async () => {
				if (episodeNoteExists) {
					openPodcastNote(episode);
				} else {
					const { path, template } = get(plugin).settings.note;
					const canCreateNote = Boolean(path && template);

					if (!canCreateNote) {
						new Notice(`Please set a note path and template in the settings.`);
						return;
					}

					await createPodcastNote(episode);
				}
			}));
	}

	if (!disabledMenuItems?.favorite) {
		menu.addItem(item => item
			.setIcon("lucide-star")
			.setTitle(`${cachedState.isFavorite ? "Remove from" : "Add to"} Favorites`)
			.onClick(() => {
				episodeLookupCache.delete(getCacheKey(episode)); // Invalidate cache
				if (cachedState.isFavorite) {
					favorites.update(playlist => {
						playlist.episodes = playlist.episodes.filter(e => e.title !== episode.title);
						return playlist;
					});
				} else {
					favorites.update(playlist => {
						const newEpisodes = [...playlist.episodes, episode];
						playlist.episodes = newEpisodes;

						return playlist;
					});
				}
			}));
	}

	if (!disabledMenuItems?.queue) {
		menu.addItem(item => item
			.setIcon("list-ordered")
			.setTitle(`${cachedState.isInQueue ? "Remove from" : "Add to"} Queue`)
			.onClick(() => {
				episodeLookupCache.delete(getCacheKey(episode)); // Invalidate cache
				if (cachedState.isInQueue) {
					queue.update(playlist => {
						playlist.episodes = playlist.episodes.filter(e => e.title !== episode.title);

						return playlist;
					});
				} else {
					queue.update(playlist => {
						const newEpisodes = [...playlist.episodes, episode];
						playlist.episodes = newEpisodes;

						return playlist;
					});
				}
			}));
	}

	if (!disabledMenuItems?.playlists) {
		menu.addSeparator();

		const playlistsInStore = get(playlists);
		for (const playlist of Object.values(playlistsInStore)) {
			const episodeIsInPlaylist = cachedState.playlists.has(playlist.name);

			menu.addItem(item => item
				.setIcon(playlist.icon)
				.setTitle(`${episodeIsInPlaylist ? "Remove from" : "Add to"} ${playlist.name}`)
				.onClick(() => {
					episodeLookupCache.delete(getCacheKey(episode)); // Invalidate cache
					if (episodeIsInPlaylist) {
						playlists.update(playlists => {
							playlists[playlist.name].episodes = playlists[playlist.name].episodes.filter(e => e.title !== episode.title);

							return playlists;
						});
					} else {
						playlists.update(playlists => {
							const newEpisodes = [...playlists[playlist.name].episodes, episode];
							playlists[playlist.name].episodes = newEpisodes;

							return playlists;
						});
					}
				}));
		}
	}

	menu.showAtMouseEvent(event);

}