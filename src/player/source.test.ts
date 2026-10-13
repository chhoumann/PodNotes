import { TFile, type Vault } from "obsidian";
import { describe, expect, test } from "vitest";

import type DownloadedEpisode from "src/types/DownloadedEpisode";
import type { Episode } from "src/types/Episode";
import { selectSource } from "./source";

const episode: Episode = {
	title: "Episode",
	streamUrl: "https://cdn.example.com/u.mp3",
	url: "https://pod.example.com/episode",
	description: "",
	content: "",
	podcastName: "Show",
	feedUrl: "https://pod.example.com/feed.xml",
};

function vaultWith(...paths: string[]): Vault {
	return {
		getAbstractFileByPath: (path: string) =>
			paths.includes(path) ? Object.assign(new TFile(), { path }) : null,
		getResourcePath: (file: TFile) => `app://resource/${file.path}`,
	} as unknown as Vault;
}

function copy(of: Episode, filePath: string, extra: Partial<Episode> = {}): DownloadedEpisode {
	return { ...of, ...extra, filePath, size: 10 };
}

describe("selectSource", () => {
	test("a queued snapshot plays its downloaded copy of the same media", () => {
		const downloaded = { Show: [copy(episode, "Downloads/u.mp3")] };

		expect(selectSource(episode, downloaded, vaultWith("Downloads/u.mp3"))).toEqual({
			src: "app://resource/Downloads/u.mp3",
			mediaType: "audio",
			filePath: "Downloads/u.mp3",
		});
	});

	test("a live snapshot of other media streams instead of playing the old copy", () => {
		const downloaded = { Show: [copy(episode, "Downloads/u.mp3")] };
		const live = { ...episode, streamUrl: "https://cdn.example.com/v.mp3" };

		expect(selectSource(live, downloaded, vaultWith("Downloads/u.mp3"))).toEqual({
			src: "https://cdn.example.com/v.mp3",
			mediaType: "audio",
		});
	});

	test("a snapshot with its own file plays that file, not the registered copy", () => {
		const downloaded = { Show: [copy(episode, "folder-a/Episode.mp3")] };
		const snapshot = copy(episode, "folder-b/Episode.mp3");

		const source = selectSource(
			snapshot,
			downloaded,
			vaultWith("folder-a/Episode.mp3", "folder-b/Episode.mp3"),
		);

		expect(source).toEqual({
			src: "app://resource/folder-b/Episode.mp3",
			mediaType: "audio",
			filePath: "folder-b/Episode.mp3",
		});
	});

	test("a missing file plays nothing rather than the stream", () => {
		const vault = vaultWith();

		expect(selectSource(copy(episode, "Downloads/u.mp3"), {}, vault).src).toBe("");
		expect(selectSource(episode, { Show: [copy(episode, "Downloads/u.mp3")] }, vault).src).toBe(
			"",
		);
	});

	test("a local file snapshot without a path plays its registered file", () => {
		const local: Episode = {
			...episode,
			podcastName: "local file",
			streamUrl: "app://resource/old-snapshot",
		};
		const downloaded = {
			"local file": [copy(local, "Media/Episode.mp3", { streamUrl: "app://resource/other" })],
		};

		expect(selectSource(local, downloaded, vaultWith("Media/Episode.mp3")).src).toBe(
			"app://resource/Media/Episode.mp3",
		);
	});

	test("a video episode does not play a same-titled audio download", () => {
		const video: Episode = {
			...episode,
			streamUrl: "https://cdn.example.com/u.mp4",
			mediaType: "video",
		};
		const downloaded = { Show: [copy(video, "Downloads/u.mp3", { mediaType: "audio" })] };

		expect(selectSource(video, downloaded, vaultWith("Downloads/u.mp3"))).toEqual({
			src: "https://cdn.example.com/u.mp4",
			mediaType: "video",
		});
	});

	test.each(["audio", "video"] as const)(
		"a legacy mp4 download plays as the %s the episode declares",
		(mediaType) => {
			const mp4: Episode = {
				...episode,
				streamUrl: "https://cdn.example.com/e.mp4",
				mediaType,
			};
			const downloaded = {
				Show: [copy({ ...mp4, mediaType: undefined }, "Downloads/e.mp4")],
			};

			expect(selectSource(mp4, downloaded, vaultWith("Downloads/e.mp4"))).toEqual({
				src: "app://resource/Downloads/e.mp4",
				mediaType,
				filePath: "Downloads/e.mp4",
			});
		},
	);

	test("an extensionless episode takes its media type from the matching download", () => {
		const extensionless = { ...episode, streamUrl: "https://cdn.example.com/watch?id=42" };
		const downloaded = {
			Show: [copy(extensionless, "Downloads/video.mp4", { mediaType: "video" })],
		};

		expect(selectSource(extensionless, downloaded, vaultWith("Downloads/video.mp4"))).toEqual({
			src: "app://resource/Downloads/video.mp4",
			mediaType: "video",
			filePath: "Downloads/video.mp4",
		});
	});
});
