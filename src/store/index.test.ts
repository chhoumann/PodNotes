import { get } from "svelte/store";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Episode } from "src/types/Episode";
import type { IPodNotes } from "src/types/IPodNotes";
import type { PlayedEpisode } from "src/types/PlayedEpisode";
import type DownloadedEpisode from "src/types/DownloadedEpisode";
import { LOCAL_FILES_SETTINGS, QUEUE_SETTINGS } from "src/constants";
import { QueueController } from "src/store_controllers/QueueController";
import {
	currentEpisode,
	dedupeEpisodesByTitle,
	downloadedEpisodes,
	localFiles,
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

function downloadedEpisode(
	podcastName: string,
	title: string,
	overrides: Partial<DownloadedEpisode> = {},
): DownloadedEpisode {
	return {
		title,
		streamUrl: `https://example.com/${title}.mp3`,
		url: `https://example.com/${title}`,
		description: "",
		content: "",
		podcastName,
		filePath: `podcasts/${podcastName} ${title}.mp3`,
		size: 1024,
		...overrides,
	};
}

describe("localFiles store — syncWithDownloaded (issue #176)", () => {
	beforeEach(() => {
		downloadedEpisodes.set({});
		localFiles.set({
			...LOCAL_FILES_SETTINGS,
			episodes: [],
		});
	});

	test("mirrors downloaded episodes across every podcast bucket", () => {
		localFiles.syncWithDownloaded({
			"Podcast A": [downloadedEpisode("Podcast A", "Ep 1")],
			"Podcast B": [
				downloadedEpisode("Podcast B", "Ep 2"),
				downloadedEpisode("Podcast B", "Ep 3"),
			],
		});

		const titles = get(localFiles).episodes.map((ep) => ep.title);
		expect(titles).toEqual(["Ep 1", "Ep 2", "Ep 3"]);
	});

	test("keeps same-title episodes from different podcasts (composite-key dedup)", () => {
		localFiles.syncWithDownloaded({
			"Podcast A": [downloadedEpisode("Podcast A", "Shared title")],
			"Podcast B": [downloadedEpisode("Podcast B", "Shared title")],
		});

		const episodes = get(localFiles).episodes;
		expect(episodes).toHaveLength(2);
		expect(episodes.map((ep) => ep.podcastName).sort()).toEqual([
			"Podcast A",
			"Podcast B",
		]);
	});

	test("preserves filePath/size and the real podcastName (not coerced)", () => {
		localFiles.syncWithDownloaded({
			"Real Podcast": [
				downloadedEpisode("Real Podcast", "Ep 1", {
					filePath: "podcasts/real.mp3",
					size: 4096,
				}),
			],
		});

		const [ep] = get(localFiles).episodes;
		expect(ep.podcastName).toBe("Real Podcast");
		expect((ep as DownloadedEpisode).filePath).toBe("podcasts/real.mp3");
		expect((ep as DownloadedEpisode).size).toBe(4096);
	});

	test("keeps manual local files with podcastName 'local file'", () => {
		localFiles.syncWithDownloaded({
			"local file": [downloadedEpisode("local file", "My Recording")],
		});

		const [ep] = get(localFiles).episodes;
		expect(ep.podcastName).toBe("local file");
	});

	test("removal from downloadedEpisodes propagates to the playlist", () => {
		const map = {
			"Podcast A": [
				downloadedEpisode("Podcast A", "Ep 1"),
				downloadedEpisode("Podcast A", "Ep 2"),
			],
		};
		localFiles.syncWithDownloaded(map);
		expect(get(localFiles).episodes).toHaveLength(2);

		localFiles.syncWithDownloaded({
			"Podcast A": [downloadedEpisode("Podcast A", "Ep 2")],
		});

		const titles = get(localFiles).episodes.map((ep) => ep.title);
		expect(titles).toEqual(["Ep 2"]);
	});

	test("empty map clears the playlist but preserves its metadata", () => {
		localFiles.syncWithDownloaded({
			"Podcast A": [downloadedEpisode("Podcast A", "Ep 1")],
		});

		localFiles.syncWithDownloaded({});

		const playlist = get(localFiles);
		expect(playlist.episodes).toEqual([]);
		expect(playlist.name).toBe(LOCAL_FILES_SETTINGS.name);
		expect(playlist.icon).toBe(LOCAL_FILES_SETTINGS.icon);
	});

	test("is a no-op when membership is unchanged (no store notification)", () => {
		localFiles.syncWithDownloaded({
			"Podcast A": [downloadedEpisode("Podcast A", "Ep 1")],
		});
		const before = get(localFiles);

		// Svelte notifies subscribers for every object value (safe_not_equal treats
		// objects as always-changed), so a no-op must not touch the store at all --
		// otherwise LocalFilesController.onChange + saveSettings would re-run.
		let notifications = 0;
		const unsubscribe = localFiles.subscribe(() => {
			notifications += 1;
		});
		expect(notifications).toBe(1); // immediate fire on subscribe

		localFiles.syncWithDownloaded({
			"Podcast A": [downloadedEpisode("Podcast A", "Ep 1")],
		});
		expect(notifications).toBe(1); // unchanged membership -> no extra notification
		expect(get(localFiles)).toBe(before); // store value object reused

		// A real membership change does notify.
		localFiles.syncWithDownloaded({
			"Podcast A": [
				downloadedEpisode("Podcast A", "Ep 1"),
				downloadedEpisode("Podcast A", "Ep 2"),
			],
		});
		expect(notifications).toBe(2);

		unsubscribe();
	});

	test("getLocalEpisode prefers a manual local file over a same-titled download", () => {
		localFiles.syncWithDownloaded({
			"Real Podcast": [downloadedEpisode("Real Podcast", "Collision")],
			"local file": [
				downloadedEpisode("local file", "Collision", {
					filePath: "recordings/collision.mp3",
				}),
			],
		});

		expect(localFiles.getLocalEpisode("Collision")?.podcastName).toBe(
			"local file",
		);
	});

	test("dedupes identical composite keys, keeping the first occurrence", () => {
		localFiles.syncWithDownloaded({
			"Podcast A": [
				downloadedEpisode("Podcast A", "Dup", { filePath: "first.mp3" }),
				downloadedEpisode("Podcast A", "Dup", { filePath: "second.mp3" }),
			],
		});

		const episodes = get(localFiles).episodes;
		expect(episodes).toHaveLength(1);
		expect((episodes[0] as DownloadedEpisode).filePath).toBe("first.mp3");
	});

	test("skips entries with no usable episode key", () => {
		localFiles.syncWithDownloaded({
			"Podcast A": [
				downloadedEpisode("Podcast A", ""),
				downloadedEpisode("Podcast A", "Valid"),
			],
		});

		const titles = get(localFiles).episodes.map((ep) => ep.title);
		expect(titles).toEqual(["Valid"]);
	});

	test("surfaces a file added only to downloadedEpisodes (getContextMenuHandler flow)", () => {
		// getContextMenuHandler now writes a manual local file only to
		// downloadedEpisodes and relies on the projection to surface it.
		downloadedEpisodes.addEpisode(
			downloadedEpisode("local file", "My Recording", {
				filePath: "recordings/my recording.m4a",
			}),
			"recordings/my recording.m4a",
			2048,
		);

		localFiles.syncWithDownloaded(get(downloadedEpisodes));

		const [ep] = get(localFiles).episodes;
		expect(ep?.title).toBe("My Recording");
		expect(ep?.podcastName).toBe("local file");
		expect((ep as DownloadedEpisode).filePath).toBe(
			"recordings/my recording.m4a",
		);
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
