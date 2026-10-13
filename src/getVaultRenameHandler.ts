import { TFile, type EventRef, type TAbstractFile } from "obsidian";
import { get } from "svelte/store";
import type PodNotes from "./main";
import { downloadedEpisodes, favorites, playlists, queue } from "./store";
import { writePlayerSettings } from "./store/persistence";
import type DownloadedEpisode from "./types/DownloadedEpisode";
import type { Episode } from "./types/Episode";
import type { Playlist } from "./types/Playlist";
import { isLocalFile } from "./utility/isLocalFile";

/**
 * Keeps what PodNotes stores about a vault file in step with the vault when the file is
 * renamed or moved: downloads and Local Files, the queue, favorites, playlists, the current
 * episode and the loaded media. Only where the file is changes. Every episode keeps its
 * title, so its progress, its note and its identity across devices stay as they were. A
 * rename nothing refers to changes nothing, so it writes nothing.
 */
export default function getVaultRenameHandler(plugin: PodNotes): EventRef {
	// A renamed folder reports each file in it, so the renames of one task are followed
	// together. The map keeps the TFile, whose path is where the file ends up.
	let renamed: Map<string, TFile> | null = null;
	return plugin.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
		if (!(file instanceof TFile)) return;
		if (!renamed) {
			const batch = (renamed = new Map());
			queueMicrotask(() => {
				renamed = null;
				followRenames(plugin, batch);
			});
		}
		renamed.set(oldPath, file);
	});
}

function followRenames(plugin: PodNotes, renamed: Map<string, TFile>): void {
	const downloads = get(downloadedEpisodes);
	// A local snapshot without a path plays the file registered under its title (see selectSource).
	const registered = new Map<string, TFile>();
	for (const episode of downloads["local file"] ?? []) {
		const file = renamed.get(episode.filePath);
		if (file) registered.set(episode.title, file);
	}
	const fileOf = (episode: Episode): TFile | undefined => {
		const filePath = (episode as Partial<DownloadedEpisode>).filePath;
		if (filePath) return renamed.get(filePath);
		return isLocalFile(episode) ? registered.get(episode.title) : undefined;
	};
	const holdsFile = (list: Episode[]) => list.some((episode) => fileOf(episode));

	const queued = get(queue);
	const favorited = get(favorites);
	const lists = get(playlists);
	const current = plugin.settings.currentEpisode;
	const shown = get(plugin.player.state).episode;
	const inDownloads = Object.values(downloads).some(holdsFile);
	const inQueue = holdsFile(queued.episodes);
	const inFavorites = holdsFile(favorited.episodes);
	const inPlaylists = Object.values(lists).some((playlist) => holdsFile(playlist.episodes));
	const isCurrent = !!current && !!fileOf(current);
	const isShown = !!shown && !!fileOf(shown);
	if (!inDownloads && !inQueue && !inFavorites && !inPlaylists && !isCurrent && !isShown) return;

	const moved = <T extends Episode>(episode: T): T => {
		const file = fileOf(episode);
		if (!file) return episode;
		if (!isLocalFile(episode)) return { ...episode, filePath: file.path };
		return {
			...episode,
			filePath: file.path,
			url: plugin.app.fileManager.generateMarkdownLink(file, ""),
			streamUrl: plugin.app.vault.getResourcePath(file),
		};
	};
	const movedList = <T extends Episode>(list: T[]): T[] =>
		holdsFile(list) ? list.map(moved) : list;
	const movedPlaylist = (playlist: Playlist): Playlist =>
		holdsFile(playlist.episodes)
			? { ...playlist, episodes: playlist.episodes.map(moved) }
			: playlist;

	if (inDownloads) downloadedEpisodes.set(mapValues(downloads, movedList));
	if (inQueue) queue.set(movedPlaylist(queued));
	if (inFavorites) favorites.set(movedPlaylist(favorited));
	if (inPlaylists) playlists.set(mapValues(lists, movedPlaylist));
	if (isCurrent) writePlayerSettings(plugin, { currentEpisode: moved(current) });
	for (const [from, file] of renamed) plugin.player.relocate(from, file.path, moved);
}

function mapValues<T>(record: Record<string, T>, map: (value: T) => T): Record<string, T> {
	return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, map(value)]));
}
