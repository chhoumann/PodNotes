import { describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS } from "src/constants";
import type { FeedState } from "src/services/FeedRepository";
import type { Episode } from "src/types/Episode";
import {
	headFor,
	pageExists,
	pageLabel,
	parsePage,
	type Head,
	type HeadLists,
	type Page,
} from "./pages";
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
	const empty: HeadLists = {
		queue: structuredClone(DEFAULT_SETTINGS.queue),
		favorites: structuredClone(DEFAULT_SETTINGS.favorites),
		playlists: {},
		played: {},
	};

	test.each<[Layout, Page, Page | undefined, Head]>([
		["compact", { kind: "library" }, undefined, { title: "Library", action: "library" }],
		["wide", { kind: "library" }, undefined, { title: "Podcasts", action: "refresh-all" }],
		[
			"compact",
			latest,
			undefined,
			{ back: "Library", pageTitle: "Latest episodes", action: "refresh-all" },
		],
		["wide", latest, show, { title: "Latest episodes", action: "refresh-all" }],
		["compact", show, latest, { back: "Latest episodes", action: "podcast" }],
		["wide", show, undefined, { back: "Library", action: "podcast" }],
		[
			"compact",
			walks,
			undefined,
			{ back: "Playlists", pageTitle: "Walks", action: "playlist" },
		],
		["wide", walks, show, { back: "The Show", pageTitle: "Walks", action: "playlist" }],
		["compact", { kind: "add" }, show, { back: "The Show", search: true }],
		["compact", { kind: "add" }, undefined, { back: "Library", search: true }],
		["wide", { kind: "add" }, { kind: "library" }, { back: "Library", search: true }],
		["wide", { kind: "add" }, undefined, { search: true }],
		[
			"compact",
			{ kind: "local" },
			undefined,
			{ back: "Library", pageTitle: "Local files", action: "local" },
		],
		["wide", { kind: "local" }, show, { title: "Local files", action: "local" }],
	])("%s %j after %j", (layout, page, previous, head) => {
		expect(headFor(page, layout, previous, feeds, empty)).toEqual(head);
	});

	const episode = (title: string, duration?: number): Episode => ({
		title,
		streamUrl: `https://media.test/${title}.mp3`,
		url: "",
		description: "",
		content: "",
		podcastName: "The Show",
		duration,
	});
	const lists: HeadLists = {
		...empty,
		queue: { ...empty.queue, episodes: [episode("One", 45 * 60), episode("Two", 30 * 60)] },
		favorites: { ...empty.favorites, episodes: [episode("One")] },
		playlists: {
			Walks: {
				...empty.favorites,
				name: "Walks",
				episodes: [episode("One"), episode("Two")],
			},
		},
		played: {
			"The Show::Two": {
				title: "Two",
				podcastName: "The Show",
				time: 600,
				duration: 1800,
				finished: false,
			},
		},
	};

	test.each<[Layout, Page, Head]>([
		["wide", { kind: "queue" }, { title: "Queue", flair: "1 h 5 min", action: "queue" }],
		[
			"compact",
			{ kind: "queue" },
			{ back: "Library", pageTitle: "Queue", flair: "1 h 5 min", action: "queue" },
		],
		[
			"compact",
			walks,
			{ back: "Playlists", pageTitle: "Walks", flair: "2", action: "playlist" },
		],
		[
			"wide",
			{ kind: "playlist", name: "Favorites" },
			{ back: "Playlists", pageTitle: "Favorites", flair: "1" },
		],
	])("%s %j has a flair beside its title", (layout, page, head) => {
		expect(headFor(page, layout, undefined, feeds, lists)).toEqual(head);
	});

	test("an empty queue, or one of unknown length, has no flair; an empty playlist counts 0", () => {
		const unknown = { ...empty, queue: { ...empty.queue, episodes: [episode("One")] } };
		expect(headFor({ kind: "queue" }, "wide", undefined, feeds, empty).flair).toBeUndefined();
		expect(headFor({ kind: "queue" }, "wide", undefined, feeds, unknown).flair).toBeUndefined();
		expect(
			headFor({ kind: "playlist", name: "Favorites" }, "wide", undefined, feeds, empty).flair,
		).toBe("0");
	});
});
