import { Menu } from "obsidian";
import { currentEpisode, favorites, playedEpisodes, playlists, queue, viewState } from "src/store";
import { Episode } from "src/types/Episode";
import { ViewState } from "src/types/ViewState";
import { get } from "svelte/store";

interface DisabledMenuItems {
	play: boolean;
	markPlayed: boolean;
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
