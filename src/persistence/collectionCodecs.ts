import type DownloadedEpisode from "src/types/DownloadedEpisode";
import type { Playlist } from "src/types/Playlist";
import type { PodcastFeed } from "src/types/PodcastFeed";
import type { PodNote } from "src/types/PodNotes";
import type { PlayedEpisode } from "src/types/PlayedEpisode";
import {
	copySafeObject,
	isPlainObject,
	readBoolean,
	readNonNegativeNumber,
	readString,
	safeEntries,
	setOptionalString,
	warn,
} from "./codecUtils";
import { decodeEpisode, decodePlaylist } from "./episodeCodec";

export function decodeSavedFeeds(
	value: unknown,
	warnings: Set<string>,
): Record<string, PodcastFeed> {
	if (!isPlainObject(value)) {
		if (value !== undefined) warn(warnings, "savedFeeds", "expected an object");
		return {};
	}

	const feeds: Record<string, PodcastFeed> = {};
	for (const [key, candidate] of safeEntries(value, warnings, "savedFeeds")) {
		if (!isPlainObject(candidate)) {
			warn(warnings, `savedFeeds.${key}`, "expected an object; feed was skipped");
			continue;
		}

		const feed = copySafeObject(candidate);
		feed.title = readString(candidate, "title", key, warnings, `savedFeeds.${key}`);
		feed.url = readString(candidate, "url", "", warnings, `savedFeeds.${key}`);
		feed.artworkUrl = readString(candidate, "artworkUrl", "", warnings, `savedFeeds.${key}`);
		setOptionalString(feed, candidate, "description", warnings, `savedFeeds.${key}`);
		setOptionalString(feed, candidate, "link", warnings, `savedFeeds.${key}`);
		setOptionalString(feed, candidate, "author", warnings, `savedFeeds.${key}`);
		if (typeof candidate.collectionId === "number" && Number.isFinite(candidate.collectionId)) {
			feed.collectionId = String(candidate.collectionId);
			warn(warnings, `savedFeeds.${key}.collectionId`, "number was converted to text");
		} else {
			setOptionalString(feed, candidate, "collectionId", warnings, `savedFeeds.${key}`);
		}
		feeds[key] = feed as unknown as PodcastFeed;
	}
	return feeds;
}

export function decodePodNotes(value: unknown, warnings: Set<string>): Record<string, PodNote> {
	if (!isPlainObject(value)) {
		if (value !== undefined) warn(warnings, "podNotes", "expected an object");
		return {};
	}

	const notes: Record<string, PodNote> = {};
	for (const [key, candidate] of safeEntries(value, warnings, "podNotes")) {
		if (!isPlainObject(candidate)) {
			warn(warnings, `podNotes.${key}`, "expected an object; note mapping was skipped");
			continue;
		}
		notes[key] = {
			...copySafeObject(candidate),
			episodeName: readString(candidate, "episodeName", key, warnings, `podNotes.${key}`),
			filePath: readString(candidate, "filePath", "", warnings, `podNotes.${key}`),
			podcastFeedKey: readString(
				candidate,
				"podcastFeedKey",
				"",
				warnings,
				`podNotes.${key}`,
			),
		} as PodNote;
	}
	return notes;
}

export function decodePlayedEpisodes(
	value: unknown,
	warnings: Set<string>,
): Record<string, PlayedEpisode> {
	if (!isPlainObject(value)) {
		if (value !== undefined) warn(warnings, "playedEpisodes", "expected an object");
		return {};
	}

	const played: Record<string, PlayedEpisode> = {};
	for (const [key, candidate] of safeEntries(value, warnings, "playedEpisodes")) {
		if (!isPlainObject(candidate)) {
			warn(warnings, `playedEpisodes.${key}`, "expected an object; progress was skipped");
			continue;
		}
		played[key] = {
			...copySafeObject(candidate),
			title: readString(candidate, "title", key, warnings, `playedEpisodes.${key}`),
			podcastName: readString(
				candidate,
				"podcastName",
				"",
				warnings,
				`playedEpisodes.${key}`,
			),
			time: readNonNegativeNumber(candidate, "time", 0, warnings, `playedEpisodes.${key}`),
			duration: readNonNegativeNumber(
				candidate,
				"duration",
				0,
				warnings,
				`playedEpisodes.${key}`,
			),
			finished: readBoolean(candidate, "finished", false, warnings, `playedEpisodes.${key}`),
		} as PlayedEpisode;
	}
	return played;
}

export function decodePlaylists(value: unknown, warnings: Set<string>): Record<string, Playlist> {
	if (!isPlainObject(value)) {
		if (value !== undefined) warn(warnings, "playlists", "expected an object");
		return {};
	}

	const playlists: Record<string, Playlist> = {};
	for (const [key, candidate] of safeEntries(value, warnings, "playlists")) {
		if (!isPlainObject(candidate)) {
			warn(warnings, `playlists.${key}`, "expected an object; playlist was skipped");
			continue;
		}
		playlists[key] = decodePlaylist(
			candidate,
			{
				name: key,
				icon: "list",
				episodes: [],
				shouldEpisodeRemoveAfterPlay: false,
				shouldRepeat: false,
			},
			warnings,
			`playlists.${key}`,
		);
	}
	return playlists;
}

export function decodeDownloadedEpisodes(
	value: unknown,
	warnings: Set<string>,
): Record<string, DownloadedEpisode[]> {
	if (!isPlainObject(value)) {
		if (value !== undefined) warn(warnings, "downloadedEpisodes", "expected an object");
		return {};
	}

	const downloads: Record<string, DownloadedEpisode[]> = {};
	for (const [podcastName, candidate] of safeEntries(value, warnings, "downloadedEpisodes")) {
		if (!Array.isArray(candidate)) {
			warn(
				warnings,
				`downloadedEpisodes.${podcastName}`,
				"expected an array; download list was skipped",
			);
			continue;
		}

		downloads[podcastName] = candidate.flatMap((entry, index) => {
			const path = `downloadedEpisodes.${podcastName}[${index}]`;
			const decoded = decodeEpisode(entry, warnings, path);
			if (!decoded || !isPlainObject(entry) || typeof entry.filePath !== "string") {
				if (decoded)
					warn(warnings, `${path}.filePath`, "missing path; download was skipped");
				return [];
			}

			const size =
				typeof entry.size === "number" && Number.isFinite(entry.size) && entry.size >= 0
					? entry.size
					: 0;
			if (size !== entry.size) warn(warnings, `${path}.size`, "value was normalized");
			return [{ ...decoded, filePath: entry.filePath, size } as DownloadedEpisode];
		});
	}
	return downloads;
}
