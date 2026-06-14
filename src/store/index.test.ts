import { get } from "svelte/store";
import { beforeEach, describe, expect, test } from "vitest";

import type { Episode } from "src/types/Episode";
import type { PlayedEpisode } from "src/types/PlayedEpisode";
import type DownloadedEpisode from "src/types/DownloadedEpisode";
import { LOCAL_FILES_SETTINGS } from "src/constants";
import { downloadedEpisodes, localFiles, playedEpisodes } from "./index";

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

	test("is a no-op when membership is unchanged", () => {
		const map = {
			"Podcast A": [downloadedEpisode("Podcast A", "Ep 1")],
		};
		localFiles.syncWithDownloaded(map);
		const before = get(localFiles);

		localFiles.syncWithDownloaded({
			"Podcast A": [downloadedEpisode("Podcast A", "Ep 1")],
		});

		// Same key-set -> the store value object is reused (no churn / no extra save).
		expect(get(localFiles)).toBe(before);
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
