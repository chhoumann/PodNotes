import { describe, expect, test } from "vitest";
import type { Episode } from "src/types/Episode";
import searchEpisodes from "./searchEpisodes";

function makeEpisode(title: string): Episode {
	const streamUrl = `https://example.com/${title}.mp3`;
	return {
		title,
		streamUrl,
		url: streamUrl,
		description: "",
		content: "",
		podcastName: "Test Podcast",
	};
}

function titlesOf(episodes: readonly Episode[]): string[] {
	return episodes.map((episode) => episode.title);
}

const planetMoney = [
	"Should we all be getting tariff refunds right now?",
	"Charles Ponzi's scheme (plus a new scam)",
	"Where all those weird new drinks are coming from",
	"Who's gonna pay for your Social Security?",
	"The Indicator from Planet Money",
	"Planet Money Summer School 1: Economics is everywhere",
	"Summer School 2: Supply and demand, explained with drinks",
	"Money",
].map((title) => makeEpisode(title));

describe("searchEpisodes", () => {
	test("returns episodes whose title fuzzy-matches the query", () => {
		const episodes = [makeEpisode("Alpha"), makeEpisode("Beta")];

		expect(titlesOf(searchEpisodes("Alpha", episodes))).toEqual(["Alpha"]);
	});

	test("returns an empty array for an empty list", () => {
		expect(searchEpisodes("anything", [])).toEqual([]);
	});

	test("restores the full list for a whitespace-only query", () => {
		const episodes = [makeEpisode("Alpha"), makeEpisode("Beta")];

		expect(searchEpisodes("   ", episodes)).toBe(episodes);
	});

	test("returns fresh results when the list is mutated in place at the same length", () => {
		const episodes = [makeEpisode("Alpha"), makeEpisode("Beta")];

		expect(titlesOf(searchEpisodes("Alpha", episodes))).toEqual(["Alpha"]);

		episodes[0] = makeEpisode("Gamma");
		episodes[1] = makeEpisode("Delta");

		expect(searchEpisodes("Alpha", episodes)).toEqual([]);
		expect(titlesOf(searchEpisodes("Gamma", episodes))).toEqual(["Gamma"]);
	});

	// Expected rankings are fuse.js 7.5.0 output for the options PodNotes used.
	test("ranks the titles a misspelled query matches", () => {
		expect(titlesOf(searchEpisodes("summer schol", planetMoney))).toEqual([
			"Summer School 2: Supply and demand, explained with drinks",
			"Planet Money Summer School 1: Economics is everywhere",
		]);
	});

	test("ranks the keystrokes of a typed query", () => {
		expect(titlesOf(searchEpisodes("new", planetMoney))).toEqual([
			"Money",
			"Where all those weird new drinks are coming from",
			"Charles Ponzi's scheme (plus a new scam)",
			"Planet Money Summer School 1: Economics is everywhere",
		]);
		expect(titlesOf(searchEpisodes("new s", planetMoney))).toEqual([
			"Planet Money Summer School 1: Economics is everywhere",
			"Charles Ponzi's scheme (plus a new scam)",
		]);
	});

	test("matches a query longer than 32 characters on all of it", () => {
		const episodes = [
			makeEpisode("The Indicator from Planet Money: Why tariffs raise prices"),
			makeEpisode("The Indicator from Planet Money: Why rent keeps going up"),
		];

		expect(
			titlesOf(
				searchEpisodes("the indicator from planet money why rent keeps going up", episodes),
			),
		).toEqual([
			"The Indicator from Planet Money: Why rent keeps going up",
			"The Indicator from Planet Money: Why tariffs raise prices",
		]);
	});

	test("returns nothing for a query that matches no title", () => {
		expect(searchEpisodes("zzzz", planetMoney)).toEqual([]);
	});
});
