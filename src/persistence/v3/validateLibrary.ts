import { isEpisodeHandle, type EpisodeHandle } from "src/security/resourceHandles";
import {
	normalizeCustomPlaylists,
	normalizeDownloads,
	normalizeEpisodes,
	normalizeExtensions,
	normalizeFeeds,
	normalizeLocalAssets,
	normalizePodNotes,
	normalizeProgress,
} from "./collections";
import { normalizePlaylist } from "./entities";
import {
	LIBRARY_V3_SCHEMA_VERSION,
	MAX_TOTAL_EPISODE_REFERENCES,
	type LibraryV3,
	type ValidationContext,
} from "./model";
import { libraryReferencesAreValid } from "./referentialIntegrity";
import { hasOwn, isStrictRecord, serializedLibraryFits } from "./scalars";

const ROOT_KEYS = new Set([
	"schemaVersion",
	"feeds",
	"episodes",
	"queue",
	"favorites",
	"localFiles",
	"playlists",
	"currentEpisodeId",
	"progress",
	"podNotes",
	"downloads",
	"localAssets",
	"extensions",
]);

function normalizeLibrary(value: unknown): LibraryV3 | null {
	if (!isStrictRecord(value, ROOT_KEYS) || value.schemaVersion !== LIBRARY_V3_SCHEMA_VERSION) {
		return null;
	}
	const context: ValidationContext = { textBytes: 0, episodeReferences: 0 };
	const feeds = normalizeFeeds(value.feeds, context);
	const episodes = normalizeEpisodes(value.episodes, context);
	const queue = normalizePlaylist(value.queue, context);
	const favorites = normalizePlaylist(value.favorites, context);
	const localFiles = normalizePlaylist(value.localFiles, context);
	const playlists = normalizeCustomPlaylists(value.playlists, context);
	const progress = normalizeProgress(value.progress);
	const podNotes = normalizePodNotes(value.podNotes, context);
	const downloads = normalizeDownloads(value.downloads, context);
	const localAssets = normalizeLocalAssets(value.localAssets, context);
	const extensions = normalizeExtensions(value.extensions);
	if (
		!feeds ||
		!episodes ||
		!queue ||
		!favorites ||
		!localFiles ||
		!playlists ||
		!progress ||
		!podNotes ||
		!downloads ||
		!localAssets ||
		!extensions
	) {
		return null;
	}

	let currentEpisodeId: EpisodeHandle | undefined;
	if (hasOwn(value, "currentEpisodeId")) {
		if (!isEpisodeHandle(value.currentEpisodeId)) return null;
		currentEpisodeId = value.currentEpisodeId;
		context.episodeReferences += 1;
		if (context.episodeReferences > MAX_TOTAL_EPISODE_REFERENCES) return null;
	}

	const model: LibraryV3 = {
		schemaVersion: LIBRARY_V3_SCHEMA_VERSION,
		feeds,
		episodes,
		queue,
		favorites,
		localFiles,
		playlists,
		...(currentEpisodeId ? { currentEpisodeId } : {}),
		progress,
		podNotes,
		downloads,
		localAssets,
		extensions,
	};
	if (!libraryReferencesAreValid(model)) return null;
	return serializedLibraryFits(model) ? model : null;
}

export function validateLibraryV3(value: unknown): LibraryV3 | null {
	try {
		return normalizeLibrary(value);
	} catch {
		return null;
	}
}
