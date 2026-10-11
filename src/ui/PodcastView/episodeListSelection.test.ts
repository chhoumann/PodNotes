import { describe, expect, test } from "vitest";

import { DEFAULT_EPISODE_LIST_LIMIT } from "src/constants";
import type { FeedState } from "src/services/FeedRepository";
import type DownloadedEpisode from "src/types/DownloadedEpisode";
import type { Episode } from "src/types/Episode";
import { selectFeedEpisodes, selectLatestEpisodes } from "./episodeListSelection";

// `ordinal` doubles as the day of the month, so a higher ordinal is newer.
function episodes(
	podcastName: string,
	count: number,
	order: "newest-first" | "oldest-first" = "newest-first",
): Episode[] {
	const list = Array.from({ length: count }, (_, index) => ({
		title: `${podcastName} #${index + 1}`,
		streamUrl: `https://example.com/${podcastName}/${index + 1}.mp3`,
		url: "",
		description: "",
		content: "",
		podcastName,
		episodeDate: new Date(2020, 0, index + 1),
	}));
	return order === "newest-first" ? list.reverse() : list;
}

function feedState(title: string, list: Episode[], fields: Partial<FeedState> = {}): FeedState {
	return {
		feed: { title, url: `https://example.com/${title}.xml`, artworkUrl: "" },
		status: "ready",
		episodes: list,
		channel: { title },
		...fields,
	};
}

const titles = (list: readonly Episode[]) => list.map((episode) => episode.title);

describe("selectLatestEpisodes", () => {
	const feeds = new Map([
		["Show A", feedState("Show A", episodes("Show A", 25))],
		["Show B", feedState("Show B", episodes("Show B", 25))],
	]);

	test("takes the newest episodes of each saved podcast, up to the limit", () => {
		expect(selectLatestEpisodes(feeds, ["Show A"], DEFAULT_EPISODE_LIST_LIMIT)).toHaveLength(
			10,
		);
		expect(titles(selectLatestEpisodes(feeds, ["Show A"], 3))).toEqual([
			"Show A #25",
			"Show A #24",
			"Show A #23",
		]);
		expect(selectLatestEpisodes(feeds, ["Show A", "Show B"], 5)).toHaveLength(10);
	});

	test("ranks a feed by date before applying the limit", () => {
		const oldestFirst = new Map([
			["Show A", feedState("Show A", episodes("Show A", 25, "oldest-first"))],
		]);

		expect(titles(selectLatestEpisodes(oldestFirst, ["Show A"], 2))).toEqual([
			"Show A #25",
			"Show A #24",
		]);
	});

	test("an invalid limit falls back to the default", () => {
		expect(selectLatestEpisodes(feeds, ["Show A"], 0)).toHaveLength(DEFAULT_EPISODE_LIST_LIMIT);
	});

	test("lists only podcasts that are still saved", () => {
		expect(
			new Set(selectLatestEpisodes(feeds, ["Show B"], 5).map((e) => e.podcastName)),
		).toEqual(new Set(["Show B"]));
	});
});

describe("selectFeedEpisodes", () => {
	const downloaded = {
		"Show A": [{ ...episodes("Show A", 1)[0], filePath: "a.mp3", size: 1 }],
	} satisfies Record<string, DownloadedEpisode[]>;

	test("falls back to downloads only when the feed failed to load and has no document", () => {
		const failed = feedState("Show A", [], {
			status: "error",
			error: "network",
			channel: undefined,
		});

		expect(selectFeedEpisodes(failed, downloaded)).toEqual(downloaded["Show A"]);
	});

	test("keeps a successfully loaded empty feed empty", () => {
		expect(selectFeedEpisodes(feedState("Show A", []), downloaded)).toEqual([]);
	});

	test("keeps showing a stale document after a failed refresh", () => {
		const stale = feedState("Show A", episodes("Show A", 2), {
			status: "stale",
			error: "network",
		});

		expect(titles(selectFeedEpisodes(stale, downloaded))).toEqual(["Show A #2", "Show A #1"]);
	});
});
