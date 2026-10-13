import { TFile, type EventRef, type TAbstractFile } from "obsidian";
import { get } from "svelte/store";
import { showReplacedLocalFileNotice } from "./getContextMenuHandler";
import type PodNotes from "./main";
import { downloadedEpisodes, favorites, playedEpisodes, playlists, queue } from "./store";
import { writePlayerSettings } from "./store/persistence";
import type DownloadedEpisode from "./types/DownloadedEpisode";
import type { Episode } from "./types/Episode";
import type { Playlist } from "./types/Playlist";
import { getEpisodeKey } from "./utility/episodeKey";
import { getPlayedEpisodeKeys } from "./utility/episodeStatus";
import { isLocalFile } from "./utility/isLocalFile";
import { localEpisodeFromFile } from "./utility/localEpisodeFromFile";
import { getEpisodeMediaType } from "./utility/mediaType";

/**
 * Keeps what PodNotes stores about a vault file in step with the vault when the file is
 * renamed or moved: downloads and Local Files, the queue, favorites, playlists, progress,
 * the current episode and the loaded media. A local file becomes what Play with PodNotes
 * registers for it at its new path, new name included. A download keeps its episode and
 * takes the new path. A rename nothing refers to changes nothing, so it writes nothing.
 */
export default function getVaultRenameHandler(plugin: PodNotes): EventRef {
	return plugin.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
		// A renamed folder is also reported once for each file in it.
		if (file instanceof TFile) followRename(plugin, file, oldPath);
	});
}

function followRename(plugin: PodNotes, file: TFile, oldPath: string): void {
	// The local file's snapshots from before the rename. They share its old name.
	const localBefore: Episode[] = [];
	const moved = <T extends Episode>(episode: T): T => {
		if ((episode as Partial<DownloadedEpisode>).filePath !== oldPath) return episode;
		if (!isLocalFile(episode)) return { ...episode, filePath: file.path };
		localBefore.push(episode);
		return {
			...episode,
			...localEpisodeFromFile(plugin.app, file, getEpisodeMediaType(episode)),
		};
	};
	/**
	 * `list` with its entries moved, or `list` itself when none moved. Play with PodNotes
	 * keeps one local file per name, so a file renamed to a tracked file's name takes over
	 * the entries for that name, which go to `displaced`.
	 */
	const movedList = <T extends Episode>(list: T[], displaced: T[] = []): T[] => {
		const next = mapItems(list, moved);
		if (next === list) return list;
		const keys = new Set(
			next.filter((e, i) => e !== list[i] && isLocalFile(e)).map((e) => getEpisodeKey(e)),
		);
		return next.filter((episode, i) => {
			const taken = episode === list[i] && keys.has(getEpisodeKey(episode));
			if (taken) displaced.push(episode);
			return !taken;
		});
	};
	const movedPlaylist = (playlist: Playlist): Playlist => {
		const episodes = movedList(playlist.episodes);
		return episodes === playlist.episodes ? playlist : { ...playlist, episodes };
	};

	const downloads = get(downloadedEpisodes);
	const displaced: DownloadedEpisode[] = [];
	const nextDownloads = mapValues(downloads, (list) => movedList(list, displaced));
	if (nextDownloads !== downloads) downloadedEpisodes.set(nextDownloads);
	for (const { title, filePath } of displaced) {
		if (filePath !== file.path) showReplacedLocalFileNotice(title, filePath, file.path);
	}

	const queued = get(queue);
	const nextQueue = movedPlaylist(queued);
	if (nextQueue !== queued) queue.set(nextQueue);

	const favorited = get(favorites);
	const nextFavorites = movedPlaylist(favorited);
	if (nextFavorites !== favorited) favorites.set(nextFavorites);

	const lists = get(playlists);
	const nextLists = mapValues(lists, movedPlaylist);
	if (nextLists !== lists) playlists.set(nextLists);

	const current = plugin.settings.currentEpisode;
	const nextCurrent = current && moved(current);
	if (nextCurrent !== current) writePlayerSettings(plugin, { currentEpisode: nextCurrent });

	plugin.player.relocate(oldPath, file.path, moved);

	const [before] = localBefore;
	if (before && before.title !== file.basename) moveProgress(before, file.basename);
}

/** Moves the progress of `episode`, if it has any, to the key it has under `title`. */
function moveProgress(episode: Episode, title: string): void {
	const record = playedEpisodes.get(episode);
	if (!record) return;
	playedEpisodes.update((played) => {
		for (const key of getPlayedEpisodeKeys(played, episode)) delete played[key];
		played[getEpisodeKey({ ...episode, title })] = {
			...record,
			title,
			podcastName: episode.podcastName,
		};
		return played;
	});
}

/** `items` itself when `map` returns every item unchanged. */
function mapItems<T>(items: T[], map: (item: T) => T): T[] {
	const mapped = items.map(map);
	return mapped.some((item, i) => item !== items[i]) ? mapped : items;
}

/** `record` itself when `map` returns every value unchanged. */
function mapValues<T>(record: Record<string, T>, map: (value: T) => T): Record<string, T> {
	const entries = Object.entries(record);
	const mapped = entries.map(([key, value]) => [key, map(value)] as const);
	return mapped.some(([, value], i) => value !== entries[i][1])
		? Object.fromEntries(mapped)
		: record;
}
