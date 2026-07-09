import { Menu, Notice } from "obsidian";
import createPodcastNote, { getPodcastNote, openPodcastNote } from "src/createPodcastNote";
import createFeedNote, { getFeedNote, openFeedNote } from "src/createFeedNote";
import downloadEpisodeWithProgessNotice, { removeDownloadedEpisode } from "src/downloadEpisode";
import {
	currentEpisode,
	downloadedEpisodes,
	favorites,
	playedEpisodes,
	playlists,
	plugin,
	queue,
	savedFeeds,
	viewState,
} from "src/store";
import type { Episode } from "src/types/Episode";
import type { PodcastFeed } from "src/types/PodcastFeed";
import { ViewState } from "src/types/ViewState";
import { get } from "svelte/store";
import { isEpisodeFinished } from "src/utility/episodeStatus";
import { isSameStoredEpisode } from "src/utility/episodeKey";
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

/**
 * A screen position to open the menu at. Used when there is no MouseEvent to
 * anchor against (keyboard activation / mobile tap of the overflow button).
 */
export interface MenuPosition {
	x: number;
	y: number;
}

export default function spawnEpisodeContextMenu(
	episode: Episode,
	anchor: MouseEvent | MenuPosition,
	disabledMenuItems?: Partial<DisabledMenuItems>,
	playedEpisodeKey?: string,
) {
	const menu = new Menu();

	if (!disabledMenuItems?.play) {
		menu.addItem((item) =>
			item
				.setIcon("play")
				.setTitle("Play")
				.onClick(() => {
					currentEpisode.set(episode);
					viewState.set(ViewState.Player);
				}),
		);
	}

	if (!disabledMenuItems?.markPlayed) {
		const playedEpisodeMap = get(playedEpisodes);
		const episodeIsPlayed = playedEpisodeKey
			? (playedEpisodeMap[playedEpisodeKey]?.finished ??
				isEpisodeFinished(episode, playedEpisodeMap))
			: isEpisodeFinished(episode, playedEpisodeMap);
		menu.addItem((item) =>
			item
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
				}),
		);
	}

	if (!disabledMenuItems?.download) {
		const isDownloaded = downloadedEpisodes.isEpisodeDownloaded(episode);

		menu.addItem((item) =>
			item
				.setIcon(isDownloaded ? "cross" : "download")
				.setTitle(isDownloaded ? "Remove file" : "Download")
				.onClick(() => {
					if (isDownloaded) {
						void removeDownloadedEpisode(episode);
					} else {
						// The path template always yields a per-episode file via
						// safeDownloadBasename (#183), so no empty-path guard is needed —
						// this matches the Download command in main.ts. Settle the
						// promise so a failure can't surface as an unhandled rejection
						// (the in-notice error is the user-facing message), matching the
						// adjacent void removeDownloadedEpisode(...).
						void downloadEpisodeWithProgessNotice(
							episode,
							get(plugin).settings.download.path,
						).catch((e) => console.error("PodNotes: download failed", e));
					}
				}),
		);
	}

	if (!disabledMenuItems?.createNote) {
		const episodeNoteExists = Boolean(getPodcastNote(episode));

		menu.addItem((item) =>
			item
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
				}),
		);

		// Feed-level note for the episode's parent podcast (issue #163).
		const feed = resolveFeedForEpisode(episode);
		const feedNoteExists = Boolean(getFeedNote(feed));

		menu.addItem((item) =>
			item
				.setIcon("rss")
				.setTitle(`${feedNoteExists ? "Open" : "Create"} feed note`)
				.onClick(async () => {
					if (feedNoteExists) {
						openFeedNote(feed);
					} else {
						const { path, template } = get(plugin).settings.feedNote;
						if (!path || !template) {
							new Notice(
								`Please set a podcast feed note path and template in the settings.`,
							);
							return;
						}

						await createFeedNote(feed);
					}
				}),
		);
	}

	if (!disabledMenuItems?.favorite) {
		const episodeIsFavorite = get(favorites).episodes.find((e) =>
			isSameStoredEpisode(e, episode),
		);
		menu.addItem((item) =>
			item
				.setIcon("lucide-star")
				.setTitle(`${episodeIsFavorite ? "Remove from" : "Add to"} Favorites`)
				.onClick(() => {
					if (episodeIsFavorite) {
						favorites.update((playlist) => {
							playlist.episodes = playlist.episodes.filter(
								(e) => !isSameStoredEpisode(e, episode),
							);
							return playlist;
						});
					} else {
						favorites.update((playlist) => {
							const newEpisodes = [...playlist.episodes, episode];
							playlist.episodes = newEpisodes;

							return playlist;
						});
					}
				}),
		);
	}

	if (!disabledMenuItems?.queue) {
		// The queue identifies episodes by TITLE everywhere (queue.add dedupes and
		// queue.remove filters by title; see src/store/index.ts), so this membership
		// check and the reorder lookup below must match by title too. A composite-key
		// check would offer "Add to Queue" for a same-titled episode from another
		// podcast, but queue.add would then no-op (Codex review #214).
		const episodeIsInQueue = get(queue).episodes.find((e) => e.title === episode.title);
		menu.addItem((item) =>
			item
				.setIcon("list-ordered")
				.setTitle(`${episodeIsInQueue ? "Remove from" : "Add to"} Queue`)
				.onClick(() => {
					if (episodeIsInQueue) {
						queue.remove(episode);
					} else {
						queue.add(episode);
					}
				}),
		);

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
				menu.addItem((item) =>
					item
						.setIcon(reorderItem.icon)
						.setTitle(reorderItem.title)
						.onClick(() => {
							// Resolve the index live: the queue can shift (e.g. the
							// episode ends and playNext advances it) between opening
							// the menu and clicking.
							const index = get(queue).episodes.findIndex(
								(e) => e.title === episode.title,
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
						}),
				);
			}
		}
	}

	if (!disabledMenuItems?.playlists) {
		const playlistsInStore = get(playlists);
		const entries = Object.values(playlistsInStore);

		// Only emit the divider when there is at least one custom playlist to
		// render, mirroring the reorder section's guard — otherwise a stray
		// trailing separator is left at the bottom of the menu (CM-09).
		if (entries.length > 0) {
			menu.addSeparator();

			for (const playlist of entries) {
				const episodeIsInPlaylist = playlist.episodes.find((e) =>
					isSameStoredEpisode(e, episode),
				);

				menu.addItem((item) =>
					item
						.setIcon(playlist.icon)
						.setTitle(
							`${episodeIsInPlaylist ? "Remove from" : "Add to"} ${playlist.name}`,
						)
						.onClick(() => {
							if (episodeIsInPlaylist) {
								playlists.update((playlists) => {
									playlists[playlist.name].episodes = playlists[
										playlist.name
									].episodes.filter((e) => !isSameStoredEpisode(e, episode));

									return playlists;
								});
							} else {
								playlists.update((playlists) => {
									const newEpisodes = [
										...playlists[playlist.name].episodes,
										episode,
									];
									playlists[playlist.name].episodes = newEpisodes;

									return playlists;
								});
							}
						}),
				);
			}
		}
	}

	if (anchor instanceof MouseEvent) {
		menu.showAtMouseEvent(anchor);
	} else {
		menu.showAtPosition(anchor);
	}
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
