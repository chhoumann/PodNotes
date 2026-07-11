import { DEFAULT_SETTINGS } from "./constants";
import {
	decodePodNotesData,
	encodePodNotesData,
	PODNOTES_DATA_SCHEMA_VERSION,
	type PersistedPodNotesSettings,
	PodNotesDataError,
} from "./persistence/podNotesData";
import type { CredentialValues } from "./types/Credentials";
import type { IPodNotesSettings } from "./types/IPodNotesSettings";

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

/**
 * Runtime / vault-specific state that must never travel between vaults: playback
 * progress, the episode->note path map, on-disk download bookkeeping, and the
 * currently-playing episode. These are excluded from export and dropped on
 * import (so a copied raw `data.json` still imports cleanly as "settings only").
 */
export const EXCLUDED_KEYS: readonly (keyof IPodNotesSettings)[] = [
	"podNotes",
	"playedEpisodes",
	"downloadedEpisodes",
	"currentEpisode",
];

/** SecretStorage references are device-local implementation details, not settings transfer data. */
export const SECRET_REFERENCE_KEYS: ReadonlySet<keyof IPodNotesSettings> = new Set([
	"openAISecretId",
	"deepgramSecretId",
]);

const LEGACY_SECRET_KEYS = {
	openAIApiKey: "openAI",
	diarizationApiKey: "deepgram",
} as const;

/** Human-facing names for each secret, so export/import copy can name exactly
 * which keys leave or enter the vault instead of hard-coding "OpenAI". */
const SECRET_KEY_LABELS: Record<keyof CredentialValues, string> = {
	openAI: "OpenAI API key",
	deepgram: "Deepgram API key",
};

/**
 * The human-facing labels for the secrets actually present (non-empty) in a
 * settings object. Used to keep the export toggle, the export notice, and the
 * import confirmation honest about which keys are involved — so a Deepgram-only
 * user is never told only "OpenAI API key" (and vice versa). See issue #168.
 */
export function describeSecrets(secrets: CredentialValues): string[] {
	return (Object.keys(SECRET_KEY_LABELS) as (keyof CredentialValues)[])
		.filter((key) => Boolean(secrets[key]?.trim()))
		.map((key) => SECRET_KEY_LABELS[key]);
}

/** Keys that, if copied into the settings object, could pollute Object.prototype. */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Known top-level setting keys that are safe to import (excludes runtime state). */
const IMPORTABLE_KEYS = new Set(
	Object.keys(DEFAULT_SETTINGS).filter(
		(key) =>
			!EXCLUDED_KEYS.includes(key as keyof IPodNotesSettings) &&
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
	"feedCache",
];

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

/**
 * Build a versioned export envelope from the live settings, copying only
 * allow-listed keys by name (never spreading the whole object). Runtime state and
 * SecretStorage references are always excluded. Plaintext values appear only in
 * the separate payload explicitly passed by the caller.
 */
/**
 * SecretStorage references are device-local capabilities and never transfer
 * data: an imported urlSecretId is at best meaningless on this device. The
 * private URL itself stays behind (placeholder) unless the source device
 * exports it another way; the feed is re-added on the target device.
 */
function stripFeedUrlSecretReferences(savedFeeds: unknown): unknown {
	if (typeof savedFeeds !== "object" || savedFeeds === null || Array.isArray(savedFeeds)) {
		return savedFeeds;
	}
	const out: Record<string, unknown> = {};
	for (const [key, feed] of Object.entries(savedFeeds)) {
		if (typeof feed === "object" && feed !== null && !Array.isArray(feed)) {
			const rest = { ...(feed as Record<string, unknown>) };
			delete rest.urlSecretId;
			out[key] = rest;
		} else {
			out[key] = feed;
		}
	}
	return out;
}

export function serializeSettings(
	settings: IPodNotesSettings,
	opts: ExportOptions,
	pluginVersion: string,
	nowISO: string,
): SettingsEnvelope {
	const out: Record<string, unknown> = {};
	const persisted = encodePodNotesData(settings);

	for (const key of Object.keys(settings)) {
		if (DANGEROUS_KEYS.has(key)) continue;
		if (!IMPORTABLE_KEYS.has(key)) continue;
		out[key] = persisted[key];
	}
	out.savedFeeds = stripFeedUrlSecretReferences(out.savedFeeds);
	const secrets = normalizeSecrets(opts.secrets ?? {});

	return {
		type: SETTINGS_EXPORT_TYPE,
		version: SETTINGS_EXPORT_VERSION,
		pluginVersion,
		exportedAt: nowISO,
		settings: out as Partial<PersistedPodNotesSettings>,
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

	const settings = sanitizeImportedSettings(source);
	if ("savedFeeds" in settings) {
		(settings as Record<string, unknown>).savedFeeds = stripFeedUrlSecretReferences(
			settings.savedFeeds,
		);
	}

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
 * Merge validated imported settings over the current settings. Runtime state
 * (excluded keys) is untouched because it is never present in `imported`. Nested
 * objects are backfilled from defaults so a partial/hand-edited file cannot blank
 * out fields the rest of the plugin assumes exist (e.g. `timestamp.template`).
 */
export function mergeImportedSettings(
	current: IPodNotesSettings,
	imported: Partial<IPodNotesSettings>,
): IPodNotesSettings {
	const merged: IPodNotesSettings = { ...current, ...imported };

	for (const key of NESTED_KEYS) {
		merged[key] = {
			...(DEFAULT_SETTINGS[key] as object),
			...(current[key] as object),
			...(imported[key] as object | undefined),
		} as never;
	}

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
			out[key] = sanitizeNestedObject(
				defaultValue as Record<string, unknown>,
				value as Record<string, unknown>,
			);
		} else if (key === "favorites" || key === "localFiles") {
			// Built-in playlist objects must carry an `episodes` array; consumers
			// (PlaylistCard, context menu, removeEpisodeFromPlaylists) iterate it
			// without guarding. Drop the key when it's malformed so the merge falls
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

	return out as Partial<IPodNotesSettings>;
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

	for (const key of ["openAI", "deepgram"] as const) {
		if (value[key] !== undefined && typeof value[key] !== "string") {
			return { error: `Export file has an invalid ${SECRET_KEY_LABELS[key]}.` };
		}
	}

	return { values: normalizeSecrets(value as CredentialValues) };
}

function normalizeSecrets(values: CredentialValues): CredentialValues {
	const openAI = values.openAI?.trim();
	const deepgram = values.deepgram?.trim();
	return {
		...(openAI ? { openAI } : {}),
		...(deepgram ? { deepgram } : {}),
	};
}

/** Drop any playlist entry that isn't a plain object with an `episodes` array. */
function sanitizePlaylistMap(value: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};

	for (const [name, playlist] of Object.entries(value)) {
		if (DANGEROUS_KEYS.has(name)) continue;
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
