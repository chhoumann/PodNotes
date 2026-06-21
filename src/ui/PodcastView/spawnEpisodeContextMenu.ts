import { Menu, Notice } from "obsidian";
import createPodcastNote, { getPodcastNote, openPodcastNote } from "src/createPodcastNote";
import createFeedNote, { getFeedNote, openFeedNote } from "src/createFeedNote";
import downloadEpisodeWithProgessNotice, {
	deleteEpisodeFile,
} from "src/downloadEpisode";
import { currentEpisode, downloadedEpisodes, favorites, playedEpisodes, playlists, plugin, queue, savedFeeds, viewState } from "src/store";
import type { Episode } from "src/types/Episode";
import type { PodcastFeed } from "src/types/PodcastFeed";
import { ViewState } from "src/types/ViewState";
import { get } from "svelte/store";
import { isEpisodeFinished } from "src/utility/episodeStatus";
import { buildQueueReorderMenuItems } from "./queueReorderMenu";

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
	disabledMenuItems?: Partial<DisabledMenuItems>,
	playedEpisodeKey?: string,
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
		const playedEpisodeMap = get(playedEpisodes);
		const episodeIsPlayed = playedEpisodeKey
			? playedEpisodeMap[playedEpisodeKey]?.finished ?? isEpisodeFinished(episode, playedEpisodeMap)
			: isEpisodeFinished(episode, playedEpisodeMap);
		menu.addItem(item => item
			.setIcon(episodeIsPlayed ? "x" : "check")
			.setTitle(`Mark as ${episodeIsPlayed ? "Unplayed" : "Played"}`)
			.onClick(() => {
				if (episodeIsPlayed) {
					if (playedEpisodeKey) {
						playedEpisodes.markKeyAsUnplayed(playedEpisodeKey);
					} else {
						playedEpisodes.markAsUnplayed(episode);
					}
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
					const removedFilePath = downloadedEpisodes.removeEpisode(episode);
					if (removedFilePath) {
						void deleteEpisodeFile(removedFilePath);
					}
				} else {
					// The path template always yields a per-episode file via
					// safeDownloadBasename (#183), so no empty-path guard is needed —
					// this matches the Download command in main.ts.
					downloadEpisodeWithProgessNotice(
						episode,
						get(plugin).settings.download.path,
					);
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

		// Feed-level note for the episode's parent podcast (issue #163).
		const feed = resolveFeedForEpisode(episode);
		const feedNoteExists = Boolean(getFeedNote(feed));

		menu.addItem(item => item
			.setIcon("rss")
			.setTitle(`${feedNoteExists ? "Open" : "Create"} feed note`)
			.onClick(async () => {
				if (feedNoteExists) {
					openFeedNote(feed);
				} else {
					const { path, template } = get(plugin).settings.feedNote;
					if (!path || !template) {
						new Notice(`Please set a podcast feed note path and template in the settings.`);
						return;
					}

					await createFeedNote(feed);
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
					queue.remove(episode);
				} else {
					queue.add(episode);
				}
			}));

		// Reorder controls — only meaningful when viewing the queue as an ordered
		// list in the Player. spawnEpisodeContextMenu is shared with the feed,
		// playlist and Latest lists, so gate on the active view state.
		const reorderItems = buildQueueReorderMenuItems(
			get(viewState),
			get(queue).episodes,
			episode,
		);

		if (reorderItems.length > 0) {
			menu.addSeparator();

			for (const reorderItem of reorderItems) {
				menu.addItem(item => item
					.setIcon(reorderItem.icon)
					.setTitle(reorderItem.title)
					.onClick(() => {
						// Resolve the index live: the queue can shift (e.g. the
						// episode ends and playNext advances it) between opening
						// the menu and clicking.
						const index = get(queue).episodes.findIndex(
							e => e.title === episode.title,
						);
						if (index === -1) return;

						switch (reorderItem.kind) {
							case "top":
								queue.moveToTop(index);
								break;
							case "up":
								queue.moveUp(index);
								break;
							case "down":
								queue.moveDown(index);
								break;
							case "bottom":
								queue.moveToBottom(index);
								break;
						}
					}));
			}
		}
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

/**
 * Resolve the parent feed for an episode. Prefers the saved feed (keyed by the
 * raw podcast name, matching episode.podcastName) so its artwork/url/metadata are
 * used; otherwise synthesizes a minimal feed from the episode (e.g. local files
 * or history). createFeedNote enriches missing metadata via the feed URL.
 */
function resolveFeedForEpisode(episode: Episode): PodcastFeed {
	const saved = get(savedFeeds)[episode.podcastName];
	if (saved) return saved;

	return {
		title: episode.podcastName,
		url: episode.feedUrl ?? "",
		artworkUrl: episode.artworkUrl ?? "",
	};
}
