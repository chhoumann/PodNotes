import { get } from "svelte/store";
import { beforeEach, describe, expect, test } from "vitest";

import type { Episode } from "src/types/Episode";
import type { PlayedEpisode } from "src/types/PlayedEpisode";
import { playedEpisodes } from "./index";

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
