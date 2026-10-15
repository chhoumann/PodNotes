import type DownloadedEpisode from "src/types/DownloadedEpisode";
import type { Playlist } from "src/types/Playlist";
import type { PodcastFeed } from "src/types/PodcastFeed";
import type { PodNote } from "src/types/PodNotes";
import type { PlayedEpisode } from "src/types/PlayedEpisode";
import { ownRecord } from "src/utility/ownRecord";
import { isPlainObject } from "src/utility/isPlainObject";
import {
	copySafeObject,
	readBoolean,
	readNonNegativeNumber,
	readString,
	setOptionalString,
	warn,
} from "./codecUtils";
import { decodeEpisode, decodePlaylist } from "./episodeCodec";

/** A map whose entries `isEntry` accepts; any other entry is skipped with `skipped`. */
function decodeRecord<E, T>(
	value: unknown,
	warnings: Set<string>,
	name: string,
	isEntry: (candidate: unknown) => candidate is E,
	skipped: string,
	decode: (candidate: E, path: string, key: string) => T,
): Record<string, T> {
	if (!isPlainObject(value)) {
		if (value !== undefined) warn(warnings, name, "expected an object");
		return ownRecord();
	}

	const decoded = ownRecord<T>();
	for (const [key, candidate] of Object.entries(value)) {
		const path = `${name}.${key}`;
		if (isEntry(candidate)) decoded[key] = decode(candidate, path, key);
		else warn(warnings, path, skipped);
	}
	return decoded;
}

export function decodeSavedFeeds(
	value: unknown,
	warnings: Set<string>,
): Record<string, PodcastFeed> {
	return decodeRecord(
		value,
		warnings,
		"savedFeeds",
		isPlainObject,
		"expected an object; feed was skipped",
		(candidate, path, key) => {
			const feed = copySafeObject(candidate);
			feed.title = readString(candidate, "title", key, warnings, path);
			feed.url = readString(candidate, "url", "", warnings, path);
			feed.artworkUrl = readString(candidate, "artworkUrl", "", warnings, path);
			setOptionalString(feed, candidate, "urlSecretId", warnings, path);
			setOptionalString(feed, candidate, "description", warnings, path);
			setOptionalString(feed, candidate, "link", warnings, path);
			setOptionalString(feed, candidate, "author", warnings, path);
			if (
				typeof candidate.collectionId === "number" &&
				Number.isFinite(candidate.collectionId)
			) {
				feed.collectionId = String(candidate.collectionId);
				warn(warnings, `${path}.collectionId`, "number was converted to text");
			} else {
				setOptionalString(feed, candidate, "collectionId", warnings, path);
			}
			return feed as unknown as PodcastFeed;
		},
	);
}

export function decodePodNotes(value: unknown, warnings: Set<string>): Record<string, PodNote> {
	return decodeRecord(
		value,
		warnings,
		"podNotes",
		isPlainObject,
		"expected an object; note mapping was skipped",
		(candidate, path, key) => ({
			...copySafeObject(candidate),
			episodeName: readString(candidate, "episodeName", key, warnings, path),
			filePath: readString(candidate, "filePath", "", warnings, path),
			podcastFeedKey: readString(candidate, "podcastFeedKey", "", warnings, path),
		}),
	);
}

export function decodePlayedEpisodes(
	value: unknown,
	warnings: Set<string>,
): Record<string, PlayedEpisode> {
	return decodeRecord(
		value,
		warnings,
		"playedEpisodes",
		isPlainObject,
		"expected an object; progress was skipped",
		(candidate, path, key) => ({
			...copySafeObject(candidate),
			title: readString(candidate, "title", key, warnings, path),
			podcastName: readString(candidate, "podcastName", "", warnings, path),
			time: readNonNegativeNumber(candidate, "time", 0, warnings, path),
			duration: readNonNegativeNumber(candidate, "duration", 0, warnings, path),
			finished: readBoolean(candidate, "finished", false, warnings, path),
		}),
	);
}

export function decodePlaylists(value: unknown, warnings: Set<string>): Record<string, Playlist> {
	return decodeRecord(
		value,
		warnings,
		"playlists",
		isPlainObject,
		"expected an object; playlist was skipped",
		(candidate, path, key) =>
			decodePlaylist(
				candidate,
				{
					name: key,
					icon: "list",
					shouldEpisodeRemoveAfterPlay: false,
					shouldRepeat: false,
				},
				warnings,
				path,
			),
	);
}

export function decodeDownloadedEpisodes(
	value: unknown,
	warnings: Set<string>,
): Record<string, DownloadedEpisode[]> {
	return decodeRecord(
		value,
		warnings,
		"downloadedEpisodes",
		Array.isArray,
		"expected an array; download list was skipped",
		(candidate, listPath) =>
			candidate.flatMap((entry, index) => {
				const path = `${listPath}[${index}]`;
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

				const download: DownloadedEpisode = { ...decoded, filePath: entry.filePath, size };
				if ("downloadedByPodNotes" in entry && entry.downloadedByPodNotes !== true) {
					delete download.downloadedByPodNotes;
					warn(warnings, `${path}.downloadedByPodNotes`, "value was normalized");
				}
				return [download];
			}),
	);
}
