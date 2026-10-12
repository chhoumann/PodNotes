import { describe, expect, test } from "vitest";
import type { FeedState } from "src/services/FeedRepository";
import { pageExists, pageLabel, parsePage } from "./pages";

const feeds = new Map([
	[
		"Show",
		{ feed: { title: "The Show", url: "", artworkUrl: "" }, status: "ready", episodes: [] },
	],
]) as ReadonlyMap<string, FeedState>;

describe("parsePage", () => {
	test.each([undefined, null, "library", 3, [], {}, { kind: "settings" }, { kind: "Library" }])(
		"rejects %j",
		(value) => {
			expect(parsePage(value)).toBeUndefined();
		},
	);

	test.each([{ kind: "feed" }, { kind: "feed", key: 3 }, { kind: "playlist", key: "Favorites" }])(
		"rejects %j, which names no podcast or playlist",
		(value) => {
			expect(parsePage(value)).toBeUndefined();
		},
	);

	test("keeps only the fields of the page", () => {
		expect(parsePage({ kind: "queue", key: "Show", scrollTop: 10 })).toEqual({ kind: "queue" });
		expect(parsePage({ kind: "feed", key: "Show", name: "x" })).toEqual({
			kind: "feed",
			key: "Show",
		});
		expect(parsePage({ kind: "playlist", name: "Walks" })).toEqual({
			kind: "playlist",
			name: "Walks",
		});
	});
});

test("a page labels itself by its podcast, its playlist or its root", () => {
	expect(pageLabel({ kind: "feed", key: "Show" }, "compact", feeds)).toBe("The Show");
	expect(pageLabel({ kind: "playlist", name: "Walks" }, "wide", feeds)).toBe("Walks");
	expect(pageLabel({ kind: "library" }, "compact", feeds)).toBe("Library");
	expect(pageLabel({ kind: "library" }, "wide", feeds)).toBe("Podcasts");
	expect(pageLabel({ kind: "latest" }, "compact", feeds)).toBe("Latest episodes");
});

test("a removed podcast or playlist no longer exists", () => {
	const names = new Set(["Favorites"]);
	expect(pageExists({ kind: "feed", key: "Show" }, feeds, names)).toBe(true);
	expect(pageExists({ kind: "feed", key: "Gone" }, feeds, names)).toBe(false);
	expect(pageExists({ kind: "playlist", name: "Favorites" }, feeds, names)).toBe(true);
	expect(pageExists({ kind: "playlist", name: "Walks" }, feeds, names)).toBe(false);
	expect(pageExists({ kind: "played" }, feeds, names)).toBe(true);
});
