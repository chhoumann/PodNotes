import { DEFAULT_SETTINGS } from "src/constants";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import { DANGEROUS_KEYS, isPlainObject, mapRecord, type UnknownRecord } from "./codecUtils";
import {
	encodeEpisode,
	encodePlaylist,
	type PersistedEpisode,
	type PersistedPlaylist,
} from "./episodeCodec";
import { decodeSettings } from "./settingsCodec";

export { decodeEpisode, decodePlaylist, encodeEpisode, encodePlaylist } from "./episodeCodec";

export const PODNOTES_DATA_SCHEMA_VERSION = 1;

const KNOWN_TOP_LEVEL_KEYS = new Set([...Object.keys(DEFAULT_SETTINGS), "schemaVersion"]);

export class PodNotesDataError extends Error {
	constructor(
		message: string,
		public readonly code: "invalid-data" | "unsupported-version",
	) {
		super(message);
		this.name = "PodNotesDataError";
	}
}

export interface DecodedPodNotesData {
	settings: IPodNotesSettings;
	sourceVersion: 0 | typeof PODNOTES_DATA_SCHEMA_VERSION;
	changed: boolean;
	warnings: string[];
	/** Unknown v0/v1 root fields retained so a normal save does not erase them. */
	unknownFields: UnknownRecord;
}

export type PersistedPodNotesSettings = Omit<
	IPodNotesSettings,
	"currentEpisode" | "favorites" | "queue" | "localFiles" | "playlists" | "downloadedEpisodes"
> & {
	currentEpisode?: PersistedEpisode;
	favorites: PersistedPlaylist;
	queue: PersistedPlaylist;
	localFiles: PersistedPlaylist;
	playlists: Record<string, PersistedPlaylist>;
	downloadedEpisodes: Record<string, PersistedEpisode[]>;
};

export type PersistedPodNotesDataV1 = PersistedPodNotesSettings &
	UnknownRecord & {
		schemaVersion: typeof PODNOTES_DATA_SCHEMA_VERSION;
	};

/**
 * Decode and validate plugin data before any store sees it.
 *
 * Missing `schemaVersion` is the legacy v0 shape. V1 deliberately remains flat
 * so existing data files, rollback paths, and E2E tooling stay compatible. A
 * newer version fails closed so an older plugin can never overwrite data it
 * does not understand.
 */
export function decodePodNotesData(value: unknown): DecodedPodNotesData {
	if (value === null || value === undefined) value = {};

	if (!isPlainObject(value)) {
		throw new PodNotesDataError(
			"PodNotes data.json does not contain an object. The file was not modified.",
			"invalid-data",
		);
	}

	const sourceVersion = readSchemaVersion(value);
	const warnings = new Set<string>();
	const settings = decodeSettings(value, warnings, sourceVersion);
	const unknownFields = copyUnknownRootFields(value);

	return {
		settings,
		sourceVersion,
		changed: sourceVersion !== PODNOTES_DATA_SCHEMA_VERSION || warnings.size > 0,
		warnings: [...warnings],
		unknownFields,
	};
}

/** Serialize a validated runtime snapshot with canonical dates and schema. */
export function encodePodNotesData(
	settings: IPodNotesSettings,
	unknownFields: UnknownRecord = {},
): PersistedPodNotesDataV1 {
	const validated = decodeSettings(settings as unknown as UnknownRecord, new Set(), 1);

	return {
		...copyUnknownRootFields(unknownFields),
		...validated,
		schemaVersion: PODNOTES_DATA_SCHEMA_VERSION,
		currentEpisode: validated.currentEpisode
			? encodeEpisode(validated.currentEpisode)
			: undefined,
		favorites: encodePlaylist(validated.favorites),
		queue: encodePlaylist(validated.queue),
		localFiles: encodePlaylist(validated.localFiles),
		playlists: mapRecord(validated.playlists, (playlist) => encodePlaylist(playlist)),
		downloadedEpisodes: mapRecord(validated.downloadedEpisodes, (episodes) =>
			episodes.map((episode) => encodeEpisode(episode)),
		),
	} as PersistedPodNotesDataV1;
}

function readSchemaVersion(root: UnknownRecord): 0 | 1 {
	if (!Object.prototype.hasOwnProperty.call(root, "schemaVersion")) return 0;

	const version = root.schemaVersion;
	if (version === PODNOTES_DATA_SCHEMA_VERSION) return version;
	if (typeof version === "number" && Number.isInteger(version) && version > 1) {
		throw new PodNotesDataError(
			`PodNotes data schema v${version} requires a newer version of PodNotes. The file was not modified.`,
			"unsupported-version",
		);
	}

	throw new PodNotesDataError(
		"PodNotes data.json has an invalid schemaVersion. The file was not modified.",
		"invalid-data",
	);
}

function copyUnknownRootFields(root: UnknownRecord): UnknownRecord {
	const copy: UnknownRecord = {};
	for (const [key, value] of Object.entries(root)) {
		if (DANGEROUS_KEYS.has(key) || KNOWN_TOP_LEVEL_KEYS.has(key)) continue;
		copy[key] = value;
	}
	return copy;
}
