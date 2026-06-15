import { get } from "svelte/store";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Episode } from "src/types/Episode";
import type { IPodNotes } from "src/types/IPodNotes";
import type { PlayedEpisode } from "src/types/PlayedEpisode";
import { QUEUE_SETTINGS } from "src/constants";
import { QueueController } from "src/store_controllers/QueueController";
import {
	currentEpisode,
	dedupeEpisodesByTitle,
	playedEpisodes,
	queue,
	reorderEpisodes,
} from "./index";

const episode: Episode = {
	title: "Shared title",
	streamUrl: "https://example.com/audio.mp3",
	url: "https://example.com/episode",
	description: "",
	content: "",
	podcastName: "Design Podcast",
};

function playedEpisode(podcastName: string): PlayedEpisode {
	return {
		title: episode.title,
		podcastName,
		time: 120,
		duration: 120,
		finished: true,
	};
}

describe("playedEpisodes store", () => {
	beforeEach(() => {
		playedEpisodes.set({});
	});

	test("markAsUnplayed clears composite and legacy aliases", () => {
		playedEpisodes.set({
			[episode.title]: playedEpisode("Design Podcast"),
			"Design Podcast::Shared title": playedEpisode("Design Podcast"),
			"Other Podcast::Shared title": playedEpisode("Other Podcast"),
		});

		playedEpisodes.markAsUnplayed(episode);

		const stored = get(playedEpisodes);
		expect(stored[episode.title]).toMatchObject({
			finished: false,
			time: 0,
		});
		expect(stored["Design Podcast::Shared title"]).toMatchObject({
			finished: false,
			time: 0,
		});
		expect(stored["Other Podcast::Shared title"]).toMatchObject({
			finished: true,
			time: 120,
		});
	});

	test("markKeyAsUnplayed clears aliases for the keyed played episode", () => {
		playedEpisodes.set({
			[episode.title]: playedEpisode("Design Podcast"),
			"Design Podcast::Shared title": playedEpisode("Design Podcast"),
		});

		playedEpisodes.markKeyAsUnplayed("Design Podcast::Shared title");

		const stored = get(playedEpisodes);
		expect(stored[episode.title]?.finished).toBe(false);
		expect(stored["Design Podcast::Shared title"]?.finished).toBe(false);
	});
});

function ep(title: string, podcastName = "Pod"): Episode {
	return {
		title,
		streamUrl: `https://example.com/${title}.mp3`,
		url: `https://example.com/${title}`,
		description: "",
		content: "",
		podcastName,
	};
}

function queueTitles(): string[] {
	return get(queue).episodes.map((e) => e.title);
}

function setQueue(...titles: string[]) {
	queue.set({
		...QUEUE_SETTINGS,
		episodes: titles.map((title) => ep(title)),
	});
}

describe("reorderEpisodes", () => {
	const episodes = [ep("A"), ep("B"), ep("C"), ep("D")];
	const titles = (list: Episode[]) => list.map((e) => e.title);

	test("moves forward (from < to)", () => {
		expect(titles(reorderEpisodes(episodes, 0, 2))).toEqual([
			"B",
			"C",
			"A",
			"D",
		]);
	});

	test("moves backward (from > to)", () => {
		expect(titles(reorderEpisodes(episodes, 3, 1))).toEqual([
			"A",
			"D",
			"B",
			"C",
		]);
	});

	test("move to last index truly lands last", () => {
		expect(titles(reorderEpisodes(episodes, 0, episodes.length - 1))).toEqual([
			"B",
			"C",
			"D",
			"A",
		]);
	});

	test("returns the same reference for no-op / out-of-range indices", () => {
		expect(reorderEpisodes(episodes, 1, 1)).toBe(episodes);
		expect(reorderEpisodes(episodes, -1, 0)).toBe(episodes);
		expect(reorderEpisodes(episodes, 0, 99)).toBe(episodes);
		expect(reorderEpisodes(episodes, 99, 0)).toBe(episodes);
	});

	test("does not mutate the input array", () => {
		const input = [ep("A"), ep("B"), ep("C")];
		reorderEpisodes(input, 0, 2);
		expect(titles(input)).toEqual(["A", "B", "C"]);
	});
});

describe("dedupeEpisodesByTitle", () => {
	test("keeps the first occurrence and preserves order", () => {
		const result = dedupeEpisodesByTitle([
			ep("A"),
			ep("B"),
			ep("A"),
			ep("C"),
		]);
		expect(result.map((e) => e.title)).toEqual(["A", "B", "C"]);
	});

	test("handles empty / undefined input", () => {
		expect(dedupeEpisodesByTitle([])).toEqual([]);
		expect(dedupeEpisodesByTitle()).toEqual([]);
	});
});

describe("queue store", () => {
	beforeEach(() => {
		queue.set({ ...QUEUE_SETTINGS, episodes: [] });
	});

	test("add dedupes episodes by title", () => {
		queue.add(ep("A"));
		queue.add(ep("A"));
		queue.add(ep("B"));

		expect(queueTitles()).toEqual(["A", "B"]);
	});

	test("set dedupes a persisted queue that already has duplicate titles", () => {
		queue.set({
			...QUEUE_SETTINGS,
			episodes: [ep("A"), ep("B"), ep("A"), ep("C"), ep("B")],
		});

		expect(queueTitles()).toEqual(["A", "B", "C"]);
	});

	test("moveToTop / moveToBottom reorder the queue", () => {
		setQueue("A", "B", "C");

		queue.moveToBottom(0);
		expect(queueTitles()).toEqual(["B", "C", "A"]);

		queue.moveToTop(2);
		expect(queueTitles()).toEqual(["A", "B", "C"]);
	});

	test("moveUp / moveDown shift a single position", () => {
		setQueue("A", "B", "C");

		queue.moveDown(0);
		expect(queueTitles()).toEqual(["B", "A", "C"]);

		queue.moveUp(2);
		expect(queueTitles()).toEqual(["B", "C", "A"]);
	});

	test("end and out-of-range moves are no-ops", () => {
		setQueue("A", "B", "C");

		queue.moveUp(0);
		queue.moveDown(2);
		queue.move(-1, 0);
		queue.move(0, 99);

		expect(queueTitles()).toEqual(["A", "B", "C"]);
	});

	test("a move persists the new order through QueueController", () => {
		setQueue("A", "B", "C");
		currentEpisode.set(undefined as unknown as Episode, false);

		const fakePlugin = {
			settings: { queue: { ...QUEUE_SETTINGS, episodes: [] } },
			saveSettings: vi.fn(),
		} as unknown as IPodNotes;

		const controller = new QueueController(queue, fakePlugin).on();

		try {
			queue.moveToBottom(0);

			expect(
				fakePlugin.settings.queue.episodes.map((e) => e.title),
			).toEqual(["B", "C", "A"]);
			expect(fakePlugin.saveSettings).toHaveBeenCalled();
		} finally {
			controller.off();
		}
	});
});
