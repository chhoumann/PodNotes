// @vitest-environment jsdom
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import FeedDocumentParser from "src/parser/feedDocumentParser";
import { FeedRepository } from "src/services/FeedRepository";
import { decodePodNotesData, encodePodNotesData } from "src/persistence/podNotesData";
import { getEpisodeKey } from "src/utility/episodeKey";
import { createLargeV2Fixture } from "../tests/fixtures/persistence/large-v2.mjs";
import { MemoryStorage } from "../tests/mocks/feeds";
import { assertAdditive, measureSnapshot } from "./persistence-size.mjs";

describe("persistence byte fixture", () => {
	it("reports partial-copy metadata as added bytes and a separate regrouping diagnostic", () => {
		const candidate = JSON.parse(JSON.stringify(createLargeV2Fixture()));
		candidate.downloadedEpisodes["Planet Money fixture 01"][0].probe = 1;
		const directory = mkdtempSync(join(tmpdir(), "podnotes-partial-metadata-"));
		try {
			const path = join(directory, "candidate.json");
			writeFileSync(path, JSON.stringify(candidate));
			const result = spawnSync(
				process.execPath,
				[resolve("scripts/persistence-size.mjs"), path],
				{
					encoding: "utf8",
					env: { ...process.env, GITHUB_STEP_SUMMARY: "" },
				},
			);
			expect(result.status).toBe(0);
			expect(result.stdout).toMatch(/\| Total \| 10 \| \d+ \|/);
			expect(result.stdout).toContain("identical-snapshot diagnostic changed by -");
			expect(result.stdout).toContain(
				"This diagnostic is not an optional-field overhead measurement",
			);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("uses the production projection of the frozen real feed without dropping text", async () => {
		const sample = JSON.parse(
			readFileSync("tests/fixtures/persistence/feed-sample.json", "utf8"),
		);
		const xml = readFileSync("tests/fixtures/persistence/planet-money.xml", "utf8");
		const parsed = new FeedDocumentParser().parseEpisodes(xml);
		const feeds = new FeedRepository({
			load: async () => parsed,
			resolveUrl: (feed) => feed.url,
			storage: new MemoryStorage(),
			cache: () => ({ enabled: false, ttlHours: 6 }),
			now: Date.now,
		});
		expect(await feeds.channelAt({ url: sample.source.url })).toEqual(sample.feed);
		expect(JSON.parse(JSON.stringify(await feeds.episodesAt(sample.source.url)))).toEqual(
			sample.episodes.map((episode: object, index: number) => ({
				...episode,
				guid: sample.guids[index],
			})),
		);
	});

	it("retains a complete stress library through the released v2 codec", () => {
		const data = JSON.parse(JSON.stringify(createLargeV2Fixture()));
		const decoded = decodePodNotesData(data);
		expect(decoded.warnings).toEqual([]);
		expect(decoded.changed).toBe(false);
		expect(
			JSON.parse(JSON.stringify(encodePodNotesData(decoded.settings, decoded.unknownFields))),
		).toEqual({ ...data, libraryId: "" });
		expect(Object.keys(data.savedFeeds)).toHaveLength(50);
		expect(Object.keys(data.playedEpisodes)).toHaveLength(2000);
		const downloads = Object.values(decoded.settings.downloadedEpisodes).flat();
		expect(downloads).toHaveLength(200);
		expect(new Set(downloads.map(getEpisodeKey)).size).toBe(200);
		expect(
			data.queue.episodes.some(
				(episode: { title: string; podcastName: string }) =>
					episode.title === data.currentEpisode.title &&
					episode.podcastName === data.currentEpisode.podcastName,
			),
		).toBe(false);
		for (const history of Object.values(decoded.settings.playedEpisodes)) {
			expect(
				data.playedEpisodes[
					getEpisodeKey({
						...downloads[0],
						title: history.title,
						podcastName: history.podcastName,
					})
				],
			).toEqual(history);
		}
	});

	it("accounts for UTF-8 keys, escaping, nested indentation, and separators exactly", () => {
		const data = { schemaVersion: 2, 日本語: { text: 'é\n"\\', list: [1, { text: "雪" }] } };
		const report = measureSnapshot(data);
		expect(
			report.fields.reduce((sum, field) => sum + field.compact, report.framing.compact),
		).toBe(Buffer.byteLength(JSON.stringify(data)));
		expect(
			report.fields.reduce((sum, field) => sum + field.pretty, report.framing.pretty),
		).toBe(Buffer.byteLength(JSON.stringify(data, null, 2)));
	});

	it("accepts added metadata but refuses changes that disguise data loss as smaller overhead", () => {
		const base = {
			schemaVersion: 2,
			savedFeeds: { show: { title: "Show" } },
			queue: { episodes: [{ title: "Episode", content: "full content" }] },
		};
		const candidate = structuredClone(base);
		Object.assign(candidate.queue.episodes[0], { podnotesGuid: "feed-guid" });
		expect(() => assertAdditive(base, candidate)).not.toThrow();
		candidate.queue.episodes[0].content = "";
		expect(() => assertAdditive(base, candidate)).toThrow("changed an existing value");
		const membership = structuredClone(base);
		membership.queue.episodes.push({ title: "New", content: "" });
		expect(() => assertAdditive(base, membership)).toThrow("changed membership");
		const keyedMembership = structuredClone(base);
		Object.assign(keyedMembership.savedFeeds, { another: { title: "Another" } });
		expect(() => assertAdditive(base, keyedMembership)).toThrow("changed membership");
	});
});
