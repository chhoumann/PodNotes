import { isEpisodeHandle, type EpisodeHandle, type FeedHandle } from "src/security/resourceHandles";
import { normalizeEpisode, normalizeFeed, normalizePlaylist } from "./entities";
import {
	LIBRARY_V3_EXTENSIONS_SCHEMA_VERSION,
	MAX_CUSTOM_PLAYLISTS,
	MAX_DOWNLOADS_PER_EPISODE,
	MAX_EPISODES,
	MAX_FEEDS,
	MAX_LOCAL_ASSETS,
	MAX_PLAYLIST_NAME_BYTES,
	MAX_POD_NOTE_ENTRIES,
	MAX_PROGRESS_ENTRIES,
	MAX_TOTAL_EPISODE_REFERENCES,
	type DownloadAssetV3,
	type DownloadMapV3,
	type EpisodeMapV3,
	type EpisodeProgressV3,
	type FeedMapV3,
	type LibraryExtensionsV1,
	type LibraryPlaylistV3,
	type LocalAssetMapV3,
	type PodNoteMapV3,
	type ValidationContext,
} from "./model";
import {
	compareCodeUnits,
	INVALID,
	isPlainDataRecord,
	isStrictRecord,
	normalizeText,
	normalizeVaultPath,
} from "./scalars";

const PROGRESS_KEYS = new Set(["episodeId", "time", "duration", "finished"]);
const POD_NOTE_KEYS = new Set(["episodeId", "filePath"]);
const DOWNLOAD_ASSET_KEYS = new Set(["filePath", "size"]);
const LOCAL_ASSET_KEYS = new Set(["episodeId", "filePath"]);
const EXTENSIONS_KEYS = new Set(["schemaVersion"]);

export function normalizeFeeds(value: unknown, context: ValidationContext): FeedMapV3 | null {
	if (!isPlainDataRecord(value)) return null;
	const keys = Object.keys(value);
	if (keys.length > MAX_FEEDS) return null;

	const result: Partial<Record<FeedHandle, NonNullable<FeedMapV3[FeedHandle]>>> = {};
	for (const key of keys.sort()) {
		const feed = normalizeFeed(value[key], key, context);
		if (!feed) return null;
		result[feed.feedId] = feed;
	}
	return result;
}

export function normalizeEpisodes(value: unknown, context: ValidationContext): EpisodeMapV3 | null {
	if (!isPlainDataRecord(value)) return null;
	const keys = Object.keys(value);
	if (keys.length > MAX_EPISODES) return null;

	const result: Partial<Record<EpisodeHandle, NonNullable<EpisodeMapV3[EpisodeHandle]>>> = {};
	for (const key of keys.sort()) {
		const episode = normalizeEpisode(value[key], key, context);
		if (!episode) return null;
		result[episode.episodeId] = episode;
	}
	return result;
}

export function normalizeCustomPlaylists(
	value: unknown,
	context: ValidationContext,
): Readonly<Record<string, LibraryPlaylistV3>> | null {
	if (!isPlainDataRecord(value)) return null;
	const keys = Object.keys(value);
	if (keys.length > MAX_CUSTOM_PLAYLISTS) return null;

	const result: Record<string, LibraryPlaylistV3> = {};
	for (const key of keys.sort()) {
		const normalizedKey = normalizeText(key, MAX_PLAYLIST_NAME_BYTES, context);
		const playlist = normalizePlaylist(value[key], context);
		if (normalizedKey === INVALID || !playlist || playlist.name !== key) return null;
		result[key] = playlist;
	}
	return result;
}

export function normalizeProgress(
	value: unknown,
): Readonly<Partial<Record<EpisodeHandle, EpisodeProgressV3>>> | null {
	if (!isPlainDataRecord(value)) return null;
	const keys = Object.keys(value);
	if (keys.length > MAX_PROGRESS_ENTRIES) return null;

	const result: Partial<Record<EpisodeHandle, EpisodeProgressV3>> = {};
	for (const key of keys.sort()) {
		const entry = value[key];
		if (
			!isEpisodeHandle(key) ||
			!isStrictRecord(entry, PROGRESS_KEYS) ||
			entry.episodeId !== key ||
			typeof entry.time !== "number" ||
			!Number.isFinite(entry.time) ||
			entry.time < 0 ||
			entry.time > Number.MAX_SAFE_INTEGER ||
			typeof entry.duration !== "number" ||
			!Number.isFinite(entry.duration) ||
			entry.duration < 0 ||
			entry.duration > Number.MAX_SAFE_INTEGER ||
			(entry.duration > 0 && entry.time > entry.duration) ||
			typeof entry.finished !== "boolean"
		) {
			return null;
		}
		result[key] = {
			episodeId: key,
			time: entry.time,
			duration: entry.duration,
			finished: entry.finished,
		};
	}
	return result;
}

export function normalizePodNotes(value: unknown, context: ValidationContext): PodNoteMapV3 | null {
	if (!isPlainDataRecord(value)) return null;
	const keys = Object.keys(value);
	if (keys.length > MAX_POD_NOTE_ENTRIES) return null;

	const result: Partial<Record<EpisodeHandle, NonNullable<PodNoteMapV3[EpisodeHandle]>>> = {};
	for (const key of keys.sort()) {
		const entry = value[key];
		if (
			!isEpisodeHandle(key) ||
			!isStrictRecord(entry, POD_NOTE_KEYS) ||
			entry.episodeId !== key
		) {
			return null;
		}
		const filePath = normalizeVaultPath(entry.filePath, context);
		if (filePath === INVALID) return null;
		result[key] = { episodeId: key, filePath };
	}
	return result;
}

export function normalizeDownloads(
	value: unknown,
	context: ValidationContext,
): DownloadMapV3 | null {
	if (!isPlainDataRecord(value)) return null;
	const keys = Object.keys(value);
	if (keys.length > MAX_EPISODES) return null;

	const result: Partial<Record<EpisodeHandle, DownloadAssetV3[]>> = {};
	for (const key of keys.sort()) {
		const entries = value[key];
		if (
			!isEpisodeHandle(key) ||
			!Array.isArray(entries) ||
			entries.length === 0 ||
			entries.length > MAX_DOWNLOADS_PER_EPISODE
		) {
			return null;
		}

		const normalized: DownloadAssetV3[] = [];
		for (const entry of entries) {
			if (
				!isStrictRecord(entry, DOWNLOAD_ASSET_KEYS) ||
				typeof entry.size !== "number" ||
				!Number.isSafeInteger(entry.size) ||
				entry.size < 0
			) {
				return null;
			}
			const filePath = normalizeVaultPath(entry.filePath, context);
			if (filePath === INVALID) return null;
			normalized.push({ filePath, size: entry.size });
		}
		context.episodeReferences += normalized.length;
		if (context.episodeReferences > MAX_TOTAL_EPISODE_REFERENCES) return null;
		result[key] = normalized.sort((a, b) => compareCodeUnits(a.filePath, b.filePath));
	}
	return result;
}

export function normalizeLocalAssets(
	value: unknown,
	context: ValidationContext,
): LocalAssetMapV3 | null {
	if (!isPlainDataRecord(value)) return null;
	const keys = Object.keys(value);
	if (keys.length > MAX_LOCAL_ASSETS) return null;

	const result: Partial<Record<EpisodeHandle, NonNullable<LocalAssetMapV3[EpisodeHandle]>>> = {};
	for (const key of keys.sort()) {
		const entry = value[key];
		if (
			!isEpisodeHandle(key) ||
			!isStrictRecord(entry, LOCAL_ASSET_KEYS) ||
			entry.episodeId !== key
		) {
			return null;
		}
		const filePath = normalizeVaultPath(entry.filePath, context);
		if (filePath === INVALID) return null;
		result[key] = { episodeId: key, filePath };
	}
	context.episodeReferences += keys.length;
	return context.episodeReferences <= MAX_TOTAL_EPISODE_REFERENCES ? result : null;
}

export function normalizeExtensions(value: unknown): LibraryExtensionsV1 | null {
	return isStrictRecord(value, EXTENSIONS_KEYS) &&
		value.schemaVersion === LIBRARY_V3_EXTENSIONS_SCHEMA_VERSION
		? { schemaVersion: LIBRARY_V3_EXTENSIONS_SCHEMA_VERSION }
		: null;
}
