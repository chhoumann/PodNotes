import { describe, expect, test } from "vitest";
import type { FeedState } from "src/services/FeedRepository";
import { headFor, pageExists, pageLabel, parsePage, type Head, type Page } from "./pages";
import type { Layout } from "./layout";

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
	expect(pageLabel({ kind: "feed", key: "Show" }, feeds)).toBe("The Show");
	expect(pageLabel({ kind: "playlist", name: "Walks" }, feeds)).toBe("Walks");
	expect(pageLabel({ kind: "library" }, feeds)).toBe("Library");
	expect(pageLabel({ kind: "latest" }, feeds)).toBe("Latest episodes");
});

test("a removed podcast or playlist no longer exists", () => {
	const names = new Set(["Favorites"]);
	expect(pageExists({ kind: "feed", key: "Show" }, feeds, names)).toBe(true);
	expect(pageExists({ kind: "feed", key: "Gone" }, feeds, names)).toBe(false);
	expect(pageExists({ kind: "playlist", name: "Favorites" }, feeds, names)).toBe(true);
	expect(pageExists({ kind: "playlist", name: "Walks" }, feeds, names)).toBe(false);
	expect(pageExists({ kind: "played" }, feeds, names)).toBe(true);
});

describe("headFor", () => {
	const latest: Page = { kind: "latest" };
	const show: Page = { kind: "feed", key: "Show" };
	const walks: Page = { kind: "playlist", name: "Walks" };

	test.each<[Layout, Page, Page | undefined, Head]>([
		["compact", { kind: "library" }, undefined, { title: "Library", action: "library" }],
		["wide", { kind: "library" }, undefined, { title: "Podcasts", action: "refresh-all" }],
		["compact", latest, undefined, { back: "Library", pageTitle: "Latest episodes" }],
		["wide", latest, show, { title: "Latest episodes" }],
		["compact", show, latest, { back: "Latest episodes", action: "podcast" }],
		["wide", show, undefined, { back: "Library", action: "podcast" }],
		["compact", walks, undefined, { back: "Playlists", pageTitle: "Walks" }],
		["wide", walks, show, { back: "The Show", pageTitle: "Walks" }],
		["compact", { kind: "add" }, show, { back: "The Show", search: true }],
		["compact", { kind: "add" }, undefined, { back: "Library", search: true }],
		["wide", { kind: "add" }, { kind: "library" }, { back: "Library", search: true }],
		["wide", { kind: "add" }, undefined, { search: true }],
	])("%s %j after %j", (layout, page, previous, head) => {
		expect(headFor(page, layout, previous, feeds)).toEqual(head);
	});
});
