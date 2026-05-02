import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { get } from "svelte/store";
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
	currentEpisode,
	currentTime,
	duration,
	isPaused,
	playedEpisodes,
	plugin,
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
	playedEpisodes.set({});
	requestedPlaybackTime.set(null);
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
});
