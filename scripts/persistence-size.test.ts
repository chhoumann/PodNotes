// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import FeedParser from "src/parser/feedParser";
import FeedDocumentParser from "src/parser/feedDocumentParser";
import { decodePodNotesData, encodePodNotesData } from "src/persistence/podNotesData";
import { getEpisodeKey } from "src/utility/episodeKey";
import { createLargeV2Fixture } from "../tests/fixtures/persistence/large-v2.mjs";
import { assertAdditive, measureSnapshot } from "./persistence-size.mjs";

describe("persistence byte fixture", () => {
	it("uses the production projection of the frozen real feed without dropping text", async () => {
		const sample = JSON.parse(
			readFileSync("tests/fixtures/persistence/feed-sample.json", "utf8"),
		);
		const xml = readFileSync("tests/fixtures/persistence/planet-money.xml", "utf8");
		const parser = new FeedParser(undefined, { load: async () => xml });
		expect(await parser.getFeed(sample.source.url)).toEqual(sample.feed);
		expect(JSON.parse(JSON.stringify(await parser.getEpisodes(sample.source.url)))).toEqual(
			sample.episodes,
		);
		expect(
			new FeedDocumentParser().parseEpisodeItems(xml).map((episode) => episode.guid),
		).toEqual(sample.guids);
	});

	it("retains a complete realistic library through the released v2 codec", () => {
		const data = JSON.parse(JSON.stringify(createLargeV2Fixture()));
		const decoded = decodePodNotesData(data);
		expect(decoded.warnings).toEqual([]);
		expect(decoded.changed).toBe(false);
		expect(
			JSON.parse(JSON.stringify(encodePodNotesData(decoded.settings, decoded.unknownFields))),
		).toEqual(data);
		expect(Object.keys(data.savedFeeds)).toHaveLength(50);
		expect(Object.keys(data.playedEpisodes)).toHaveLength(2000);
		const downloads = Object.values(decoded.settings.downloadedEpisodes).flat();
		expect(downloads).toHaveLength(200);
		expect(data.localFiles.episodes).toEqual(Object.values(data.downloadedEpisodes).flat());
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
		Object.assign(base.savedFeeds, { another: { title: "Another" } });
		expect(() => assertAdditive(candidate, base)).toThrow("changed membership");
	});
});
