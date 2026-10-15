import type { Vault } from "obsidian";
import { get, type Writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { Episode } from "src/types/Episode";
import type { IPodNotes } from "src/types/IPodNotes";
import type { PlayedEpisode } from "src/types/PlayedEpisode";
import type DownloadedEpisode from "src/types/DownloadedEpisode";
import {
	DEFAULT_EPISODE_LIST_LIMIT,
	LOCAL_FILES_SETTINGS,
	MAX_EPISODE_LIST_LIMIT,
	QUEUE_SETTINGS,
} from "src/constants";
import { selectSource } from "src/player/source";
import { bindStoresToSettings } from "src/store/persistence";
import {
	dedupeEpisodesByKey,
	downloadedEpisodes,
	localFiles,
	playedEpisodes,
	playlists,
	queue,
	reorderEpisodes,
	sanitizeEpisodeListLimit,
	savedFeeds,
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

	test("keeps apart two podcasts' episodes that carry one guid", () => {
		playedEpisodes.setEpisodeTime({ ...episode, guid: "1" }, 30, 60, false);
		playedEpisodes.markAsPlayed({ ...episode, podcastName: "Other Podcast", guid: "1" });

		expect(playedEpisodes.get({ ...episode, guid: "1" })).toMatchObject({
			time: 30,
			finished: false,
		});
	});

	describe("for two episodes of one feed with one title", () => {
		const twinA: Episode = { ...episode, guid: "guid-a", sharedTitle: true };
		const twinB: Episode = { ...episode, guid: "guid-b", sharedTitle: true };
		const unshared: Episode = { ...episode, guid: "guid-own" };
		const legacy: PlayedEpisode = {
			title: episode.title,
			podcastName: "Design Podcast",
			time: 45,
			duration: 120,
			finished: false,
		};

		test("keeps each one's own progress and finished state", () => {
			playedEpisodes.setEpisodeTime(twinA, 30, 60, false);
			playedEpisodes.markAsPlayed(twinB);

			expect(Object.keys(get(playedEpisodes))).toHaveLength(2);
			expect(playedEpisodes.get(twinA)).toEqual({ ...legacy, time: 30, duration: 60 });
			expect(playedEpisodes.get(twinB)).toEqual({
				...legacy,
				time: 0,
				duration: 0,
				finished: true,
			});
		});

		test.each([
			[
				"saving a position",
				() => playedEpisodes.setEpisodeTime(unshared, 50, 120, false),
				{ ...legacy, time: 50 },
			],
			[
				"marking it played",
				() => playedEpisodes.markAsPlayed(unshared),
				{ ...legacy, time: 120, finished: true },
			],
		])(
			"lends the record saved under the title to neither, and to an unshared episode until %s",
			(_, write, written) => {
				playedEpisodes.set({ "Design Podcast::Shared title": { ...legacy } });

				expect(playedEpisodes.get(twinA)).toBeUndefined();
				expect(playedEpisodes.get(twinB)).toBeUndefined();
				expect(playedEpisodes.get(unshared)).toEqual(legacy);

				write();

				expect(get(playedEpisodes)["Design Podcast::Shared title"]).toEqual(legacy);
				expect(Object.keys(get(playedEpisodes))).toHaveLength(2);
				expect(playedEpisodes.get(unshared)).toEqual(written);
			},
		);

		test("a copy saved before guids reads and writes its episode's guid record", () => {
			playedEpisodes.set({ "Design Podcast::Shared title": { ...legacy } });
			playedEpisodes.setEpisodeTime(unshared, 50, 120, false);

			expect(playedEpisodes.get(episode)?.time).toBe(50);
			playedEpisodes.setEpisodeTime(episode, 70, 120, false);
			expect(playedEpisodes.get(unshared)?.time).toBe(70);
			expect(get(playedEpisodes)["Design Podcast::Shared title"]).toEqual(legacy);
		});

		test("marking one unplayed leaves the other played", () => {
			playedEpisodes.markAsPlayed(twinA);
			playedEpisodes.markAsPlayed(twinB);

			playedEpisodes.markAsUnplayed(twinA);

			expect(playedEpisodes.get(twinA)?.finished).toBe(false);
			expect(playedEpisodes.get(twinB)?.finished).toBe(true);
		});
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
		expect(episodes.map((ep) => ep.podcastName).sort()).toEqual(["Podcast A", "Podcast B"]);
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
		// otherwise the localFiles persistence binding + saveSettings would re-run.
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

	test("updates metadata when a same-key local media entry changes", () => {
		localFiles.syncWithDownloaded({
			"local file": [
				downloadedEpisode("local file", "Lecture", {
					filePath: "Audio/Lecture.mp3",
					mediaType: "audio",
				}),
			],
		});

		localFiles.syncWithDownloaded({
			"local file": [
				downloadedEpisode("local file", "Lecture", {
					streamUrl: "app://resource/Videos/Lecture.mp4?1",
					filePath: "Videos/Lecture.mp4",
					mediaType: "video",
				}),
			],
		});

		const [ep] = get(localFiles).episodes;
		expect((ep as DownloadedEpisode).filePath).toBe("Videos/Lecture.mp4");
		expect(ep.mediaType).toBe("video");
		expect(ep.streamUrl).toBe("app://resource/Videos/Lecture.mp4?1");
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

		expect(localFiles.getLocalEpisode("Collision")?.podcastName).toBe("local file");
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
		expect((ep as DownloadedEpisode).filePath).toBe("recordings/my recording.m4a");
	});
});

describe("downloadedEpisodes store — removeEpisode is pure (no vault I/O)", () => {
	beforeEach(() => {
		downloadedEpisodes.set({});
	});

	test("removes the entry and returns the stored download", () => {
		const downloaded = downloadedEpisode("Design Podcast", "Episode 1", {
			filePath: "podcasts/design/ep1.mp3",
		});
		downloadedEpisodes.addEpisode(downloaded, downloaded.filePath, 2048, {
			downloadedByPodNotes: true,
		});

		const removed = downloadedEpisodes.removeEpisode(ep("Episode 1", "Design Podcast"));

		expect(removed).toEqual({ ...downloaded, size: 2048, downloadedByPodNotes: true });
		expect(downloadedEpisodes.getEpisode(downloaded)).toBeUndefined();
		expect(get(downloadedEpisodes)["Design Podcast"]).toEqual([]);
	});

	test("returns undefined and leaves the store untouched when the episode is absent", () => {
		const present = downloadedEpisode("Design Podcast", "Kept");
		downloadedEpisodes.addEpisode(present, present.filePath, 1024);

		const missing = downloadedEpisode("Design Podcast", "Never downloaded");
		const removed = downloadedEpisodes.removeEpisode(missing);

		expect(removed).toBeUndefined();
		expect(downloadedEpisodes.getEpisode(present)).toBeDefined();
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
	const titles = (list: Episode[]) => list.map((e) => e.title);
	const live = (...names: string[]) => names.map((name) => ep(name));

	test.each([
		["the queue the gesture saw", ["A", "B", "C", "D"], ["A", "D", "B", "C"]],
		["an entry auto-queued since", ["X", "A", "B", "C", "D"], ["X", "A", "D", "B", "C"]],
	])("moves D before B in %s", (_, queued, moved) => {
		const move = { episode: ep("D"), relativeTo: ep("B"), side: "before" } as const;
		expect(titles(reorderEpisodes(live(...queued), move))).toEqual(moved);
	});

	test.each([
		["the moved episode left the queue", ["A", "B", "C"]],
		["the anchor left the queue", ["A", "C", "D"]],
		["the move was already applied", ["A", "D", "B", "C"]],
	])("changes nothing when %s", (_, queued) => {
		const episodes = live(...queued);
		const move = { episode: ep("D"), relativeTo: ep("B"), side: "before" } as const;
		expect(reorderEpisodes(episodes, move)).toBe(episodes);
	});

	test("places after the anchor, in either direction", () => {
		const episodes = live("A", "B", "C", "D");
		expect(
			titles(
				reorderEpisodes(episodes, { episode: ep("A"), relativeTo: ep("C"), side: "after" }),
			),
		).toEqual(["B", "C", "A", "D"]);
		expect(
			titles(
				reorderEpisodes(episodes, { episode: ep("D"), relativeTo: ep("A"), side: "after" }),
			),
		).toEqual(["A", "D", "B", "C"]);
	});

	test("an episode placed beside itself, or after the one before it, stays put", () => {
		const episodes = live("A", "B", "C");
		expect(
			reorderEpisodes(episodes, { episode: ep("B"), relativeTo: ep("B"), side: "after" }),
		).toBe(episodes);
		expect(
			reorderEpisodes(episodes, { episode: ep("B"), relativeTo: ep("A"), side: "after" }),
		).toBe(episodes);
	});

	test("keeps the stored entry and leaves the input as it was", () => {
		const episodes = live("A", "B", "C");
		const stored = episodes[2];
		const moved = reorderEpisodes(episodes, {
			episode: { ...ep("C"), description: "a newer copy" },
			relativeTo: ep("A"),
			side: "before",
		});
		expect(moved[0]).toBe(stored);
		expect(titles(episodes)).toEqual(["A", "B", "C"]);
	});
});

describe("dedupeEpisodesByKey", () => {
	test("keeps the first occurrence and preserves order", () => {
		const result = dedupeEpisodesByKey([ep("A"), ep("B"), ep("A"), ep("C")]);
		expect(result.map((e) => e.title)).toEqual(["A", "B", "C"]);
	});

	test("keeps same-titled episodes from different podcasts (#356)", () => {
		const result = dedupeEpisodesByKey([ep("Trailer", "Pod A"), ep("Trailer", "Pod B")]);
		expect(result.map((e) => e.podcastName)).toEqual(["Pod A", "Pod B"]);
	});

	test("handles empty / undefined input", () => {
		expect(dedupeEpisodesByKey([])).toEqual([]);
		expect(dedupeEpisodesByKey()).toEqual([]);
	});
});

describe("queue store", () => {
	beforeEach(() => {
		queue.set({ ...QUEUE_SETTINGS, episodes: [] });
	});

	test("add dedupes the same episode", () => {
		queue.add(ep("A"));
		queue.add(ep("A"));
		queue.add(ep("B"));

		expect(queueTitles()).toEqual(["A", "B"]);
	});

	test("add, set and remove keep same-titled episodes from different podcasts apart (#356)", () => {
		queue.add(ep("Trailer", "Pod A"));
		queue.add(ep("Trailer", "Pod B"));
		expect(get(queue).episodes.map((e) => e.podcastName)).toEqual(["Pod A", "Pod B"]);

		queue.set({
			...QUEUE_SETTINGS,
			episodes: [ep("Trailer", "Pod A"), ep("Trailer", "Pod B")],
		});
		expect(get(queue).episodes.map((e) => e.podcastName)).toEqual(["Pod A", "Pod B"]);

		queue.remove(ep("Trailer", "Pod B"));
		expect(get(queue).episodes.map((e) => e.podcastName)).toEqual(["Pod A"]);
	});

	test("set dedupes a persisted queue that already has duplicate titles", () => {
		queue.set({
			...QUEUE_SETTINGS,
			episodes: [ep("A"), ep("B"), ep("A"), ep("C"), ep("B")],
		});

		expect(queueTitles()).toEqual(["A", "B", "C"]);
	});

	test("reorder moves an episode beside another", () => {
		setQueue("A", "B", "C");

		queue.reorder({ episode: ep("A"), relativeTo: ep("C"), side: "after" });
		expect(queueTitles()).toEqual(["B", "C", "A"]);

		queue.reorder({ episode: ep("A"), relativeTo: ep("B"), side: "before" });
		expect(queueTitles()).toEqual(["A", "B", "C"]);
	});

	test("reorder finds the episode itself, not a same-titled one from another podcast (#356)", () => {
		queue.set({
			...QUEUE_SETTINGS,
			episodes: [ep("Trailer", "Pod A"), ep("Trailer", "Pod B")],
		});

		queue.reorder({
			episode: ep("Trailer", "Pod B"),
			relativeTo: ep("Trailer", "Pod A"),
			side: "before",
		});

		expect(get(queue).episodes.map((e) => e.podcastName)).toEqual(["Pod B", "Pod A"]);
	});

	test("a move that changes nothing, or of an episode not queued, changes and saves nothing", () => {
		setQueue("A", "B", "C");
		let writes = 0;
		const unsubscribe = queue.subscribe(() => writes++);

		queue.reorder({ episode: ep("A"), relativeTo: ep("B"), side: "before" });
		queue.reorder({ episode: ep("C"), relativeTo: ep("B"), side: "after" });
		queue.reorder({ episode: ep("Z"), relativeTo: ep("A"), side: "before" });
		queue.reorder({ episode: ep("A"), relativeTo: ep("Z"), side: "after" });
		unsubscribe();

		expect(queueTitles()).toEqual(["A", "B", "C"]);
		expect(writes).toBe(1);
	});

	test("prepend puts an episode first unless it is already queued", () => {
		setQueue("A", "B");

		queue.prepend(ep("C"));
		queue.prepend(ep("B"));

		expect(queueTitles()).toEqual(["C", "A", "B"]);
	});

	test("a move persists the new order through the settings binding", () => {
		setQueue("A", "B", "C");

		const fakePlugin = {
			settings: { queue: { ...QUEUE_SETTINGS, episodes: [] } },
			saveSettings: vi.fn(),
		} as unknown as IPodNotes;

		const unbind = bindStoresToSettings(fakePlugin);

		try {
			queue.reorder({ episode: ep("A"), relativeTo: ep("C"), side: "after" });

			expect(fakePlugin.settings.queue.episodes.map((e) => e.title)).toEqual(["B", "C", "A"]);
			expect(fakePlugin.saveSettings).toHaveBeenCalled();
		} finally {
			unbind();
		}
	});
});

describe("sanitizeEpisodeListLimit (issue #114)", () => {
	test("keeps valid positive integers", () => {
		expect(sanitizeEpisodeListLimit(15)).toBe(15);
		expect(sanitizeEpisodeListLimit("25")).toBe(25);
	});

	test("floors fractional values", () => {
		expect(sanitizeEpisodeListLimit(7.9)).toBe(7);
	});

	test("falls back to the default for missing/invalid/non-positive values", () => {
		expect(sanitizeEpisodeListLimit(0)).toBe(DEFAULT_EPISODE_LIST_LIMIT);
		expect(sanitizeEpisodeListLimit(-5)).toBe(DEFAULT_EPISODE_LIST_LIMIT);
		expect(sanitizeEpisodeListLimit(Number.NaN)).toBe(DEFAULT_EPISODE_LIST_LIMIT);
		expect(sanitizeEpisodeListLimit(undefined)).toBe(DEFAULT_EPISODE_LIST_LIMIT);
		expect(sanitizeEpisodeListLimit("nope")).toBe(DEFAULT_EPISODE_LIST_LIMIT);
	});

	test("clamps to the maximum", () => {
		expect(sanitizeEpisodeListLimit(MAX_EPISODE_LIST_LIMIT)).toBe(MAX_EPISODE_LIST_LIMIT);
		expect(sanitizeEpisodeListLimit(MAX_EPISODE_LIST_LIMIT + 1)).toBe(MAX_EPISODE_LIST_LIMIT);
		expect(sanitizeEpisodeListLimit(10 ** 9)).toBe(MAX_EPISODE_LIST_LIMIT);
	});
});

describe("stores keyed by a podcast, playlist or episode name", () => {
	const names = ["toString", "__proto__", "constructor", "hasOwnProperty"];
	const stores = [
		["savedFeeds", savedFeeds],
		["downloadedEpisodes", downloadedEpisodes],
		["playedEpisodes", playedEpisodes],
		["playlists", playlists],
	] as unknown as [string, Writable<Record<string, unknown>>][];

	afterEach(() => {
		for (const field of ["time", "finished"]) {
			delete (Object.prototype as Record<string, unknown>)[field];
		}
	});

	test.each(stores)(
		"%s keeps the names it is given, after a set and a replacing update, and finds no other",
		(_, store) => {
			store.set(Object.fromEntries(names.map((name) => [name, { name }])));
			store.update((current) => ({ ...current, Other: { name: "Other" } }));

			const current = get(store);
			expect(Object.keys(current).sort()).toEqual([...names, "Other"].sort());
			expect(current["__proto__"]).toEqual({ name: "__proto__" });
			for (const absent of ["valueOf", "isPrototypeOf"]) {
				expect(current[absent], absent).toBeUndefined();
			}
		},
	);

	test.each(names)("streams an episode of a podcast named %s that has no downloads", (name) => {
		downloadedEpisodes.set({});
		const of = { ...episode, podcastName: name };
		const vault = { getAbstractFileByPath: () => null } as unknown as Vault;

		expect(downloadedEpisodes.getEpisode(of)).toBeUndefined();
		expect(selectSource(of, get(downloadedEpisodes), vault).src).toBe(episode.streamUrl);
	});

	test.each(names)("downloads an episode of a podcast named %s", (name) => {
		downloadedEpisodes.set({});
		const of = { ...episode, podcastName: name };

		downloadedEpisodes.addEpisode(of, `${name}/Shared title.mp3`, 1);

		expect(downloadedEpisodes.getEpisode(of)?.filePath).toBe(`${name}/Shared title.mp3`);
		expect(Object.keys(get(downloadedEpisodes))).toEqual([name]);
	});

	test("marks an episode titled __proto__ played without touching other objects", () => {
		playedEpisodes.set({});
		const of = { ...episode, title: "__proto__", podcastName: "" };

		playedEpisodes.markAsPlayed(of);

		expect(playedEpisodes.get(of)?.finished).toBe(true);
		expect(({} as { finished?: boolean }).finished).toBeUndefined();
	});

	test("marking one show's episode played leaves another show's same-titled legacy progress alone", () => {
		const showA: PlayedEpisode = {
			title: episode.title,
			podcastName: "Show A",
			time: 30,
			duration: 60,
			finished: false,
		};
		playedEpisodes.set({ [episode.title]: { ...showA } });
		const showBEpisode = { ...episode, podcastName: "Show B" };

		playedEpisodes.markAsPlayed(showBEpisode);

		expect(get(playedEpisodes)[episode.title]).toEqual(showA);
		expect(playedEpisodes.get({ ...episode, podcastName: "Show A" })).toEqual(showA);
		expect(get(playedEpisodes)["Show B::Shared title"]).toMatchObject({
			podcastName: "Show B",
			finished: true,
		});
	});
});
