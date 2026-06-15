import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./constants";
import {
	LEGACY_EMPTY_DOWNLOAD_PATH,
	migrateDownloadPath,
} from "./settingsMigrations";

describe("download path default (#183)", () => {
	it("is non-empty and contains a per-episode {{title}} token", () => {
		expect(DEFAULT_SETTINGS.download.path).not.toBe("");
		expect(DEFAULT_SETTINGS.download.path).toMatch(/\{\{\s*title\b/i);
	});

	it("groups by podcast", () => {
		expect(DEFAULT_SETTINGS.download.path).toMatch(/\{\{\s*podcast\b/i);
	});
});

describe("migrateDownloadPath (#183)", () => {
	it("upgrades the legacy empty default to the current per-episode default", () => {
		expect(migrateDownloadPath(LEGACY_EMPTY_DOWNLOAD_PATH)).toBe(
			DEFAULT_SETTINGS.download.path,
		);
		expect(migrateDownloadPath("")).toBe(DEFAULT_SETTINGS.download.path);
	});

	it("treats an absent value (undefined/null) as the legacy default", () => {
		expect(migrateDownloadPath(undefined)).toBe(
			DEFAULT_SETTINGS.download.path,
		);
		// null is reachable via a corrupted/hand-edited data.json; mapping it to the
		// default also keeps null out of DownloadPathTemplateEngine (would crash).
		expect(migrateDownloadPath(null)).toBe(DEFAULT_SETTINGS.download.path);
	});

	it("preserves any non-empty custom path verbatim", () => {
		expect(migrateDownloadPath("inputs/{{podcast}} - {{title}}")).toBe(
			"inputs/{{podcast}} - {{title}}",
		);
		// Even an unusual (token-less) path the user chose is preserved — the
		// migration only ever touches the exact legacy empty value.
		expect(migrateDownloadPath("Downloads")).toBe("Downloads");
	});

	it("is idempotent on the current default", () => {
		const once = migrateDownloadPath(DEFAULT_SETTINGS.download.path);
		expect(migrateDownloadPath(once)).toBe(DEFAULT_SETTINGS.download.path);
	});
});
