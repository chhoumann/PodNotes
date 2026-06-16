import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./constants";
import {
	LEGACY_EMPTY_DOWNLOAD_PATH,
	LEGACY_EMPTY_NOTE_PATH,
	LEGACY_EMPTY_NOTE_TEMPLATE,
	migrateDownloadPath,
	migrateNotePath,
	migrateNoteTemplate,
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

describe("migrateNotePath (#160)", () => {
	it("upgrades the legacy empty path to the current default", () => {
		expect(migrateNotePath(LEGACY_EMPTY_NOTE_PATH)).toBe(
			DEFAULT_SETTINGS.note.path,
		);
		expect(migrateNotePath("")).toBe(DEFAULT_SETTINGS.note.path);
	});

	it("treats an absent value (undefined/null) as the legacy default", () => {
		expect(migrateNotePath(undefined)).toBe(DEFAULT_SETTINGS.note.path);
		// null is reachable via a corrupted/hand-edited data.json; mapping it to the
		// default also keeps null out of FilePathTemplateEngine (would crash).
		expect(migrateNotePath(null)).toBe(DEFAULT_SETTINGS.note.path);
	});

	it("preserves any non-empty custom path verbatim", () => {
		expect(migrateNotePath("inputs/podcasts/{{podcast}} - {{title}}.md")).toBe(
			"inputs/podcasts/{{podcast}} - {{title}}.md",
		);
		expect(migrateNotePath("Notes")).toBe("Notes");
	});

	it("is idempotent on the current default", () => {
		const once = migrateNotePath(DEFAULT_SETTINGS.note.path);
		expect(migrateNotePath(once)).toBe(DEFAULT_SETTINGS.note.path);
	});
});

describe("migrateNoteTemplate (#160)", () => {
	it("upgrades the legacy empty template to the current default", () => {
		expect(migrateNoteTemplate(LEGACY_EMPTY_NOTE_TEMPLATE)).toBe(
			DEFAULT_SETTINGS.note.template,
		);
		expect(migrateNoteTemplate("")).toBe(DEFAULT_SETTINGS.note.template);
	});

	it("treats an absent value (undefined/null) as the legacy default", () => {
		expect(migrateNoteTemplate(undefined)).toBe(
			DEFAULT_SETTINGS.note.template,
		);
		expect(migrateNoteTemplate(null)).toBe(DEFAULT_SETTINGS.note.template);
	});

	it("preserves any non-empty custom template verbatim", () => {
		const custom = "## {{title}}\n{{description}}";
		expect(migrateNoteTemplate(custom)).toBe(custom);
	});

	it("migrates path and template independently", () => {
		// A user who customized only the path keeps it while still gaining the new
		// template default (and vice versa) — neither field resets the other.
		expect(migrateNotePath("Custom/{{title}}.md")).toBe("Custom/{{title}}.md");
		expect(migrateNoteTemplate("")).toBe(DEFAULT_SETTINGS.note.template);
	});

	it("is idempotent on the current default", () => {
		const once = migrateNoteTemplate(DEFAULT_SETTINGS.note.template);
		expect(migrateNoteTemplate(once)).toBe(DEFAULT_SETTINGS.note.template);
	});
});
