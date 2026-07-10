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
import type { CredentialValues } from "src/types/Credentials";

export { decodeEpisode, decodePlaylist, encodeEpisode, encodePlaylist } from "./episodeCodec";

export const PODNOTES_DATA_SCHEMA_VERSION = 2;

/** Plaintext fields accepted only as migration input and never persisted again. */
export const RETIRED_PLAINTEXT_SECRET_KEYS = new Set(["openAIApiKey", "diarizationApiKey"]);

const KNOWN_TOP_LEVEL_KEYS = new Set([
	...Object.keys(DEFAULT_SETTINGS),
	...RETIRED_PLAINTEXT_SECRET_KEYS,
	"schemaVersion",
]);

export type PodNotesDataSchemaVersion = 0 | 1 | typeof PODNOTES_DATA_SCHEMA_VERSION;

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
	sourceVersion: PodNotesDataSchemaVersion;
	changed: boolean;
	warnings: string[];
	/** Plaintext v0/v1 values that must move into SecretStorage before a v2 save. */
	legacySecrets: CredentialValues;
	/** Retired fields found in v2 must be scrubbed without importing their values. */
	retiredPlaintextPresent: boolean;
	/** Unknown supported-schema root fields retained so a normal save does not erase them. */
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

export type PersistedPodNotesDataV2 = PersistedPodNotesSettings &
	UnknownRecord & {
		schemaVersion: typeof PODNOTES_DATA_SCHEMA_VERSION;
	};

/**
 * Decode and validate plugin data before any store sees it.
 *
 * Missing `schemaVersion` is the legacy v0 shape. Persisted data remains flat
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
	const legacySecrets = decodeLegacySecrets(value, sourceVersion, warnings);
	const retiredPlaintextPresent = [...RETIRED_PLAINTEXT_SECRET_KEYS].some((key) =>
		Object.prototype.hasOwnProperty.call(value, key),
	);
	const unknownFields = copyUnknownRootFields(value);

	return {
		settings,
		sourceVersion,
		changed:
			sourceVersion !== PODNOTES_DATA_SCHEMA_VERSION ||
			retiredPlaintextPresent ||
			warnings.size > 0,
		warnings: [...warnings],
		legacySecrets,
		retiredPlaintextPresent,
		unknownFields,
	};
}

/** Serialize a validated runtime snapshot with canonical dates and schema. */
export function encodePodNotesData(
	settings: IPodNotesSettings,
	unknownFields: UnknownRecord = {},
): PersistedPodNotesDataV2 {
	const validated = decodeSettings(
		settings as unknown as UnknownRecord,
		new Set(),
		PODNOTES_DATA_SCHEMA_VERSION,
	);

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
	} as PersistedPodNotesDataV2;
}

function readSchemaVersion(root: UnknownRecord): PodNotesDataSchemaVersion {
	if (!Object.prototype.hasOwnProperty.call(root, "schemaVersion")) return 0;

	const version = root.schemaVersion;
	if (version === 1 || version === PODNOTES_DATA_SCHEMA_VERSION) return version;
	if (
		typeof version === "number" &&
		Number.isInteger(version) &&
		version > PODNOTES_DATA_SCHEMA_VERSION
	) {
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

function decodeLegacySecrets(
	root: UnknownRecord,
	sourceVersion: PodNotesDataSchemaVersion,
	warnings: Set<string>,
): CredentialValues {
	if (sourceVersion >= PODNOTES_DATA_SCHEMA_VERSION) return {};

	const values: CredentialValues = {};
	readLegacySecret(root, "openAIApiKey", "openAI", values, warnings);
	readLegacySecret(root, "diarizationApiKey", "deepgram", values, warnings);
	return values;
}

function readLegacySecret(
	root: UnknownRecord,
	legacyKey: "openAIApiKey" | "diarizationApiKey",
	credentialKey: keyof CredentialValues,
	values: CredentialValues,
	warnings: Set<string>,
): void {
	const value = root[legacyKey];
	if (value === undefined || value === null || value === "") return;
	if (typeof value !== "string") {
		warnings.add(`${legacyKey}: expected a string; value was ignored`);
		return;
	}

	const normalized = value.trim();
	if (normalized) values[credentialKey] = normalized;
}

function copyUnknownRootFields(root: UnknownRecord): UnknownRecord {
	const copy: UnknownRecord = {};
	for (const [key, value] of Object.entries(root)) {
		if (DANGEROUS_KEYS.has(key) || KNOWN_TOP_LEVEL_KEYS.has(key)) continue;
		copy[key] = value;
	}
	return copy;
}
