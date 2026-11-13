import { DEFAULT_SETTINGS } from "./constants";
import { DANGEROUS_KEYS, isPlainObject, mapRecord } from "./persistence/codecUtils";
import {
	decodePodNotesData,
	encodePodNotesData,
	PODNOTES_DATA_SCHEMA_VERSION,
	type PersistedPodNotesSettings,
	PodNotesDataError,
} from "./persistence/podNotesData";
import { choseDeepgram } from "./settingsMigrations";
import { CREDENTIAL_KINDS, CREDENTIALS, type CredentialValues } from "./types/Credentials";
import type { Episode } from "./types/Episode";
import type { IPodNotesSettings } from "./types/IPodNotesSettings";
import { ownRecord } from "./utility/ownRecord";
import { isLocalFile } from "./utility/isLocalFile";
import { isFeedUrlSecretId } from "./services/FeedUrlRepository";

/**
 * Serialization for the "import/export settings & templates" feature (issue #162).
 *
 * PodNotes settings are persisted verbatim as `data.json` in the plugin folder.
 * Export is therefore essentially a filtered copy of that object wrapped in a
 * small versioned envelope; import validates a file and merges it back so the
 * plugin's normal load path can apply it. This module is pure (no Obsidian/UI
 * dependencies) so the risky parse/validate/merge logic is unit-testable.
 */

export const SETTINGS_EXPORT_TYPE = "podnotes-settings";
export const SETTINGS_EXPORT_VERSION = 2;

export const VAULT_LOCAL_KEYS: readonly (keyof IPodNotesSettings)[] = [
	"podNotes",
	"downloadedEpisodes",
	"localFiles",
	"currentEpisode",
];

/** Provider API-key references are device-local, not settings transfer data. */
const SECRET_REFERENCE_KEYS: ReadonlySet<keyof IPodNotesSettings> = new Set(
	CREDENTIAL_KINDS.map((kind) => CREDENTIALS[kind].settingsKey),
);

/** Plaintext fields that versions before 2.19.0 wrote. No new kind joins them. */
const LEGACY_SECRET_KEYS = {
	openAIApiKey: "openAI",
	diarizationApiKey: "deepgram",
} as const;

/**
 * The human-facing labels for the secrets actually present (non-empty) in a
 * settings object. Used to keep the export toggle, the export notice, and the
 * import confirmation honest about which keys are involved, so a Deepgram-only
 * user is never told only "OpenAI API key" (and vice versa). See issue #168.
 */
export function describeSecrets(secrets: CredentialValues): string[] {
	return CREDENTIAL_KINDS.filter((kind) =>
		Boolean(secrets[CREDENTIALS[kind].exportKey]?.trim()),
	).map((kind) => `${CREDENTIALS[kind].label} API key`);
}

/** Known top-level setting keys that are safe to import (excludes vault-local state). */
const IMPORTABLE_KEYS = new Set(
	Object.keys(DEFAULT_SETTINGS).filter(
		(key) =>
			!VAULT_LOCAL_KEYS.includes(key as keyof IPodNotesSettings) &&
			!SECRET_REFERENCE_KEYS.has(key as keyof IPodNotesSettings),
	),
);

/** Nested object settings whose fields are backfilled from defaults on import. */
const NESTED_KEYS: readonly (keyof IPodNotesSettings)[] = [
	"timestamp",
	"note",
	"feedNote",
	"download",
	"transcript",
];

/** Optional nested fields, which DEFAULT_SETTINGS leaves out, each with a value of its type. */
const OPTIONAL_NESTED_FIELDS: Partial<Record<string, object>> = {
	timestamp: { quickAddChoiceId: "" } satisfies Partial<IPodNotesSettings["timestamp"]>,
};

export interface SettingsEnvelope {
	type: typeof SETTINGS_EXPORT_TYPE;
	version: number;
	pluginVersion: string;
	exportedAt: string;
	settings: Partial<PersistedPodNotesSettings>;
	/** Present only after the user explicitly opts into a plaintext credential backup. */
	secrets?: CredentialValues;
}

export interface ExportOptions {
	/** Explicit values resolved by the UI after the user opts in. Never inferred here. */
	secrets?: CredentialValues;
}

export type ParseResult =
	| {
			ok: true;
			settings: Partial<IPodNotesSettings>;
			secrets: CredentialValues;
			meta: {
				fromEnvelope: boolean;
				version: number | null;
				pluginVersion: string | null;
				includesSecret: boolean;
			};
	  }
	| { ok: false; error: string };

function portable<T extends object>(settings: T): T {
	const out = { ...settings } as Record<string, unknown>;
	if (isPlainObject(out.savedFeeds)) {
		out.savedFeeds = mapRecord(out.savedFeeds, (feed) =>
			isPlainObject(feed)
				? {
						...feed,
						urlSecretId:
							typeof feed.urlSecretId === "string" &&
							isFeedUrlSecretId(feed.urlSecretId)
								? feed.urlSecretId
								: undefined,
					}
				: feed,
		);
	}
	// The provider that versions up to 2.24.0 keep beside the speaker settings stays with
	// the library that stored it. It is stale once the provider changes.
	if (isPlainObject(out.transcript) && isPlainObject(out.transcript.diarization)) {
		const diarization = { ...out.transcript.diarization };
		delete diarization.provider;
		out.transcript = { ...out.transcript, diarization };
	}
	for (const key of ["queue", "favorites"]) {
		if (key in out) out[key] = portablePlaylist(out[key]);
	}
	if (isPlainObject(out.playlists)) out.playlists = mapRecord(out.playlists, portablePlaylist);
	// Older versions kept whole episodes, local paths included, in progress records.
	if (isPlainObject(out.playedEpisodes)) {
		out.playedEpisodes = mapRecord(out.playedEpisodes, (record) =>
			isPlainObject(record)
				? {
						title: record.title,
						podcastName: record.podcastName,
						time: record.time,
						duration: record.duration,
						finished: record.finished,
					}
				: record,
		);
	}
	return out as T;
}

/** A playlist without local files. Its current episode is dropped too: no player reads it. */
function portablePlaylist(playlist: unknown): unknown {
	if (!isPlainObject(playlist)) return playlist;
	const { episodes } = playlist;
	return {
		...playlist,
		currentEpisode: undefined,
		episodes: Array.isArray(episodes)
			? episodes.filter(
					(episode) =>
						!isPlainObject(episode) || !isLocalFile(episode as unknown as Episode),
				)
			: episodes,
	};
}

export function serializeSettings(
	settings: IPodNotesSettings,
	opts: ExportOptions,
	pluginVersion: string,
	nowISO: string,
	privateFeedAddresses: ReadonlyMap<string, string>,
): SettingsEnvelope {
	const out: Record<string, unknown> = {};
	const persisted = encodePodNotesData(settings, {}, privateFeedAddresses);

	for (const key of Object.keys(settings)) {
		if (DANGEROUS_KEYS.has(key)) continue;
		if (!IMPORTABLE_KEYS.has(key)) continue;
		out[key] = persisted[key];
	}
	const secrets = normalizeSecrets(opts.secrets ?? {});

	return {
		type: SETTINGS_EXPORT_TYPE,
		version: SETTINGS_EXPORT_VERSION,
		pluginVersion,
		exportedAt: nowISO,
		settings: portable(out),
		...(Object.keys(secrets).length > 0 ? { secrets } : {}),
	};
}

/**
 * Parse and validate an import file. Accepts either a PodNotes export envelope
 * or a raw settings object (e.g. a hand-copied `data.json`). Unknown, runtime,
 * and prototype-pollution keys are dropped; a newer envelope version is rejected.
 */
export function parseImport(jsonText: string): ParseResult {
	let raw: unknown;
	try {
		raw = JSON.parse(jsonText);
	} catch {
		return { ok: false, error: "File is not valid JSON." };
	}

	if (!isPlainObject(raw)) {
		return { ok: false, error: "File does not contain a settings object." };
	}

	let source: Record<string, unknown> = raw;
	let fromEnvelope = false;
	let version: number | null = null;
	let pluginVersion: string | null = null;
	let secrets: CredentialValues = {};

	if (raw.type === SETTINGS_EXPORT_TYPE) {
		fromEnvelope = true;

		if (typeof raw.version !== "number" || !Number.isInteger(raw.version) || raw.version < 1) {
			return { ok: false, error: "Export file has an invalid version." };
		}
		if (raw.version > SETTINGS_EXPORT_VERSION) {
			return {
				ok: false,
				error: `This file was exported by a newer version of PodNotes (format v${raw.version}). Update PodNotes to import it.`,
			};
		}
		version = raw.version;

		if (typeof raw.pluginVersion === "string") {
			pluginVersion = raw.pluginVersion;
		}

		if (!isPlainObject(raw.settings)) {
			return {
				ok: false,
				error: "Export file is missing its settings payload.",
			};
		}

		source = raw.settings;
		if (version >= 2) {
			const parsedSecrets = parseSecretsPayload(raw.secrets);
			if ("error" in parsedSecrets) return { ok: false, error: parsedSecrets.error };
			secrets = parsedSecrets.values;
		} else {
			secrets = extractLegacySecrets(source);
		}
	} else if (Object.prototype.hasOwnProperty.call(raw, "schemaVersion")) {
		try {
			// Validate raw data.json imports against the same schema gate as plugin
			// startup. The field sanitizer below still keeps import partial.
			const decoded = decodePodNotesData(raw);
			if (decoded.sourceVersion < PODNOTES_DATA_SCHEMA_VERSION) {
				secrets = extractLegacySecrets(source);
			}
		} catch (error) {
			if (error instanceof PodNotesDataError) {
				return { ok: false, error: error.message };
			}
			throw error;
		}
	} else {
		secrets = extractLegacySecrets(source);
	}

	const settings = portable(sanitizeImportedSettings(source));

	if (Object.keys(settings).length === 0 && Object.keys(secrets).length === 0) {
		return {
			ok: false,
			error: "No recognizable PodNotes settings were found in the file.",
		};
	}

	return {
		ok: true,
		settings,
		secrets,
		meta: {
			fromEnvelope,
			version,
			pluginVersion,
			includesSecret: Object.keys(secrets).length > 0,
		},
	};
}

/**
 * Merge validated imported settings over the current settings. Vault-local
 * state is untouched because it is never present in `imported`. Nested
 * objects are backfilled from defaults so a partial/hand-edited file cannot blank
 * out fields the rest of the plugin assumes exist (e.g. `timestamp.template`).
 */
export function mergeImportedSettings(
	current: IPodNotesSettings,
	imported: Partial<IPodNotesSettings>,
): IPodNotesSettings {
	const merged: IPodNotesSettings = {
		...current,
		...imported,
		playedEpisodes: { ...imported.playedEpisodes, ...current.playedEpisodes },
	};

	for (const key of NESTED_KEYS) {
		merged[key] = {
			...(DEFAULT_SETTINGS[key] as object),
			...(current[key] as object),
			...(imported[key] as object | undefined),
		} as never;
	}
	// The speaker settings a file leaves out stay, as does the provider that versions up
	// to 2.24.0 store beside them.
	merged.transcript.diarization = {
		...current.transcript.diarization,
		...imported.transcript?.diarization,
	};

	// Converge import and startup on the same deep validators and date revival.
	// Mark the in-memory merge as current so it cannot be mistaken for a legacy
	// data migration while preserving the import envelope's independent version.
	return decodePodNotesData({ ...merged, schemaVersion: PODNOTES_DATA_SCHEMA_VERSION }).settings;
}

function sanitizeImportedSettings(source: Record<string, unknown>): Partial<IPodNotesSettings> {
	const out: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(source)) {
		if (DANGEROUS_KEYS.has(key)) continue;
		if (!IMPORTABLE_KEYS.has(key)) continue;

		const defaultValue = DEFAULT_SETTINGS[key as keyof IPodNotesSettings];
		// Allow-listing by key name is not enough: a malformed or hand-edited file
		// could carry a wrong-typed value (e.g. a string volume, or a numeric
		// note.path) that would later break the volume slider or crash note
		// creation. Drop anything whose type does not match the default.
		if (!typeMatchesDefault(defaultValue, value)) continue;

		if ((NESTED_KEYS as readonly string[]).includes(key)) {
			const nested = sanitizeNestedObject(
				{
					...(defaultValue as object),
					...OPTIONAL_NESTED_FIELDS[key],
				},
				value as Record<string, unknown>,
			);
			out[key] = key === "transcript" ? withReleasedProvider(nested) : nested;
		} else if (key === "favorites") {
			// Built-in playlist objects must carry an `episodes` array; consumers
			// iterate it without guarding. Drop the key when it's malformed so the merge falls
			// back to the default rather than crashing the UI.
			if (Array.isArray((value as { episodes?: unknown }).episodes)) {
				out[key] = value;
			}
		} else if (key === "playlists") {
			// Map of name -> Playlist; keep only entries whose episodes is an array
			// so one malformed entry can't take down the whole import (or the grid).
			out[key] = sanitizePlaylistMap(value as Record<string, unknown>);
		} else {
			out[key] = value;
		}
	}

	return out;
}

/**
 * A file from a version up to 2.24.0 names no transcription provider. Speaker labels with
 * Deepgram is the one provider choice it can hold, so that carries over. Any other file
 * leaves the library's provider as it is.
 */
function withReleasedProvider(transcript: Record<string, unknown>): Record<string, unknown> {
	const { provider, diarization } = transcript;
	return typeof provider !== "string" && isPlainObject(diarization) && choseDeepgram(diarization)
		? { ...transcript, provider: "deepgram", model: "" }
		: transcript;
}

function extractLegacySecrets(source: Record<string, unknown>): CredentialValues {
	const values: CredentialValues = {};

	for (const [legacyKey, credentialKey] of Object.entries(LEGACY_SECRET_KEYS) as Array<
		[keyof typeof LEGACY_SECRET_KEYS, keyof CredentialValues]
	>) {
		const value = source[legacyKey];
		if (typeof value === "string" && value.trim()) values[credentialKey] = value.trim();
	}

	return values;
}

function parseSecretsPayload(value: unknown): { values: CredentialValues } | { error: string } {
	if (value === undefined) return { values: {} };
	if (!isPlainObject(value)) {
		return { error: "Export file has an invalid secrets payload." };
	}

	for (const kind of CREDENTIAL_KINDS) {
		const { exportKey, label } = CREDENTIALS[kind];
		if (value[exportKey] !== undefined && typeof value[exportKey] !== "string") {
			return { error: `Export file has an invalid ${label} API key.` };
		}
	}

	return { values: normalizeSecrets(value) };
}

function normalizeSecrets(values: CredentialValues): CredentialValues {
	const normalized: CredentialValues = {};
	for (const kind of CREDENTIAL_KINDS) {
		const key = CREDENTIALS[kind].exportKey;
		const value = values[key]?.trim();
		if (value) normalized[key] = value;
	}
	return normalized;
}

/** Drop any playlist entry that isn't a plain object with an `episodes` array. */
function sanitizePlaylistMap(value: Record<string, unknown>): Record<string, unknown> {
	const out = ownRecord<unknown>();

	for (const [name, playlist] of Object.entries(value)) {
		if (!isPlainObject(playlist)) continue;
		if (!Array.isArray(playlist.episodes)) continue;
		out[name] = playlist;
	}

	return out;
}

/** Keep only nested fields whose type matches the default; merge backfills the rest. */
function sanitizeNestedObject(
	defaults: Record<string, unknown>,
	value: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};

	for (const [key, fieldValue] of Object.entries(value)) {
		if (DANGEROUS_KEYS.has(key)) continue;
		if (!(key in defaults)) continue;
		if (!typeMatchesDefault(defaults[key], fieldValue)) continue;
		out[key] = fieldValue;
	}

	return out;
}

function typeMatchesDefault(defaultValue: unknown, value: unknown): boolean {
	if (defaultValue === null || defaultValue === undefined) return false;
	if (Array.isArray(defaultValue)) return Array.isArray(value);
	if (typeof defaultValue === "object") return isPlainObject(value);
	return typeof value === typeof defaultValue;
}
