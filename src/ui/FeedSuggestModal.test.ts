import { describe, expect, it } from "vitest";
import { orderFeedsByCurrent } from "./FeedSuggestModal";
import type { PodcastFeed } from "src/types/PodcastFeed";

const feed = (title: string): PodcastFeed => ({
	title,
	url: `https://example.com/${title}`,
	artworkUrl: "",
});

describe("orderFeedsByCurrent", () => {
	it("returns feeds unchanged when there is no current podcast", () => {
		const feeds = [feed("A"), feed("B")];
		expect(orderFeedsByCurrent(feeds).map((f) => f.title)).toEqual(["A", "B"]);
	});

	it("moves the current podcast's feed to the front", () => {
		const feeds = [feed("A"), feed("B"), feed("C")];
		expect(orderFeedsByCurrent(feeds, "B").map((f) => f.title)).toEqual([
			"B",
			"A",
			"C",
		]);
	});

	it("is a no-op when the current podcast has no saved feed", () => {
		const feeds = [feed("A"), feed("B")];
		expect(orderFeedsByCurrent(feeds, "Z").map((f) => f.title)).toEqual([
			"A",
			"B",
		]);
	});
});
