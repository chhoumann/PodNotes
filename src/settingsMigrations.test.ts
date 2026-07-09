import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./constants";
import {
	LEGACY_EMPTY_DOWNLOAD_PATH,
	migrateDownloadPath,
	migrateFeedNoteSettings,
	migrateNoteSettings,
	migrateSkipLength,
	migrateTranscriptSettings,
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
		expect(migrateDownloadPath(undefined)).toBe(DEFAULT_SETTINGS.download.path);
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
		expect(template.indexOf("\n---\n")).toBeLessThan(template.indexOf("# {{title}}"));
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
		expect(migrateNoteSettings({ path: "", template: "" })).toEqual(DEFAULT_NOTE);
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
		expect(migrateNoteSettings({ path: null, template: null })).toEqual(DEFAULT_NOTE);
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
		expect(migrateNoteSettings({ path: "Custom/{{title}}.md", template: "" })).toEqual({
			path: "Custom/{{title}}.md",
			template: "",
		});
		expect(migrateNoteSettings({ path: "", template: "## {{title}}" })).toEqual({
			path: "",
			template: "## {{title}}",
		});
	});

	it("is idempotent on the current default", () => {
		const once = migrateNoteSettings(DEFAULT_NOTE);
		expect(migrateNoteSettings(once)).toEqual(DEFAULT_NOTE);
	});
});

describe("migrateTranscriptSettings (#168)", () => {
	const DEFAULT_DIARIZATION = DEFAULT_SETTINGS.transcript.diarization;

	it("backfills diarization defaults onto a legacy { path, template } transcript", () => {
		const legacy = {
			path: "transcripts/{{title}}.md",
			template: "# {{title}}\n\n{{transcript}}",
		};

		expect(migrateTranscriptSettings(legacy)).toEqual({
			path: legacy.path,
			template: legacy.template,
			diarization: DEFAULT_DIARIZATION,
		});
	});

	it("treats an absent transcript (undefined/null) as all defaults", () => {
		expect(migrateTranscriptSettings(undefined)).toEqual(DEFAULT_SETTINGS.transcript);
		expect(migrateTranscriptSettings(null)).toEqual(DEFAULT_SETTINGS.transcript);
	});

	it("preserves a fully-configured diarization block verbatim", () => {
		const stored = {
			path: "t/{{title}}.md",
			template: "{{transcript}}",
			diarization: {
				enabled: true,
				provider: "deepgram" as const,
				speakerTemplate: "Speaker {{speaker}}: ",
			},
		};

		expect(migrateTranscriptSettings(stored)).toEqual(stored);
	});

	it("clamps a malformed/unknown provider back to the default", () => {
		const result = migrateTranscriptSettings({
			path: "t.md",
			template: "{{transcript}}",
			diarization: { enabled: true, provider: "macwhisper", speakerTemplate: "x" },
		});

		expect(result.diarization.provider).toBe(DEFAULT_DIARIZATION.provider);
		expect(result.diarization.enabled).toBe(true);
	});

	it("coalesces non-boolean enabled / non-string fields to defaults", () => {
		const result = migrateTranscriptSettings({
			path: null,
			template: undefined,
			diarization: { enabled: "yes", provider: 5, speakerTemplate: 42 },
		} as never);

		expect(result.path).toBe(DEFAULT_SETTINGS.transcript.path);
		expect(result.template).toBe(DEFAULT_SETTINGS.transcript.template);
		expect(result.diarization).toEqual(DEFAULT_DIARIZATION);
	});

	it("is idempotent on the current default", () => {
		const once = migrateTranscriptSettings(DEFAULT_SETTINGS.transcript);
		expect(migrateTranscriptSettings(once)).toEqual(DEFAULT_SETTINGS.transcript);
	});
});

describe("migrateFeedNoteSettings (ST-08)", () => {
	const DEFAULT_FEED_NOTE = {
		path: DEFAULT_SETTINGS.feedNote.path,
		template: DEFAULT_SETTINGS.feedNote.template,
	};

	it("backfills a missing template on a partial feedNote", () => {
		expect(migrateFeedNoteSettings({ path: "Podcasts/{{podcast}}.md" })).toEqual({
			path: "Podcasts/{{podcast}}.md",
			template: DEFAULT_SETTINGS.feedNote.template,
		});
	});

	it("treats an absent/empty feedNote as all defaults", () => {
		expect(migrateFeedNoteSettings(undefined)).toEqual(DEFAULT_FEED_NOTE);
		expect(migrateFeedNoteSettings(null)).toEqual(DEFAULT_FEED_NOTE);
		expect(migrateFeedNoteSettings({})).toEqual(DEFAULT_FEED_NOTE);
	});

	it("coalesces null/non-string fields so they never reach template.replace()", () => {
		expect(migrateFeedNoteSettings({ path: null, template: null })).toEqual(DEFAULT_FEED_NOTE);
	});

	it("preserves a fully-configured feedNote verbatim", () => {
		const custom = { path: "Feeds/{{podcast}}.md", template: "# {{title}}" };
		expect(migrateFeedNoteSettings(custom)).toEqual(custom);
	});
});

describe("migrateSkipLength (PB-02)", () => {
	it("preserves a valid positive length", () => {
		expect(migrateSkipLength(30, 15)).toBe(30);
		expect(migrateSkipLength("45", 15)).toBe(45);
	});

	it("falls back to the default for NaN/null/zero/negative", () => {
		// A cleared field serializes NaN -> null in data.json.
		expect(migrateSkipLength(Number.NaN, 15)).toBe(15);
		expect(migrateSkipLength(null, 15)).toBe(15);
		expect(migrateSkipLength(undefined, 15)).toBe(15);
		expect(migrateSkipLength(0, 15)).toBe(15);
		expect(migrateSkipLength(-5, 15)).toBe(15);
		expect(migrateSkipLength("abc", 15)).toBe(15);
	});

	it("floors fractional values", () => {
		expect(migrateSkipLength(12.9, 15)).toBe(12);
	});
});
