import { describe, expect, test } from "vitest";

import { DEFAULT_EPISODE_LIST_LIMIT, DEFAULT_SETTINGS } from "src/constants";
import type { FeedState } from "src/services/FeedRepository";
import type DownloadedEpisode from "src/types/DownloadedEpisode";
import type { Episode } from "src/types/Episode";
import {
	selectFeedEpisodes,
	selectLatestEpisodes,
	selectListEntries,
	type ListSnapshot,
} from "./episodeListSelection";

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
		expect(selectLatestEpisodes(feeds, DEFAULT_EPISODE_LIST_LIMIT)).toHaveLength(20);
		expect(titles(selectLatestEpisodes(feeds, 2))).toEqual([
			"Show A #25",
			"Show B #25",
			"Show A #24",
			"Show B #24",
		]);
	});

	test("ranks a feed by date before applying the limit", () => {
		const oldestFirst = new Map([
			["Show A", feedState("Show A", episodes("Show A", 25, "oldest-first"))],
		]);

		expect(titles(selectLatestEpisodes(oldestFirst, 2))).toEqual(["Show A #25", "Show A #24"]);
	});

	test("an invalid limit falls back to the default", () => {
		expect(selectLatestEpisodes(feeds, 0)).toHaveLength(2 * DEFAULT_EPISODE_LIST_LIMIT);
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

describe("selectListEntries", () => {
	const [first, second] = episodes("Show A", 2);
	const playlist = (name: string, list: Episode[]) => ({
		...structuredClone(DEFAULT_SETTINGS.favorites),
		name,
		episodes: list,
	});
	const library: ListSnapshot = {
		feeds: new Map(),
		limit: DEFAULT_EPISODE_LIST_LIMIT,
		played: {},
		downloads: {},
		queue: structuredClone(DEFAULT_SETTINGS.queue),
		favorites: playlist("Favorites", [first]),
		localFiles: { ...structuredClone(DEFAULT_SETTINGS.localFiles), episodes: [first] },
		playlists: { Walks: playlist("Walks", [second, first]) },
	};
	const shown = (entries: { episode: Episode }[]) => entries.map(({ episode }) => episode.title);

	test("lists Favorites by its name, a playlist by its key, and nothing for one that is gone", () => {
		expect(shown(selectListEntries({ kind: "playlist", name: "Favorites" }, library))).toEqual([
			"Show A #2",
		]);
		expect(shown(selectListEntries({ kind: "playlist", name: "Walks" }, library))).toEqual([
			"Show A #1",
			"Show A #2",
		]);
		expect(selectListEntries({ kind: "playlist", name: "Gone" }, library)).toEqual([]);
	});

	test("lists Local files as stored", () => {
		expect(shown(selectListEntries({ kind: "local" }, library))).toEqual(["Show A #2"]);
	});

	test("resolves a Played record from a playlist, keeps its legacy key, and keeps a gone one", () => {
		const record = (title: string) => ({
			title,
			podcastName: "Show A",
			time: 1,
			duration: 1,
			finished: true,
		});
		const entries = selectListEntries(
			{ kind: "played" },
			{
				...library,
				played: { "Show A #1": record("Show A #1"), "Show A::Gone": record("Gone") },
			},
		);

		expect(
			entries.map(({ episode, isAvailable, playedEpisodeKey }) => [
				episode.title,
				isAvailable,
				playedEpisodeKey,
			]),
		).toEqual([
			["Show A #1", true, "Show A #1"],
			["Gone", false, "Show A::Gone"],
		]);
		expect(entries[0].episode).toBe(second);
	});
});
