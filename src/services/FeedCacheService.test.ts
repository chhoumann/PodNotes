import { beforeEach, describe, expect, test } from "vitest";

import type { Episode } from "src/types/Episode";
import type { PodcastFeed } from "src/types/PodcastFeed";
import {
	clearFeedCache,
	getCachedEpisodes,
	setCachedEpisodes,
} from "./FeedCacheService";

const testFeed: PodcastFeed = {
	title: "Accidental Tech Podcast",
	url: "https://pod.example.com/feed.xml",
	artworkUrl: "https://pod.example.com/art.jpg",
};

function createEpisode(number: number): Episode {
	return {
		title: `Episode ${number}`,
		streamUrl: `https://pod.example.com/ep-${number}.mp3`,
		url: `https://pod.example.com/ep-${number}`,
		description: `Description for episode ${number}`,
		content: `<p>Episode ${number}</p>`,
		podcastName: testFeed.title,
		artworkUrl: testFeed.artworkUrl,
		episodeDate: new Date(`2024-01-${String((number % 28) + 1).padStart(2, "0")}T00:00:00.000Z`),
	};
}

describe("FeedCacheService", () => {
	beforeEach(() => {
		clearFeedCache();
	});

	test("persists at most 75 episodes per feed (#124 cap)", () => {
		const episodes = Array.from({ length: 100 }, (_, index) =>
			createEpisode(index + 1),
		);

		setCachedEpisodes(testFeed, episodes);

		const cached = getCachedEpisodes(testFeed);
		expect(cached).toHaveLength(75);
		expect(cached?.[0]?.title).toBe("Episode 1");
		expect(cached?.[74]?.title).toBe("Episode 75");
		expect(cached?.some((episode) => episode.title === "Episode 100")).toBe(
			false,
		);
	});

	test("returns persisted episodes within TTL", () => {
		const episodes = [createEpisode(1), createEpisode(2)];

		setCachedEpisodes(testFeed, episodes);

		expect(getCachedEpisodes(testFeed)).toEqual(episodes);
	});

	test("round-trips episodeNumber and duration (#34, #88)", () => {
		const episode: Episode = {
			...createEpisode(1),
			episodeNumber: 42,
			duration: 3723,
		};

		setCachedEpisodes(testFeed, [episode]);

		const cached = getCachedEpisodes(testFeed);
		expect(cached?.[0]?.episodeNumber).toBe(42);
		expect(cached?.[0]?.duration).toBe(3723);
	});
});
