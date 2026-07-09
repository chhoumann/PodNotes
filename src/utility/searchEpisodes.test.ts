import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Episode } from "src/types/Episode";

// Wrap the real Fuse so we can count how many times an index is built. This lets
// the cache tests assert that an unchanged list reuses its index (the #149
// optimization) while a changed list rebuilds it - without altering Fuse's real
// search behaviour.
const { fuseConstructorSpy } = vi.hoisted(() => ({
	fuseConstructorSpy: vi.fn(),
}));

vi.mock("fuse.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("fuse.js")>();
	const RealFuse = actual.default;

	class CountingFuse extends RealFuse<Episode> {
		constructor(...args: ConstructorParameters<typeof RealFuse<Episode>>) {
			fuseConstructorSpy();
			super(...args);
		}
	}

	return { ...actual, default: CountingFuse };
});

import searchEpisodes from "./searchEpisodes";

function makeEpisode(title: string, streamUrl = `https://example.com/${title}.mp3`): Episode {
	return {
		title,
		streamUrl,
		url: streamUrl,
		description: "",
		content: "",
		podcastName: "Test Podcast",
	};
}

function titlesOf(episodes: Episode[]): string[] {
	return episodes.map((episode) => episode.title);
}

describe("searchEpisodes", () => {
	beforeEach(() => {
		fuseConstructorSpy.mockClear();
	});

	test("returns episodes whose title fuzzy-matches the query", () => {
		const episodes = [makeEpisode("Alpha"), makeEpisode("Beta")];

		expect(titlesOf(searchEpisodes("Alpha", episodes))).toEqual(["Alpha"]);
	});

	test("returns an empty array for an empty list without building an index", () => {
		expect(searchEpisodes("anything", [])).toEqual([]);
		expect(fuseConstructorSpy).not.toHaveBeenCalled();
	});

	test("restores the full list for a whitespace-only query", () => {
		const episodes = [makeEpisode("Alpha"), makeEpisode("Beta")];

		expect(searchEpisodes("   ", episodes)).toBe(episodes);
		// A whitespace query short-circuits, so no index is built.
		expect(fuseConstructorSpy).not.toHaveBeenCalled();
	});

	test("reuses the cached index for an unchanged list across searches", () => {
		const episodes = [makeEpisode("Alpha"), makeEpisode("Beta")];

		searchEpisodes("Alpha", episodes);
		searchEpisodes("Beta", episodes);

		// The same array reference with unchanged content builds the index once.
		expect(fuseConstructorSpy).toHaveBeenCalledTimes(1);
	});

	test("returns fresh results when the list is mutated in place at the same length", () => {
		const episodes = [makeEpisode("Alpha"), makeEpisode("Beta")];

		// Populate the cache against the original contents.
		expect(titlesOf(searchEpisodes("Alpha", episodes))).toEqual(["Alpha"]);

		// Replace both entries in place: same array reference, same length, new
		// content. A length-only cache check would return the stale index here.
		episodes[0] = makeEpisode("Gamma");
		episodes[1] = makeEpisode("Delta");

		// The old title is gone...
		expect(searchEpisodes("Alpha", episodes)).toEqual([]);
		// ...and the new content is searchable.
		expect(titlesOf(searchEpisodes("Gamma", episodes))).toEqual(["Gamma"]);
		// The index was rebuilt because the content signature changed.
		expect(fuseConstructorSpy).toHaveBeenCalledTimes(2);
	});

	test("rebuilds the index on a same-title swap to a different identity", () => {
		const episodes = [makeEpisode("Same", "https://example.com/first.mp3")];

		searchEpisodes("Same", episodes);

		// Same title, same length, but a different underlying episode (new
		// streamUrl). A length-only OR title-only signature would keep serving the
		// stale index here; folding streamUrl into the signature detects the swap.
		// Asserting the rebuild (not just the result) is what makes this test
		// meaningful: fuse.js reads the live array, so the streamUrl result is
		// correct either way - only the rebuild count distinguishes the fix.
		episodes[0] = makeEpisode("Same", "https://example.com/second.mp3");
		const results = searchEpisodes("Same", episodes);

		expect(results[0].streamUrl).toBe("https://example.com/second.mp3");
		expect(fuseConstructorSpy).toHaveBeenCalledTimes(2);
	});
});
