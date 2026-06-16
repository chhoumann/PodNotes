import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./constants";
import {
	LEGACY_EMPTY_DOWNLOAD_PATH,
	migrateDownloadPath,
	migrateNoteSettings,
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

describe("episode note defaults (#160)", () => {
	it("ships a non-empty path with per-episode and per-podcast tokens", () => {
		expect(DEFAULT_SETTINGS.note.path).not.toBe("");
		expect(DEFAULT_SETTINGS.note.path).toMatch(/\{\{\s*title\b/i);
		expect(DEFAULT_SETTINGS.note.path).toMatch(/\{\{\s*podcast\b/i);
	});

	it("ships a non-empty Bases-friendly template with frontmatter", () => {
		const template = DEFAULT_SETTINGS.note.template;
		expect(template).not.toBe("");
		// Opens with a YAML frontmatter block...
		expect(template.startsWith("---\n")).toBe(true);
		// ...that closes before the body H1.
		expect(template.indexOf("\n---\n")).toBeLessThan(
			template.indexOf("# {{title}}"),
		);
		// Carries the structured properties Bases sorts/filters on.
		expect(template).toContain("type: podcastEpisode");
		expect(template).toMatch(/^tags:/m);
	});
});

describe("migrateNoteSettings (#160)", () => {
	const DEFAULT_NOTE = {
		path: DEFAULT_SETTINGS.note.path,
		template: DEFAULT_SETTINGS.note.template,
	};

	it("upgrades the legacy empty note (both fields empty) to the default", () => {
		expect(migrateNoteSettings({ path: "", template: "" })).toEqual(
			DEFAULT_NOTE,
		);
	});

	it("treats an absent note (undefined/null/empty object) as the legacy default", () => {
		expect(migrateNoteSettings(undefined)).toEqual(DEFAULT_NOTE);
		expect(migrateNoteSettings(null)).toEqual(DEFAULT_NOTE);
		expect(migrateNoteSettings({})).toEqual(DEFAULT_NOTE);
	});

	it("coalesces null/undefined fields and still upgrades a fully-absent note", () => {
		// A corrupted/hand-edited data.json could carry nulls; they must not reach
		// the path/template engines (null.replace would throw) and a wholly-empty
		// note still upgrades.
		expect(migrateNoteSettings({ path: null, template: null })).toEqual(
			DEFAULT_NOTE,
		);
	});

	it("preserves a fully-configured note verbatim", () => {
		const custom = {
			path: "inputs/podcasts/{{podcast}} - {{title}}.md",
			template: "## {{title}}\n{{description}}",
		};
		expect(migrateNoteSettings(custom)).toEqual(custom);
	});

	it("never overwrites a deliberately-empty field once the user configured the other", () => {
		// Custom path + empty template = note creation deliberately disabled; the
		// empty template must NOT be filled with the new default (would re-enable
		// the command). Symmetric for a custom template + empty path.
		expect(
			migrateNoteSettings({ path: "Custom/{{title}}.md", template: "" }),
		).toEqual({ path: "Custom/{{title}}.md", template: "" });
		expect(
			migrateNoteSettings({ path: "", template: "## {{title}}" }),
		).toEqual({ path: "", template: "## {{title}}" });
	});

	it("is idempotent on the current default", () => {
		const once = migrateNoteSettings(DEFAULT_NOTE);
		expect(migrateNoteSettings(once)).toEqual(DEFAULT_NOTE);
	});
});
