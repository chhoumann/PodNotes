import { DEFAULT_SETTINGS } from "./constants";
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
export const SETTINGS_EXPORT_VERSION = 1;

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

/**
 * API keys are only exported when the user explicitly opts in. Both the OpenAI
 * key and the dedicated diarization (Deepgram) key are top-level so they can be
 * redacted by name here; the diarization key is deliberately NOT nested inside
 * `transcript` (a wholesale-copied nested key) so it can never leak (#168).
 */
export const SECRET_KEYS: ReadonlySet<keyof IPodNotesSettings> = new Set([
	"openAIApiKey",
	"diarizationApiKey",
]);

/** Keys that, if copied into the settings object, could pollute Object.prototype. */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Known top-level setting keys that are safe to import (excludes runtime state). */
const IMPORTABLE_KEYS = new Set(
	Object.keys(DEFAULT_SETTINGS).filter(
		(key) => !EXCLUDED_KEYS.includes(key as keyof IPodNotesSettings),
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
	settings: Partial<IPodNotesSettings>;
}

export interface ExportOptions {
	/** Include the (plaintext) OpenAI API key in the export. */
	includeSecret: boolean;
}

export type ParseResult =
	| {
			ok: true;
			settings: Partial<IPodNotesSettings>;
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
 * allow-listed keys by name (never spreading the whole object). Runtime state is
 * always excluded; the API key is excluded unless `opts.includeSecret` is set.
 */
export function serializeSettings(
	settings: IPodNotesSettings,
	opts: ExportOptions,
	pluginVersion: string,
	nowISO: string,
): SettingsEnvelope {
	const out: Record<string, unknown> = {};

	for (const key of Object.keys(settings)) {
		if (DANGEROUS_KEYS.has(key)) continue;
		if (!IMPORTABLE_KEYS.has(key)) continue;
		if (SECRET_KEYS.has(key as keyof IPodNotesSettings) && !opts.includeSecret)
			continue;
		out[key] = settings[key as keyof IPodNotesSettings];
	}

	return {
		type: SETTINGS_EXPORT_TYPE,
		version: SETTINGS_EXPORT_VERSION,
		pluginVersion,
		exportedAt: nowISO,
		settings: out as Partial<IPodNotesSettings>,
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

	if (raw.type === SETTINGS_EXPORT_TYPE) {
		fromEnvelope = true;

		if (
			typeof raw.version !== "number" ||
			!Number.isInteger(raw.version) ||
			raw.version < 1
		) {
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
	}

	const settings = sanitizeImportedSettings(source);

	if (Object.keys(settings).length === 0) {
		return {
			ok: false,
			error: "No recognizable PodNotes settings were found in the file.",
		};
	}

	return {
		ok: true,
		settings,
		meta: {
			fromEnvelope,
			version,
			pluginVersion,
			includesSecret: [...SECRET_KEYS].some((key) => key in settings),
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

	return merged;
}

function sanitizeImportedSettings(
	source: Record<string, unknown>,
): Partial<IPodNotesSettings> {
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
		} else {
			out[key] = value;
		}
	}

	return out as Partial<IPodNotesSettings>;
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
