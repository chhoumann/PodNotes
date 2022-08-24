import { Menu, Notice } from "obsidian";
import createPodcastNote, { getPodcastNote, openPodcastNote } from "src/createPodcastNote";
import downloadEpisodeWithProgessNotice from "src/downloadEpisode";
import { currentEpisode, downloadedEpisodes, favorites, playedEpisodes, playlists, plugin, queue, viewState } from "src/store";
import { Episode } from "src/types/Episode";
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

export default function spawnEpisodeContextMenu(
	episode: Episode,
	event: MouseEvent,
	disabledMenuItems?: Partial<DisabledMenuItems>
) {
	const menu = new Menu();

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
		const episodeIsPlayed = Object.values(get(playedEpisodes)).find(e => (e.title === episode.title && e.finished));
		menu.addItem(item => item
			.setIcon(episodeIsPlayed ? "cross" : "check")
			.setTitle(`Mark as ${episodeIsPlayed ? "Unplayed" : "Played"}`)
			.onClick(() => {
				if (episodeIsPlayed) {
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
		const episodeIsFavorite = get(favorites).episodes.find(e => e.title === episode.title);
		menu.addItem(item => item
			.setIcon("lucide-star")
			.setTitle(`${episodeIsFavorite ? "Remove from" : "Add to"} Favorites`)
			.onClick(() => {
				if (episodeIsFavorite) {
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
		const episodeIsInQueue = get(queue).episodes.find(e => e.title === episode.title);
		menu.addItem(item => item
			.setIcon("list-ordered")
			.setTitle(`${episodeIsInQueue ? "Remove from" : "Add to"} Queue`)
			.onClick(() => {
				if (episodeIsInQueue) {
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
			const episodeIsInPlaylist = playlist.episodes.find(e => e.title === episode.title);

			menu.addItem(item => item
				.setIcon(playlist.icon)
				.setTitle(`${episodeIsInPlaylist ? "Remove from" : "Add to"} ${playlist.name}`)
				.onClick(() => {
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
