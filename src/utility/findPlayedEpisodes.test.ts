import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Episode } from "src/types/Episode";
import type { PlayedEpisode } from "src/types/PlayedEpisode";
import type { PodcastFeed } from "src/types/PodcastFeed";

// Feed parsing hits the network, so stub it with a per-url lookup the tests fill in.
const { feedEpisodes } = vi.hoisted(() => ({
	feedEpisodes: new Map<string, Episode[]>(),
}));

vi.mock("src/parser/feedParser", () => ({
	default: class {
		private feed: PodcastFeed | undefined;
		constructor(feed?: PodcastFeed) {
			this.feed = feed;
		}
		async getEpisodes(url: string): Promise<Episode[]> {
			return feedEpisodes.get(url) ?? [];
		}
	},
}));

import findPlayedEpisodesInFeeds from "./findPlayedEpisodes";

function playedEp(title: string, podcastName: string): PlayedEpisode {
	return { title, podcastName, time: 0, duration: 0, finished: true };
}

function episode(title: string, podcastName: string): Episode {
	return {
		title,
		podcastName,
		streamUrl: "",
		url: "",
		description: "",
		content: "",
	};
}

function feed(title: string, url: string): PodcastFeed {
	return { title, url, artworkUrl: "" };
}

describe("findPlayedEpisodesInFeeds", () => {
	beforeEach(() => {
		feedEpisodes.clear();
	});

	it("does not crash when a feed-controlled podcast name shadows Object.prototype (#other-unsafe-object-key)", async () => {
		// "__proto__"/"constructor"/"hasOwnProperty" resolve to inherited members on
		// a plain object accumulator and would throw on `.push`; a Map keys safely.
		const played = [
			playedEp("Ep A", "__proto__"),
			playedEp("Ep B", "constructor"),
			playedEp("Ep C", "hasOwnProperty"),
		];

		await expect(findPlayedEpisodesInFeeds(played, [])).resolves.toEqual([]);
	});

	it("returns the feed episodes whose title matches a played episode, including for a __proto__ feed", async () => {
		feedEpisodes.set("https://a.example/feed", [
			episode("Ep A", "Pod A"),
			episode("Ep Z", "Pod A"),
		]);
		feedEpisodes.set("https://proto.example/feed", [
			episode("Ep P", "__proto__"),
		]);

		const played = [
			playedEp("Ep A", "Pod A"),
			playedEp("Missing", "Pod A"),
			playedEp("Ep P", "__proto__"),
		];
		const feeds = [
			feed("Pod A", "https://a.example/feed"),
			feed("__proto__", "https://proto.example/feed"),
		];

		const result = await findPlayedEpisodesInFeeds(played, feeds);

		expect(result.map((e) => e.title)).toEqual(["Ep A", "Ep P"]);
	});

	it("skips played episodes whose podcast is not among the feeds", async () => {
		feedEpisodes.set("https://a.example/feed", [episode("Ep A", "Pod A")]);

		const result = await findPlayedEpisodesInFeeds(
			[playedEp("Ep A", "Pod A"), playedEp("Ep B", "Unsubscribed")],
			[feed("Pod A", "https://a.example/feed")],
		);

		expect(result.map((e) => e.title)).toEqual(["Ep A"]);
	});
});
