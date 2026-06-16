import { DEFAULT_SETTINGS } from "./constants";

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
export function migrateDownloadPath(
	storedPath: string | null | undefined,
): string {
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
 * gives both a Bases-friendly default. Users who never customized these have the
 * exact empty value persisted in `data.json`, which overrides the new default on
 * load, so each is migrated independently from the legacy empty value.
 */
export const LEGACY_EMPTY_NOTE_PATH = "";
export const LEGACY_EMPTY_NOTE_TEMPLATE = "";

/**
 * Upgrades the legacy empty episode-note path to the current Bases-friendly
 * default, preserving any non-empty path the user configured.
 *
 * ONLY the exact legacy empty value (or an absent value) is migrated. An empty
 * path leaves the note command disabled, so replacing it is strictly an
 * improvement — the command stays manual, so an existing user is never forced to
 * create notes, they simply gain the option with a sensible default.
 * `null`/`undefined` (a missing key or hand-edited `data.json`) map to the default
 * both to apply the intended value and to keep a `null` from reaching
 * FilePathTemplateEngine, where `null.replace(...)` would throw.
 */
export function migrateNotePath(
	storedPath: string | null | undefined,
): string {
	if (
		storedPath === undefined ||
		storedPath === null ||
		storedPath === LEGACY_EMPTY_NOTE_PATH
	) {
		return DEFAULT_SETTINGS.note.path;
	}

	return storedPath;
}

/**
 * Upgrades the legacy empty episode-note template to the current Bases-friendly
 * default, preserving any non-empty template the user configured. Migrated
 * independently of the path so customizing one field never resets the other.
 */
export function migrateNoteTemplate(
	storedTemplate: string | null | undefined,
): string {
	if (
		storedTemplate === undefined ||
		storedTemplate === null ||
		storedTemplate === LEGACY_EMPTY_NOTE_TEMPLATE
	) {
		return DEFAULT_SETTINGS.note.template;
	}

	return storedTemplate;
}
