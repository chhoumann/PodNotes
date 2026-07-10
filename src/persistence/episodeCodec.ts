import type { Episode } from "src/types/Episode";
import type { Playlist } from "src/types/Playlist";
import {
	copySafeObject,
	isPlainObject,
	readBoolean,
	readString,
	setOptionalFiniteNumber,
	setOptionalString,
	type UnknownRecord,
	warn,
} from "./codecUtils";
import { decodeDate, encodeDate } from "./dateCodec";

export type PersistedEpisode = Omit<Episode, "episodeDate"> & {
	episodeDate?: string;
} & UnknownRecord;

export type PersistedPlaylist = Omit<Playlist, "episodes" | "currentEpisode"> & {
	episodes: PersistedEpisode[];
	currentEpisode?: PersistedEpisode;
} & UnknownRecord;

/** Decode a standalone episode at a persistence, import, or cache boundary. */
export function decodeEpisode(
	value: unknown,
	warnings: Set<string> = new Set(),
	path = "episode",
): Episode | undefined {
	if (!isPlainObject(value)) {
		warn(warnings, path, "expected an object");
		return undefined;
	}

	if (typeof value.title !== "string") {
		warn(warnings, `${path}.title`, "expected a string; episode was skipped");
		return undefined;
	}

	const decoded = copySafeObject(value);
	decoded.title = value.title;
	decoded.streamUrl = readString(value, "streamUrl", "", warnings, path);
	decoded.url = readString(value, "url", "", warnings, path);
	decoded.description = readString(value, "description", "", warnings, path);
	decoded.content = readString(value, "content", "", warnings, path);
	decoded.podcastName = readString(value, "podcastName", "", warnings, path);

	setOptionalString(decoded, value, "feedUrl", warnings, path);
	setOptionalString(decoded, value, "artworkUrl", warnings, path);
	setOptionalString(decoded, value, "itunesTitle", warnings, path);
	setOptionalString(decoded, value, "chaptersUrl", warnings, path);
	// Local and downloaded episode projections carry this structural extension
	// while still flowing through Episode-typed playlists.
	setOptionalString(decoded, value, "filePath", warnings, path);

	setOptionalFiniteNumber(decoded, value, "episodeNumber", warnings, path, 0);
	setOptionalFiniteNumber(decoded, value, "duration", warnings, path, 0);
	setOptionalFiniteNumber(decoded, value, "size", warnings, path, 0);

	if (value.mediaType === undefined) {
		delete decoded.mediaType;
	} else if (value.mediaType === "audio" || value.mediaType === "video") {
		decoded.mediaType = value.mediaType;
	} else {
		delete decoded.mediaType;
		warn(warnings, `${path}.mediaType`, "expected audio or video");
	}

	if (value.episodeDate === undefined || value.episodeDate === null || value.episodeDate === "") {
		delete decoded.episodeDate;
	} else {
		const episodeDate = decodeDate(value.episodeDate);
		if (episodeDate) {
			decoded.episodeDate = episodeDate;
		} else {
			delete decoded.episodeDate;
			warn(warnings, `${path}.episodeDate`, "invalid date was removed");
		}
	}

	return decoded as unknown as Episode;
}

/** Encode an episode while preserving safe structural extension fields. */
export function encodeEpisode(value: Episode): PersistedEpisode;
export function encodeEpisode(value: undefined): undefined;
export function encodeEpisode(value: Episode | undefined): PersistedEpisode | undefined {
	if (!value) return undefined;

	const encoded = copySafeObject(value as unknown as UnknownRecord);
	const episodeDate = encodeDate(value.episodeDate);
	if (episodeDate) encoded.episodeDate = episodeDate;
	else delete encoded.episodeDate;
	return encoded as PersistedEpisode;
}

/** Decode a playlist and every episode snapshot it owns. */
export function decodePlaylist(
	value: unknown,
	fallback: Playlist,
	warnings: Set<string> = new Set(),
	path = "playlist",
): Playlist {
	if (!isPlainObject(value)) {
		if (value !== undefined) warn(warnings, path, "expected an object");
		return clonePlaylist(fallback);
	}

	const decoded = copySafeObject(value);
	decoded.icon = readString(value, "icon", fallback.icon, warnings, path);
	decoded.name = readString(value, "name", fallback.name, warnings, path);
	decoded.shouldEpisodeRemoveAfterPlay = readBoolean(
		value,
		"shouldEpisodeRemoveAfterPlay",
		fallback.shouldEpisodeRemoveAfterPlay,
		warnings,
		path,
	);
	decoded.shouldRepeat = readBoolean(
		value,
		"shouldRepeat",
		fallback.shouldRepeat,
		warnings,
		path,
	);

	if (Array.isArray(value.episodes)) {
		decoded.episodes = value.episodes.flatMap((episode, index) => {
			const result = decodeEpisode(episode, warnings, `${path}.episodes[${index}]`);
			return result ? [result] : [];
		});
	} else {
		if (value.episodes !== undefined) warn(warnings, `${path}.episodes`, "expected an array");
		decoded.episodes = fallback.episodes
			.map((episode, index) =>
				decodeEpisode(episode, warnings, `${path}.fallbackEpisodes[${index}]`),
			)
			.filter((episode): episode is Episode => Boolean(episode));
	}

	const currentEpisode =
		value.currentEpisode === undefined || value.currentEpisode === null
			? undefined
			: decodeEpisode(value.currentEpisode, warnings, `${path}.currentEpisode`);
	if (currentEpisode) decoded.currentEpisode = currentEpisode;
	else delete decoded.currentEpisode;

	if (value.isVirtual === undefined) {
		delete decoded.isVirtual;
	} else if (typeof value.isVirtual === "boolean") {
		decoded.isVirtual = value.isVirtual;
	} else {
		delete decoded.isVirtual;
		warn(warnings, `${path}.isVirtual`, "expected a boolean");
	}

	return decoded as unknown as Playlist;
}

export function encodePlaylist(value: Playlist): PersistedPlaylist {
	const encoded = copySafeObject(value as unknown as UnknownRecord);
	encoded.episodes = value.episodes.map((episode) => encodeEpisode(episode));
	const currentEpisode = value.currentEpisode ? encodeEpisode(value.currentEpisode) : undefined;
	if (currentEpisode) encoded.currentEpisode = currentEpisode;
	else delete encoded.currentEpisode;
	return encoded as PersistedPlaylist;
}

function clonePlaylist(value: Playlist): Playlist {
	return {
		...value,
		episodes: value.episodes.map((episode) => ({ ...episode })),
		currentEpisode: value.currentEpisode ? { ...value.currentEpisode } : undefined,
	};
}
