import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { TFile } from "obsidian";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
	currentEpisode,
	currentTime,
	downloadedEpisodes,
	duration,
	isPaused,
	activePlaybackSegment,
	playbackRate,
	playedEpisodes,
	playlists,
	plugin,
	queue,
	requestedPlaybackTime,
} from "src/store";
import type { Episode } from "src/types/Episode";
import EpisodePlayer from "./EpisodePlayer.svelte";

const testEpisode: Episode = {
	title: "Finished Episode",
	streamUrl: "https://pod.example.com/audio.mp3",
	url: "https://pod.example.com/episode",
	description: "",
	content: "",
	podcastName: "Test Podcast",
	feedUrl: "https://pod.example.com/feed.xml",
};

beforeEach(() => {
	currentEpisode.set(testEpisode);
	currentTime.set(0);
	duration.set(3600);
	isPaused.set(true);
	activePlaybackSegment.set(null);
	playbackRate.set(1);
	playedEpisodes.set({});
	requestedPlaybackTime.set(null);
	downloadedEpisodes.set({});
	playlists.set({});
	queue.set({
		icon: "list-ordered",
		name: "Queue",
		episodes: [],
		shouldEpisodeRemoveAfterPlay: false,
		shouldRepeat: false,
	});
	HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
	HTMLMediaElement.prototype.pause = vi.fn();
	plugin.set({
		settings: {
			defaultPlaybackRate: 1,
		},
		api: {
			skipBackward: vi.fn(),
			skipForward: vi.fn(),
		},
	} as never);
});

afterEach(() => {
	(globalThis as { app?: unknown }).app = undefined;
});

function makeTFile(path: string): TFile {
	const file = new TFile();
	const dot = path.lastIndexOf(".");
	const slash = path.lastIndexOf("/");
	Object.assign(file as unknown as Record<string, unknown>, {
		path,
		extension: dot > slash ? path.slice(dot + 1) : "",
		basename: path.slice(slash + 1, dot > slash ? dot : undefined),
	});
	return file;
}

function mockVaultFile(path: string): void {
	const file = makeTFile(path);
	const vault = {
		getAbstractFileByPath: vi.fn((candidate: string) => (candidate === path ? file : null)),
		getResourcePath: vi.fn(() => `app://resource/${path}?token`),
	};
	// The player reads the vault off the plugin's app reference ($plugin.app),
	// so expose it there (merging onto the base mock set in beforeEach).
	plugin.update(
		(current) =>
			({
				...(current as unknown as Record<string, unknown>),
				app: { vault },
			}) as never,
	);
}

describe("EpisodePlayer", () => {
	test("uses requested timestamp before restored played progress", async () => {
		playedEpisodes.markAsPlayed(testEpisode);
		requestedPlaybackTime.set({
			episodeKey: `${testEpisode.podcastName}::${testEpisode.title}`,
			time: 240,
		});

		const { container } = render(EpisodePlayer);
		await waitFor(() => {
			expect(container.querySelector("audio")).not.toBeNull();
		});
		const audio = container.querySelector("audio") as HTMLAudioElement;

		await fireEvent.loadedMetadata(audio);

		expect(get(currentTime)).toBe(240);
		expect(get(isPaused)).toBe(false);
		expect(get(requestedPlaybackTime)).toBeNull();
	});

	test("shows an error state instead of a permanent spinner when media fails to load", async () => {
		const { container } = render(EpisodePlayer);
		await waitFor(() => {
			expect(container.querySelector("audio")).not.toBeNull();
		});
		const audio = container.querySelector("audio") as HTMLAudioElement;

		// A blocked/dead stream URL fires error, never loadedmetadata.
		await fireEvent.error(audio);

		expect(container.querySelector(".podcast-artwork-isloading-overlay")).toBeNull();
		const error = container.querySelector(".podcast-artwork-load-error");
		expect(error).not.toBeNull();
		expect(error?.textContent).toContain("Could not load");
	});

	test("clears the error state when the next episode loads", async () => {
		const { container } = render(EpisodePlayer);
		await waitFor(() => {
			expect(container.querySelector("audio")).not.toBeNull();
		});
		const audio = container.querySelector("audio") as HTMLAudioElement;
		await fireEvent.error(audio);
		expect(container.querySelector(".podcast-artwork-load-error")).not.toBeNull();

		currentEpisode.set({ ...testEpisode, title: "Next Episode" });
		await waitFor(() => {
			expect(container.querySelector(".podcast-artwork-isloading-overlay")).not.toBeNull();
		});
		await fireEvent.loadedMetadata(container.querySelector("audio") as HTMLAudioElement);
		expect(container.querySelector(".podcast-artwork-load-error")).toBeNull();
	});

	test("arms a requested segment after metadata loads", async () => {
		requestedPlaybackTime.set({
			episodeKey: `${testEpisode.podcastName}::${testEpisode.title}`,
			time: 240,
			endTime: 260,
		});

		const { container } = render(EpisodePlayer);
		await waitFor(() => {
			expect(container.querySelector("audio")).not.toBeNull();
		});
		const audio = container.querySelector("audio") as HTMLAudioElement;

		await fireEvent.loadedMetadata(audio);

		expect(get(currentTime)).toBe(240);
		expect(get(isPaused)).toBe(false);
		expect(get(requestedPlaybackTime)).toBeNull();
		expect(get(activePlaybackSegment)).toEqual({
			episodeKey: `${testEpisode.podcastName}::${testEpisode.title}`,
			startTime: 240,
			endTime: 260,
		});
	});

	test("stops playback at the active segment end", async () => {
		requestedPlaybackTime.set({
			episodeKey: `${testEpisode.podcastName}::${testEpisode.title}`,
			time: 115,
			endTime: 125,
		});

		const { container } = render(EpisodePlayer);
		await waitFor(() => {
			expect(container.querySelector("audio")).not.toBeNull();
		});
		const audio = container.querySelector("audio") as HTMLAudioElement;
		await fireEvent.loadedMetadata(audio);

		currentTime.set(126);
		isPaused.set(false);
		await fireEvent.timeUpdate(audio);

		expect(get(currentTime)).toBe(125);
		expect(get(isPaused)).toBe(true);
		expect(get(activePlaybackSegment)).toBeNull();
	});

	test("does not persist preview segment progress over saved listening progress", async () => {
		const episodeKey = `${testEpisode.podcastName}::${testEpisode.title}`;
		playedEpisodes.setEpisodeTime(testEpisode, 1000, 3600, false);
		requestedPlaybackTime.set({
			episodeKey,
			time: 115,
			endTime: 125,
		});

		const { container, unmount } = render(EpisodePlayer);
		await waitFor(() => {
			expect(container.querySelector("audio")).not.toBeNull();
		});
		const audio = container.querySelector("audio") as HTMLAudioElement;
		await fireEvent.loadedMetadata(audio);

		currentTime.set(120);
		await fireEvent.timeUpdate(audio);
		expect(get(playedEpisodes)[episodeKey]?.time).toBe(1000);

		currentTime.set(126);
		await fireEvent.timeUpdate(audio);
		await fireEvent.pause(audio);
		unmount();

		expect(get(currentTime)).toBe(125);
		expect(get(playedEpisodes)[episodeKey]?.time).toBe(1000);
	});

	test("manual seeks clear the active segment", async () => {
		requestedPlaybackTime.set({
			episodeKey: `${testEpisode.podcastName}::${testEpisode.title}`,
			time: 115,
			endTime: 125,
		});

		const { container } = render(EpisodePlayer);
		await waitFor(() => {
			expect(container.querySelector("audio")).not.toBeNull();
		});
		const audio = container.querySelector("audio") as HTMLAudioElement;
		await fireEvent.loadedMetadata(audio);
		duration.set(3600);

		const progress = container.querySelector(".progress") as HTMLElement;
		await fireEvent.keyDown(progress, { key: "End" });

		expect(get(currentTime)).toBe(3600);
		expect(get(activePlaybackSegment)).toBeNull();
	});

	test("a segment ending at media end pauses instead of marking the episode played", async () => {
		const episodeKey = `${testEpisode.podcastName}::${testEpisode.title}`;
		requestedPlaybackTime.set({
			episodeKey,
			time: 3590,
			endTime: 3600,
		});

		const { container } = render(EpisodePlayer);
		await waitFor(() => {
			expect(container.querySelector("audio")).not.toBeNull();
		});
		const audio = container.querySelector("audio") as HTMLAudioElement;
		await fireEvent.loadedMetadata(audio);

		currentTime.set(3600);
		await fireEvent.ended(audio);

		expect(get(currentTime)).toBe(3600);
		expect(get(isPaused)).toBe(true);
		expect(get(activePlaybackSegment)).toBeNull();
		expect(get(playedEpisodes)[episodeKey]).toBeUndefined();
	});

	test("on episode end only removes the matching episode from playlists, keeping same-titled episodes from other podcasts (PB-07)", async () => {
		const otherPodcastSameTitle: Episode = {
			...testEpisode,
			podcastName: "Other Podcast",
			streamUrl: "https://other.example.com/audio.mp3",
		};
		playlists.set({
			"My List": {
				icon: "list-ordered",
				name: "My List",
				episodes: [testEpisode, otherPodcastSameTitle],
				shouldEpisodeRemoveAfterPlay: false,
				shouldRepeat: false,
			},
		});

		const { container } = render(EpisodePlayer);
		await waitFor(() => {
			expect(container.querySelector("audio")).not.toBeNull();
		});
		const audio = container.querySelector("audio") as HTMLAudioElement;
		await fireEvent.loadedMetadata(audio);

		currentTime.set(3600);
		await fireEvent.ended(audio);

		const remaining = get(playlists)["My List"].episodes;
		expect(remaining).toHaveLength(1);
		expect(remaining[0].podcastName).toBe("Other Podcast");
	});

	test("ignores stale requested timestamp for a different episode", async () => {
		playedEpisodes.setEpisodeTime(testEpisode, 1800, 3600, false);
		requestedPlaybackTime.set({
			episodeKey: "Other Podcast::Other Episode",
			time: 240,
		});

		const { container } = render(EpisodePlayer);
		await waitFor(() => {
			expect(container.querySelector("audio")).not.toBeNull();
		});
		const audio = container.querySelector("audio") as HTMLAudioElement;

		await fireEvent.loadedMetadata(audio);

		expect(get(currentTime)).toBe(1800);
		expect(get(isPaused)).toBe(false);
		expect(get(requestedPlaybackTime)).toBeNull();
	});

	test("does not restore a title-only saved position from a different podcast's same-titled episode (PB-06)", async () => {
		// Legacy title-only entry that actually belongs to another podcast.
		playedEpisodes.set({
			[testEpisode.title]: {
				title: testEpisode.title,
				podcastName: "A Different Podcast",
				time: 1800,
				duration: 3600,
				finished: false,
			},
		});

		const { container } = render(EpisodePlayer);
		await waitFor(() => {
			expect(container.querySelector("audio")).not.toBeNull();
		});
		const audio = container.querySelector("audio") as HTMLAudioElement;
		await fireEvent.loadedMetadata(audio);

		// The current episode is "Test Podcast" — the other podcast's saved
		// position must be ignored, resuming from 0 instead of 1800.
		expect(get(currentTime)).toBe(0);
	});

	test("restores a legacy title-only saved position for the same episode (PB-06)", async () => {
		// Legacy entry with no podcastName recorded — must still resume.
		playedEpisodes.set({
			[testEpisode.title]: {
				title: testEpisode.title,
				podcastName: "",
				time: 900,
				duration: 3600,
				finished: false,
			},
		});

		const { container } = render(EpisodePlayer);
		await waitFor(() => {
			expect(container.querySelector("audio")).not.toBeNull();
		});
		const audio = container.querySelector("audio") as HTMLAudioElement;
		await fireEvent.loadedMetadata(audio);

		expect(get(currentTime)).toBe(900);
	});

	test("keeps the audio element and slider label in sync with playbackRate store", async () => {
		const { container } = render(EpisodePlayer);
		await waitFor(() => {
			expect(container.querySelector("audio")).not.toBeNull();
		});
		const audio = container.querySelector("audio") as HTMLAudioElement;

		playbackRate.set(1.7);

		await waitFor(() => {
			expect(audio.playbackRate).toBe(1.7);
		});
		expect(container.querySelector(".playbackrate-container span")?.textContent).toBe("1.7x");
	});

	test("updates playbackRate store from the playback-rate slider", async () => {
		const { container } = render(EpisodePlayer);
		await waitFor(() => {
			expect(container.querySelector("audio")).not.toBeNull();
		});

		const sliders = Array.from(container.querySelectorAll("input[type='range']"));
		const rateSlider = sliders[sliders.length - 1] as HTMLInputElement;
		rateSlider.value = "2.2";
		await fireEvent.input(rateSlider);

		expect(get(playbackRate)).toBe(2.2);
	});

	test("renders video episodes with a video media element and shared playback bindings", async () => {
		const videoEpisode: Episode = {
			...testEpisode,
			title: "Video Episode",
			streamUrl: "https://pod.example.com/video.mp4",
			mediaType: "video",
		};
		const episodeKey = `${videoEpisode.podcastName}::${videoEpisode.title}`;
		currentEpisode.set(videoEpisode);

		const { container } = render(EpisodePlayer);
		await waitFor(() => {
			expect(container.querySelector("video")).not.toBeNull();
		});
		const video = container.querySelector("video") as HTMLVideoElement;

		expect(container.querySelector("audio")).toBeNull();
		expect(video.getAttribute("src")).toBe(videoEpisode.streamUrl);

		await fireEvent.loadedMetadata(video);
		expect(get(isPaused)).toBe(false);

		playbackRate.set(1.5);
		await waitFor(() => {
			expect(video.playbackRate).toBe(1.5);
		});

		currentTime.set(42);
		await fireEvent.timeUpdate(video);
		expect(get(playedEpisodes)[episodeKey]?.time).toBe(42);
	});

	test("does not reuse a same-title downloaded audio file for a video episode", async () => {
		downloadedEpisodes.set({
			[testEpisode.podcastName]: [
				{
					...testEpisode,
					title: "Video Episode",
					streamUrl: "https://pod.example.com/audio.mp3",
					filePath: "Downloads/audio.mp3",
					size: 10,
				},
			],
		});
		const videoEpisode: Episode = {
			...testEpisode,
			title: "Video Episode",
			streamUrl: "https://pod.example.com/video.mp4",
			mediaType: "video",
		};
		currentEpisode.set(videoEpisode);

		const { container } = render(EpisodePlayer);
		await waitFor(() => {
			expect(container.querySelector("video")).not.toBeNull();
		});
		const video = container.querySelector("video") as HTMLVideoElement;

		expect(container.querySelector("audio")).toBeNull();
		expect(video.getAttribute("src")).toBe(videoEpisode.streamUrl);
	});

	test("uses a legacy downloaded audio mp4 file for an explicitly audio feed episode", async () => {
		mockVaultFile("Downloads/legacy-audio.mp4");
		const audioEpisode: Episode = {
			...testEpisode,
			title: "Legacy Audio MP4",
			streamUrl: "https://cdn.example.com/episode.mp4",
			mediaType: "audio",
		};
		downloadedEpisodes.set({
			[testEpisode.podcastName]: [
				{
					...testEpisode,
					title: "Legacy Audio MP4",
					streamUrl: "https://cdn.example.com/episode.mp4",
					filePath: "Downloads/legacy-audio.mp4",
					size: 10,
				},
			],
		});
		currentEpisode.set(audioEpisode);

		const { container } = render(EpisodePlayer);
		await waitFor(() => {
			expect(container.querySelector("audio")).not.toBeNull();
		});
		const audio = container.querySelector("audio") as HTMLAudioElement;

		expect(container.querySelector("video")).toBeNull();
		expect(audio.getAttribute("src")).toBe("app://resource/Downloads/legacy-audio.mp4?token");
	});

	test("uses a legacy downloaded video mp4 file for an explicitly video feed episode", async () => {
		mockVaultFile("Downloads/legacy-video.mp4");
		const videoEpisode: Episode = {
			...testEpisode,
			title: "Legacy Video MP4",
			streamUrl: "https://cdn.example.com/episode.mp4",
			mediaType: "video",
		};
		downloadedEpisodes.set({
			[testEpisode.podcastName]: [
				{
					...testEpisode,
					title: "Legacy Video MP4",
					streamUrl: "https://cdn.example.com/episode.mp4",
					filePath: "Downloads/legacy-video.mp4",
					size: 10,
				},
			],
		});
		currentEpisode.set(videoEpisode);

		const { container } = render(EpisodePlayer);
		await waitFor(() => {
			expect(container.querySelector("video")).not.toBeNull();
		});
		const video = container.querySelector("video") as HTMLVideoElement;

		expect(container.querySelector("audio")).toBeNull();
		expect(video.getAttribute("src")).toBe("app://resource/Downloads/legacy-video.mp4?token");
	});

	test("uses matching downloaded video metadata to classify extensionless records", async () => {
		mockVaultFile("Downloads/video.mp4");
		const extensionlessEpisode: Episode = {
			...testEpisode,
			title: "Extensionless Video",
			streamUrl: "https://cdn.example.com/watch?id=42",
		};
		downloadedEpisodes.set({
			[testEpisode.podcastName]: [
				{
					...extensionlessEpisode,
					filePath: "Downloads/video.mp4",
					mediaType: "video",
					size: 10,
				},
			],
		});
		currentEpisode.set(extensionlessEpisode);

		const { container } = render(EpisodePlayer);
		await waitFor(() => {
			expect(container.querySelector("video")).not.toBeNull();
		});
		const video = container.querySelector("video") as HTMLVideoElement;

		expect(container.querySelector("audio")).toBeNull();
		expect(video.getAttribute("src")).toBe("app://resource/Downloads/video.mp4?token");
	});
});

describe("EpisodePlayer — persists playback position during playback (issue #33)", () => {
	const episodeKey = `${testEpisode.podcastName}::${testEpisode.title}`;

	afterEach(() => {
		vi.restoreAllMocks();
	});

	async function renderLoadedPlayer() {
		const { container } = render(EpisodePlayer);
		await waitFor(() => {
			expect(container.querySelector("audio")).not.toBeNull();
		});
		const audio = container.querySelector("audio") as HTMLAudioElement;
		// loadedmetadata flips isLoading off and runs the restore, after which
		// progress is allowed to persist.
		await fireEvent.loadedMetadata(audio);
		return audio;
	}

	test("saves position on timeupdate, throttling rapid updates", async () => {
		let now = 1_000_000;
		vi.spyOn(Date, "now").mockImplementation(() => now);

		const audio = await renderLoadedPlayer();

		currentTime.set(120);
		await fireEvent.timeUpdate(audio);
		expect(get(playedEpisodes)[episodeKey]?.time).toBe(120);

		// A second update within the throttle window must not overwrite it.
		now += 2000;
		currentTime.set(121);
		await fireEvent.timeUpdate(audio);
		expect(get(playedEpisodes)[episodeKey]?.time).toBe(120);

		// Past the throttle window, the latest position is persisted.
		now += 4000;
		currentTime.set(200);
		await fireEvent.timeUpdate(audio);
		expect(get(playedEpisodes)[episodeKey]?.time).toBe(200);

		// Boundary: an update exactly SAVE_POSITION_THROTTLE_MS after the last save
		// is not throttled (the guard uses a strict <), so it persists.
		now += 5000;
		currentTime.set(260);
		await fireEvent.timeUpdate(audio);
		expect(get(playedEpisodes)[episodeKey]?.time).toBe(260);
	});

	test("saves the exact position immediately on pause, bypassing the throttle", async () => {
		let now = 5_000_000;
		vi.spyOn(Date, "now").mockImplementation(() => now);

		const audio = await renderLoadedPlayer();

		// Consume the leading-edge save so the throttle window is now active.
		currentTime.set(50);
		await fireEvent.timeUpdate(audio);
		expect(get(playedEpisodes)[episodeKey]?.time).toBe(50);

		// A timeupdate within the throttle window is ignored...
		now += 1000;
		currentTime.set(60);
		await fireEvent.timeUpdate(audio);
		expect(get(playedEpisodes)[episodeKey]?.time).toBe(50);

		// ...but a pause within the same window must still persist immediately.
		currentTime.set(137);
		await fireEvent.pause(audio);
		expect(get(playedEpisodes)[episodeKey]?.time).toBe(137);
	});

	test("does not clobber the saved position before metadata has loaded", async () => {
		playedEpisodes.setEpisodeTime(testEpisode, 1800, 3600, false);

		const { container } = render(EpisodePlayer);
		await waitFor(() => {
			expect(container.querySelector("audio")).not.toBeNull();
		});
		const audio = container.querySelector("audio") as HTMLAudioElement;

		// No loadedmetadata yet: isLoading is still true and currentTime is the
		// pre-restore 0. Neither a pause nor a timeupdate may overwrite 1800.
		currentTime.set(0);
		await fireEvent.pause(audio);
		await fireEvent.timeUpdate(audio);

		expect(get(playedEpisodes)[episodeKey]?.time).toBe(1800);
	});

	test("re-arms the load guard on episode switch so the next episode's saved position is not clobbered", async () => {
		const episodeB: Episode = {
			title: "Episode B",
			streamUrl: "https://pod.example.com/b.mp3",
			url: "https://pod.example.com/b",
			description: "",
			content: "",
			podcastName: "Test Podcast",
		};
		const keyB = `${episodeB.podcastName}::${episodeB.title}`;
		// B already has a saved resume position from a previous listen.
		playedEpisodes.setEpisodeTime(episodeB, 1800, 3600, false);

		const { container } = render(EpisodePlayer);
		await waitFor(() => {
			expect(container.querySelector("audio")).not.toBeNull();
		});
		await fireEvent.loadedMetadata(container.querySelector("audio") as HTMLAudioElement);

		// Switch to B in-player (queue click / auto-advance reuse this instance).
		// The re-arm must set isLoading=true until B's metadata loads.
		currentEpisode.set(episodeB);
		await waitFor(() => {
			const next = container.querySelector("audio");
			expect(next?.getAttribute("src")).toBe(episodeB.streamUrl);
		});
		const audioB = container.querySelector("audio") as HTMLAudioElement;

		// A pause/timeupdate during B's src swap, before its loadedmetadata and at
		// the pre-restore 0, must not overwrite B's saved 1800.
		currentTime.set(0);
		await fireEvent.pause(audioB);
		await fireEvent.timeUpdate(audioB);

		expect(get(playedEpisodes)[keyB]?.time).toBe(1800);
	});

	test("resets progress immediately on episode switch so the finished episode's bar is not shown against the next (issue #94)", async () => {
		const episodeB: Episode = {
			title: "Episode B",
			streamUrl: "https://pod.example.com/b.mp3",
			url: "https://pod.example.com/b",
			description: "",
			content: "",
			podcastName: "Test Podcast",
		};

		const { container } = render(EpisodePlayer);
		await waitFor(() => {
			expect(container.querySelector("audio")).not.toBeNull();
		});
		const audio = container.querySelector("audio") as HTMLAudioElement;
		await fireEvent.loadedMetadata(audio);

		// Simulate episode A finishing: progress pinned at the very end.
		currentTime.set(3600);
		duration.set(3600);
		await fireEvent.timeUpdate(audio);

		// Auto-advance (queue.playNext) swaps the episode via currentEpisode.set.
		currentEpisode.set(episodeB);
		await waitFor(() => {
			const next = container.querySelector("audio");
			expect(next?.getAttribute("src")).toBe(episodeB.streamUrl);
		});

		// Before B's loadedmetadata fires, the finished episode's playback position
		// must be cleared so the UI renders a zeroed loading state — not A's full
		// bar — for the duration of B's (network-bound) metadata fetch.
		expect(get(currentTime)).toBe(0);

		// The user-visible outcome: the progress bar collapses to 0% and neither
		// timestamp shows A's end or a garbled "NaN" (the bar/text must not lag the
		// title/artwork switch).
		const bar = container.querySelector(".progress__bar") as HTMLElement;
		expect(bar.style.width).toBe("0%");
		const [elapsed, remaining] = Array.from(
			container.querySelectorAll(".status-container span"),
		).map((s) => s.textContent);
		expect(elapsed).toBe("00:00:00");
		expect(remaining).toBe("00:00:00");
	});

	test("persists immediately when the app is backgrounded (visibilitychange → hidden)", async () => {
		await renderLoadedPlayer();
		currentTime.set(222);

		const originalDescriptor =
			Object.getOwnPropertyDescriptor(document, "visibilityState") ??
			Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			get: () => "hidden",
		});

		try {
			document.dispatchEvent(new Event("visibilitychange"));
			expect(get(playedEpisodes)[episodeKey]?.time).toBe(222);
		} finally {
			if (originalDescriptor) {
				Object.defineProperty(document, "visibilityState", originalDescriptor);
			}
		}
	});
});
