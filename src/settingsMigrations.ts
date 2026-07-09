import { DEFAULT_SETTINGS } from "./constants";
import { DIARIZATION_PROVIDERS, type DiarizationProviderId } from "./services/diarization/types";
import type { IPodNotesSettings } from "./types/IPodNotesSettings";

/**
 * Settings migrations applied when settings are loaded from disk.
 *
 * These run in `PodNotes.loadSettings` after the persisted `data.json` is merged
 * over `DEFAULT_SETTINGS`. Changing a default alone is NOT enough for existing
 * users: the plugin persists the whole settings object, so anyone who has used
 * PodNotes already has the old value written to `data.json`, which overrides the
 * new default on load. A migration rewrites that stored value in memory so the
 * change actually reaches existing users (it is re-persisted on the next save).
 *
 * This module is pure (no Obsidian/UI dependencies) so the risky rewrite logic is
 * unit-testable.
 */

/**
 * The download path used to default to "" (empty). With an empty template the
 * Download command resolved every episode to ".mp3" at the vault root — a dotfile
 * Obsidian never indexes, so the first download wrote junk and the second threw
 * "File already exists" (issue #183). Users who never customized the path have
 * this exact value persisted, so simply changing the default does not help them.
 */
export const LEGACY_EMPTY_DOWNLOAD_PATH = "";

/**
 * Upgrades the legacy empty download path to the current per-episode default.
 *
 * ONLY the exact legacy empty value (or an absent value) is migrated, so any
 * non-empty path the user deliberately configured is preserved untouched — even
 * an unusual one. An empty path is always broken (it can only ever write the
 * ".mp3" dotfile), so replacing it is strictly an improvement.
 *
 * `null`/`undefined` are treated as absence (a missing key, or a corrupted /
 * hand-edited data.json), not as a configured path: they map to the default both
 * to apply the intended value and to keep a `null` from reaching
 * DownloadPathTemplateEngine, where `null.replace(...)` would throw.
 */
export function migrateDownloadPath(storedPath: string | null | undefined): string {
	if (
		storedPath === undefined ||
		storedPath === null ||
		storedPath === LEGACY_EMPTY_DOWNLOAD_PATH
	) {
		return DEFAULT_SETTINGS.download.path;
	}

	return storedPath;
}

/**
 * The episode note path and template both used to default to "" (empty). With an
 * empty path OR an empty template the "Create episode note" command is disabled
 * (`src/main.ts` gates it on both being non-empty), so a fresh install could not
 * create episode notes at all until the user hand-wrote a template. Issue #160
 * gives both a Bases-friendly default. Users who never touched note settings have
 * the legacy empty note `{ path: "", template: "" }` persisted in `data.json`,
 * which overrides the new default on load, so it is migrated to the new default.
 */
type StoredNote = { path?: string | null; template?: string | null };

/**
 * Upgrades the legacy empty episode-note settings to the current Bases-friendly
 * default, preserving any configuration the user made.
 *
 * The migration fires ONLY when the WHOLE note is the legacy default — both path
 * and template empty/absent — i.e. the exact value a never-configured install has
 * persisted. The moment the user has set EITHER field, the note feature has been
 * engaged, so both fields are preserved verbatim — including a deliberately empty
 * field a user relies on to keep "Create episode note" disabled (the command
 * gates on emptiness). This is the conservative reading of "migrate only when the
 * stored value is still the old default": a partially-configured note is not the
 * old default and is never silently overwritten.
 *
 * `null`/`undefined` fields (a missing key or hand-edited `data.json`) are
 * coalesced to "" both so a fully-empty/absent note still upgrades and so a `null`
 * never reaches FilePathTemplateEngine, where `null.replace(...)` would throw.
 */
export function migrateNoteSettings(storedNote: StoredNote | null | undefined): {
	path: string;
	template: string;
} {
	const path = storedNote?.path ?? "";
	const template = storedNote?.template ?? "";

	if (path === "" && template === "") {
		return {
			path: DEFAULT_SETTINGS.note.path,
			template: DEFAULT_SETTINGS.note.template,
		};
	}

	return { path, template };
}

type StoredTranscript = {
	path?: string | null;
	template?: string | null;
	diarization?: {
		enabled?: unknown;
		provider?: unknown;
		speakerTemplate?: unknown;
	} | null;
};

/**
 * Backfill the transcript settings with the diarization defaults (issue #168).
 *
 * `loadSettings` replaces the whole persisted `transcript` object, so an existing
 * user who has `{ path, template }` saved would otherwise get an `undefined`
 * `transcript.diarization` and crash where the service reads it. This deep-merges
 * the new nested default while preserving any path/template the user configured,
 * and clamps a malformed/unknown provider back to the default so a hand-edited or
 * corrupted `data.json` can't select a provider that does not exist.
 *
 * Pure (no Obsidian/UI deps) so the merge is unit-testable.
 */
export function migrateTranscriptSettings(
	storedTranscript: StoredTranscript | null | undefined,
): IPodNotesSettings["transcript"] {
	const defaults = DEFAULT_SETTINGS.transcript;
	const stored = storedTranscript ?? {};
	const storedDiarization = stored.diarization ?? {};

	return {
		path: typeof stored.path === "string" ? stored.path : defaults.path,
		template: typeof stored.template === "string" ? stored.template : defaults.template,
		diarization: {
			enabled:
				typeof storedDiarization.enabled === "boolean"
					? storedDiarization.enabled
					: defaults.diarization.enabled,
			provider: sanitizeDiarizationProvider(storedDiarization.provider),
			speakerTemplate:
				typeof storedDiarization.speakerTemplate === "string"
					? storedDiarization.speakerTemplate
					: defaults.diarization.speakerTemplate,
		},
	};
}

function sanitizeDiarizationProvider(value: unknown): DiarizationProviderId {
	return DIARIZATION_PROVIDERS.includes(value as DiarizationProviderId)
		? (value as DiarizationProviderId)
		: DEFAULT_SETTINGS.transcript.diarization.provider;
}

type StoredFeedNote = { path?: string | null; template?: string | null };

/**
 * Backfill the feed-note settings so a partially-persisted `feedNote` is repaired
 * on load (issue ST-08). `loadSettings` shallow-merges the persisted object over
 * the default, so an old `data.json` holding only `{ path }` (or a hand-edited one
 * with a `null` field) would leave `template` undefined and crash where
 * createFeedNote calls `template.replace(...)`. This coalesces any missing/null/
 * non-string field back to the default while preserving a deliberately empty
 * string (mirrors migrateTranscriptSettings). Pure, so it is unit-testable.
 */
export function migrateFeedNoteSettings(
	stored: StoredFeedNote | null | undefined,
): IPodNotesSettings["feedNote"] {
	const s = stored ?? {};
	return {
		path: typeof s.path === "string" ? s.path : DEFAULT_SETTINGS.feedNote.path,
		template: typeof s.template === "string" ? s.template : DEFAULT_SETTINGS.feedNote.template,
	};
}

/**
 * Repair a persisted skip length. A cleared settings field used to store NaN
 * (Number.parseInt("")), which JSON serializes to null; either value would feed
 * the skip arithmetic and corrupt the playback position. Coalesce any
 * non-finite/non-positive value back to the default (issue PB-02). Pure.
 */
export function migrateSkipLength(value: unknown, fallback: number): number {
	const n = typeof value === "number" ? value : Number(value);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
