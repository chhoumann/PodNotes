import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./constants";
import {
	EXCLUDED_KEYS,
	SETTINGS_EXPORT_TYPE,
	SETTINGS_EXPORT_VERSION,
	describeSecrets,
	mergeImportedSettings,
	parseImport,
	serializeSettings,
} from "./settingsTransfer";
import type { IPodNotesSettings } from "./types/IPodNotesSettings";

function makeSettings(overrides: Partial<IPodNotesSettings> = {}): IPodNotesSettings {
	return structuredClone({ ...DEFAULT_SETTINGS, ...overrides });
}

const NOW = "2026-06-14T00:00:00.000Z";

describe("serializeSettings", () => {
	it("wraps settings in a versioned envelope", () => {
		const envelope = serializeSettings(makeSettings(), {}, "2.16.0", NOW);

		expect(envelope.type).toBe(SETTINGS_EXPORT_TYPE);
		expect(envelope.version).toBe(SETTINGS_EXPORT_VERSION);
		expect(envelope.pluginVersion).toBe("2.16.0");
		expect(envelope.exportedAt).toBe(NOW);
	});

	it("excludes runtime/vault-specific state even when populated", () => {
		const settings = makeSettings({
			playedEpisodes: {
				ep: { title: "ep", podcastName: "p", time: 1, duration: 2, finished: false },
			},
			podNotes: { ep: { title: "ep", podcastName: "p" } as never },
			downloadedEpisodes: { p: [] },
			currentEpisode: { title: "ep" } as never,
		});

		const { settings: exported } = serializeSettings(settings, {}, "2.16.0", NOW);

		for (const key of EXCLUDED_KEYS) {
			expect(exported).not.toHaveProperty(key as string);
		}
	});

	it("keeps SecretStorage references out and puts opted-in values in a separate payload", () => {
		const settings = makeSettings({ openAISecretId: "podnotes-openai-api-key" });

		const ordinary = serializeSettings(settings, {}, "2.16.0", NOW);
		expect(ordinary.settings).not.toHaveProperty("openAISecretId");
		expect(ordinary).not.toHaveProperty("secrets");

		const withKey = serializeSettings(
			settings,
			{ secrets: { openAI: "sk-secret" } },
			"2.16.0",
			NOW,
		);
		expect(withKey.settings).not.toHaveProperty("openAISecretId");
		expect(withKey.secrets).toEqual({ openAI: "sk-secret" });
	});

	it("keeps both provider values in the explicit top-level payload (#168)", () => {
		const settings = makeSettings({
			openAISecretId: "podnotes-openai-api-key",
			deepgramSecretId: "podnotes-deepgram-api-key",
		});

		const without = serializeSettings(settings, {}, "2.16.0", NOW);
		expect(without.settings).not.toHaveProperty("openAISecretId");
		expect(without.settings).not.toHaveProperty("deepgramSecretId");

		const withKeys = serializeSettings(
			settings,
			{ secrets: { openAI: "sk-secret", deepgram: "dg-secret" } },
			"2.16.0",
			NOW,
		);
		expect(withKeys.secrets).toEqual({ openAI: "sk-secret", deepgram: "dg-secret" });
		expect(JSON.stringify(withKeys.settings)).not.toContain("secret");
	});

	it("never lets the Deepgram key ride along inside the transcript object (#168)", () => {
		// The key lives top-level precisely so it can be redacted; the nested
		// transcript object (copied wholesale) must never carry a secret.
		const settings = makeSettings({ deepgramSecretId: "podnotes-deepgram-api-key" });
		const { settings: exported } = serializeSettings(settings, {}, "2.16.0", NOW);
		expect(JSON.stringify(exported.transcript ?? {})).not.toContain("dg-secret");
	});

	it("includes preferences, templates, and library", () => {
		const settings = makeSettings({
			note: { path: "notes/{{title}}.md", template: "# {{title}}" },
			savedFeeds: {
				Show: { title: "Show", url: "https://example.com/feed", artworkUrl: "" },
			},
		});

		const { settings: exported } = serializeSettings(settings, {}, "2.16.0", NOW);

		expect(exported.note).toEqual(settings.note);
		expect(exported.savedFeeds).toEqual(settings.savedFeeds);
		expect(exported.timestamp).toEqual(settings.timestamp);
	});

	it("encodes dates inside exported playlists as canonical text", () => {
		const date = new Date("2024-03-01T10:05:03.000Z");
		const settings = makeSettings({
			queue: {
				...DEFAULT_SETTINGS.queue,
				episodes: [
					{
						title: "Queued",
						streamUrl: "queued.mp3",
						url: "",
						description: "",
						content: "",
						podcastName: "Podcast",
						episodeDate: date,
					},
				],
			},
		});

		const exported = serializeSettings(settings, {}, "2.17.3", NOW);
		expect(exported.settings.queue?.episodes[0].episodeDate).toBe(date.toISOString());
	});
});

describe("parseImport", () => {
	it("rejects invalid JSON", () => {
		const result = parseImport("not json {");
		expect(result.ok).toBe(false);
	});

	it("rejects a non-object payload", () => {
		expect(parseImport("[]").ok).toBe(false);
		expect(parseImport("42").ok).toBe(false);
		expect(parseImport("null").ok).toBe(false);
	});

	it("rejects an envelope from a newer format version", () => {
		const result = parseImport(
			JSON.stringify({
				type: SETTINGS_EXPORT_TYPE,
				version: SETTINGS_EXPORT_VERSION + 1,
				settings: { defaultVolume: 0.5 },
			}),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("newer version");
	});

	it("rejects a non-integer or invalid version", () => {
		for (const version of [0, -1, 1.5]) {
			const result = parseImport(
				JSON.stringify({
					type: SETTINGS_EXPORT_TYPE,
					version,
					settings: { defaultVolume: 0.5 },
				}),
			);
			expect(result.ok).toBe(false);
		}
	});

	it("round-trips an exported envelope", () => {
		const settings = makeSettings({
			defaultPlaybackRate: 1.5,
			note: { path: "p", template: "t" },
		});
		const envelope = serializeSettings(settings, {}, "2.16.0", NOW);

		const result = parseImport(JSON.stringify(envelope));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.meta.fromEnvelope).toBe(true);
			expect(result.settings.defaultPlaybackRate).toBe(1.5);
			expect(result.settings.note).toEqual({ path: "p", template: "t" });
		}
	});

	it("accepts a raw settings object and drops excluded runtime keys", () => {
		const raw = makeSettings({
			defaultVolume: 0.3,
			playedEpisodes: {
				ep: { title: "ep", podcastName: "p", time: 1, duration: 2, finished: true },
			},
			currentEpisode: { title: "ep" } as never,
		});

		const result = parseImport(JSON.stringify(raw));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.meta.fromEnvelope).toBe(false);
			expect(result.settings.defaultVolume).toBe(0.3);
			for (const key of EXCLUDED_KEYS) {
				expect(result.settings).not.toHaveProperty(key as string);
			}
		}
	});

	it("drops unknown keys", () => {
		const result = parseImport(JSON.stringify({ defaultVolume: 0.5, somethingElse: true }));
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.settings).not.toHaveProperty("somethingElse");
	});

	it("fails when no recognizable settings remain", () => {
		const result = parseImport(JSON.stringify({ somethingElse: true }));
		expect(result.ok).toBe(false);
	});

	it("rejects a raw data file from a newer persistence schema", () => {
		const result = parseImport(JSON.stringify({ schemaVersion: 3, defaultVolume: 0.5 }));
		expect(result).toEqual(
			expect.objectContaining({ ok: false, error: expect.stringContaining("schema v3") }),
		);
	});

	it("drops a wrong-typed top-level value", () => {
		const result = parseImport(
			JSON.stringify({ defaultVolume: "evil", note: { path: "p", template: "t" } }),
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.settings).not.toHaveProperty("defaultVolume");
			expect(result.settings.note).toEqual({ path: "p", template: "t" });
		}
	});

	it("drops a wrong-typed nested field but keeps valid siblings", () => {
		const result = parseImport(JSON.stringify({ note: { path: 5, template: "keep" } }));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.settings.note).toEqual({ template: "keep" });
		}
	});

	it("rejects a typed envelope without a numeric version", () => {
		const result = parseImport(
			JSON.stringify({
				type: SETTINGS_EXPORT_TYPE,
				settings: { defaultVolume: 0.5 },
			}),
		);
		expect(result.ok).toBe(false);
	});

	it("does not pollute Object.prototype via __proto__", () => {
		const result = parseImport('{"defaultVolume": 0.5, "__proto__": {"polluted": true}}');
		expect(result.ok).toBe(true);
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	it("does not pollute via a malicious envelope payload", () => {
		const result = parseImport(
			`{"type":"${SETTINGS_EXPORT_TYPE}","version":1,"settings":{"constructor":{"x":1},"defaultVolume":0.5}}`,
		);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.settings).not.toHaveProperty("constructor");
		expect(({} as Record<string, unknown>).x).toBeUndefined();
	});

	it("reports whether the import includes the API key", () => {
		const withKey = parseImport(JSON.stringify({ openAIApiKey: "sk-x" }));
		expect(withKey.ok).toBe(true);
		if (withKey.ok) expect(withKey.meta.includesSecret).toBe(true);

		const withoutKey = parseImport(JSON.stringify({ defaultVolume: 0.5 }));
		expect(withoutKey.ok).toBe(true);
		if (withoutKey.ok) expect(withoutKey.meta.includesSecret).toBe(false);
	});

	it("drops an empty/whitespace secret so it cannot clobber a saved key (IE-05)", () => {
		const result = parseImport(
			JSON.stringify({
				defaultVolume: 0.5,
				openAIApiKey: "",
				diarizationApiKey: "   ",
			}),
		);

		expect(result.ok).toBe(true);
		if (result.ok) {
			// An empty secret is treated as absent: not carried into the merge, and
			// not counted as "includes a secret".
			expect(result.settings).not.toHaveProperty("openAIApiKey");
			expect(result.settings).not.toHaveProperty("diarizationApiKey");
			expect(result.meta.includesSecret).toBe(false);
		}
	});

	it("keeps a non-empty imported secret (IE-05)", () => {
		const result = parseImport(JSON.stringify({ openAIApiKey: "sk-real" }));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.settings).not.toHaveProperty("openAIApiKey");
			expect(result.secrets.openAI).toBe("sk-real");
			expect(result.meta.includesSecret).toBe(true);
		}
	});

	it("parses the v2 secrets payload separately from settings", () => {
		const result = parseImport(
			JSON.stringify({
				type: SETTINGS_EXPORT_TYPE,
				version: 2,
				settings: { defaultVolume: 0.5, openAISecretId: "not-transferable" },
				secrets: { openAI: " sk ", deepgram: "dg" },
			}),
		);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.settings).not.toHaveProperty("openAISecretId");
			expect(result.secrets).toEqual({ openAI: "sk", deepgram: "dg" });
		}
	});

	it("rejects a malformed v2 secrets payload", () => {
		const result = parseImport(
			JSON.stringify({
				type: SETTINGS_EXPORT_TYPE,
				version: 2,
				settings: { defaultVolume: 0.5 },
				secrets: { openAI: 42 },
			}),
		);
		expect(result).toEqual(expect.objectContaining({ ok: false }));
	});

	it("extracts legacy values from v1 envelopes but not from v2 data", () => {
		const legacy = parseImport(
			JSON.stringify({
				type: SETTINGS_EXPORT_TYPE,
				version: 1,
				settings: { openAIApiKey: "sk-legacy" },
			}),
		);
		expect(legacy).toEqual(
			expect.objectContaining({ ok: true, secrets: { openAI: "sk-legacy" } }),
		);

		const retiredInV2 = parseImport(
			JSON.stringify({
				schemaVersion: 2,
				defaultVolume: 0.5,
				openAIApiKey: "must-not-return",
			}),
		);
		expect(retiredInV2).toEqual(expect.objectContaining({ ok: true, secrets: {} }));
	});

	it("drops a built-in playlist whose episodes is not an array (PL-10)", () => {
		const result = parseImport(
			JSON.stringify({
				defaultVolume: 0.5,
				favorites: { name: "Favorites", icon: "star", episodes: "boom" },
				localFiles: { name: "Local Files", icon: "folder" },
			}),
		);

		expect(result.ok).toBe(true);
		if (result.ok) {
			// Malformed built-ins are dropped so the merge falls back to the default
			// (which carries episodes: []), instead of feeding the UI a bad shape.
			expect(result.settings).not.toHaveProperty("favorites");
			expect(result.settings).not.toHaveProperty("localFiles");
		}
	});

	it("keeps a well-formed built-in playlist (PL-10)", () => {
		const favorites = {
			name: "Favorites",
			icon: "star",
			shouldEpisodeRemoveAfterPlay: false,
			shouldRepeat: false,
			episodes: [],
		};
		const result = parseImport(JSON.stringify({ favorites }));

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.settings.favorites).toEqual(favorites);
	});

	it("drops only the malformed entries from the playlists map (PL-10)", () => {
		const good = {
			name: "Good",
			icon: "list",
			shouldEpisodeRemoveAfterPlay: false,
			shouldRepeat: false,
			episodes: [],
		};
		const result = parseImport(
			JSON.stringify({
				playlists: {
					Good: good,
					NoEpisodes: { name: "NoEpisodes", icon: "list" },
					BadEpisodes: { name: "BadEpisodes", episodes: 42 },
					NotAnObject: "nope",
				},
			}),
		);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(Object.keys(result.settings.playlists ?? {})).toEqual(["Good"]);
			expect(result.settings.playlists?.Good).toEqual(good);
		}
	});
});

describe("mergeImportedSettings", () => {
	it("overrides preferences while preserving excluded runtime state", () => {
		const current = makeSettings({
			defaultVolume: 1,
			playedEpisodes: {
				ep: { title: "ep", podcastName: "p", time: 5, duration: 9, finished: false },
			},
		});

		const merged = mergeImportedSettings(current, { defaultVolume: 0.25 });

		expect(merged.defaultVolume).toBe(0.25);
		expect(merged.playedEpisodes).toEqual(current.playedEpisodes);
	});

	it("backfills partial nested objects from defaults so no field is blanked", () => {
		const current = makeSettings();
		// A hand-edited file that only sets timestamp.offset.
		const merged = mergeImportedSettings(current, {
			timestamp: { offset: 7 } as never,
		});

		expect(merged.timestamp.offset).toBe(7);
		expect(merged.timestamp.template).toBe(DEFAULT_SETTINGS.timestamp.template);
	});

	it("revives imported playlist dates before hydrating live stores", () => {
		const date = "2024-03-01T10:05:03.000Z";
		const current = makeSettings();
		const merged = mergeImportedSettings(current, {
			queue: {
				...DEFAULT_SETTINGS.queue,
				episodes: [
					{
						title: "Queued",
						streamUrl: "queued.mp3",
						url: "",
						description: "",
						content: "",
						podcastName: "Podcast",
						episodeDate: date as unknown as Date,
					},
				],
			},
		});

		expect(merged.queue.episodes[0].episodeDate).toEqual(new Date(date));
	});

	it("replaces collection settings wholesale rather than merging them", () => {
		const current = makeSettings({
			savedFeeds: {
				B: { title: "B", url: "https://b.example/feed", artworkUrl: "" },
			},
		});

		const merged = mergeImportedSettings(current, {
			savedFeeds: {
				A: { title: "A", url: "https://a.example/feed", artworkUrl: "" },
			},
		});

		expect(Object.keys(merged.savedFeeds)).toEqual(["A"]);
	});

	it("preserves a saved secret when the import omits it (IE-05)", () => {
		const current = makeSettings({
			openAISecretId: "podnotes-openai-api-key-2",
			deepgramSecretId: "podnotes-deepgram-api-key-2",
		});

		// parseImport strips empty secrets, so a raw data.json with blank keys
		// arrives here without them; the merge must keep the configured keys.
		const merged = mergeImportedSettings(current, { defaultVolume: 0.5 });

		expect(merged.openAISecretId).toBe("podnotes-openai-api-key-2");
		expect(merged.deepgramSecretId).toBe("podnotes-deepgram-api-key-2");
	});

	it("keeps the current nested value when the import omits the field", () => {
		const current = makeSettings({
			note: { path: "custom/{{title}}.md", template: "custom" },
		});

		const merged = mergeImportedSettings(current, { defaultVolume: 0.5 });

		expect(merged.note).toEqual({ path: "custom/{{title}}.md", template: "custom" });
	});

	it("backfills a partial feedNote import (path-only) from defaults", () => {
		const current = makeSettings();

		const merged = mergeImportedSettings(current, {
			feedNote: { path: "MyPods/{{podcast}}.md" } as never,
		});

		expect(merged.feedNote.path).toBe("MyPods/{{podcast}}.md");
		expect(merged.feedNote.template).toBe(DEFAULT_SETTINGS.feedNote.template);
	});

	it("clamps an imported invalid diarization provider and backfills its fields (#168)", () => {
		const current = makeSettings();

		const merged = mergeImportedSettings(current, {
			transcript: {
				path: "t/{{title}}.md",
				template: "{{transcript}}",
				diarization: { enabled: true, provider: "macwhisper" },
			} as never,
		});

		// Unknown provider falls back to the default; the missing speakerTemplate is
		// backfilled — the import path converges with the load path (#168).
		expect(merged.transcript.diarization.provider).toBe(
			DEFAULT_SETTINGS.transcript.diarization.provider,
		);
		expect(merged.transcript.diarization.enabled).toBe(true);
		expect(merged.transcript.diarization.speakerTemplate).toBe(
			DEFAULT_SETTINGS.transcript.diarization.speakerTemplate,
		);
	});
});

describe("describeSecrets (#168)", () => {
	it("names only the secrets that actually hold a value", () => {
		expect(describeSecrets({})).toEqual([]);
		expect(describeSecrets({ openAI: "sk" })).toEqual(["OpenAI API key"]);
		expect(describeSecrets({ deepgram: "dg" })).toEqual(["Deepgram API key"]);
		expect(describeSecrets({ openAI: "sk", deepgram: "dg" })).toEqual([
			"OpenAI API key",
			"Deepgram API key",
		]);
	});

	it("ignores whitespace-only secrets", () => {
		expect(describeSecrets({ openAI: "   " })).toEqual([]);
	});
});
