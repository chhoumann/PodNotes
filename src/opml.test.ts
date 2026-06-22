import { get, writable } from "svelte/store";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { PodcastFeed } from "./types/PodcastFeed";

// Mock the heavy collaborators so the tests exercise only opml.ts's own
// parse/validate/serialize logic: FeedParser would otherwise make real network
// requests for every imported feed, and savedFeeds pulls in the whole store.
const savedFeeds = writable<Record<string, PodcastFeed>>({});
const getFeed = vi.fn(async (url: string) => ({
	title: `Feed for ${url}`,
	url,
	artworkUrl: "",
}));

vi.mock("./store", () => ({
	get savedFeeds() {
		return savedFeeds;
	},
}));

vi.mock("./parser/feedParser", () => ({
	default: class {
		getFeed = getFeed;
	},
}));

// The shared obsidian mock's Notice lacks setMessage, which TimerNotice calls
// on its progress ticker. Provide a minimal Notice with the methods opml.ts
// uses so the import flow can run to completion under jsdom.
vi.mock("obsidian", () => ({
	Notice: class {
		constructor(public message?: unknown) {}
		setMessage() {}
		hide() {}
	},
}));

import { exportOPML, importOPML } from "./opml";

beforeEach(() => {
	savedFeeds.set({});
	getFeed.mockClear();
});

/** Minimal Obsidian App stub capturing the single file vault.create writes. */
function makeApp(): {
	app: { vault: { create: Mock } };
	created: { path: string; data: string }[];
} {
	const created: { path: string; data: string }[] = [];
	const create = vi.fn(async (path: string, data: string) => {
		created.push({ path, data });
	});
	return { app: { vault: { create } }, created };
}

describe("exportOPML (IE-02)", () => {
	it("uses a well-formed XML declaration (utf-8, not utf=8)", async () => {
		const { app, created } = makeApp();
		await exportOPML(app as never, [], "out.opml");

		expect(created[0]?.data).toContain('encoding="utf-8"');
		expect(created[0]?.data).not.toContain("utf=8");
	});

	it('XML-escapes &, <, >, and " in titles and URLs', async () => {
		const { app, created } = makeApp();
		const feeds: PodcastFeed[] = [
			{
				title: 'Tom & Jerry <"news">',
				url: "https://x.test/feed?a=1&b=2",
				artworkUrl: "",
			},
		];

		await exportOPML(app as never, feeds, "out.opml");
		const doc = created[0]?.data ?? "";

		// Raw special characters must not survive into attribute values.
		expect(doc).toContain("Tom &amp; Jerry &lt;&quot;news&quot;&gt;");
		expect(doc).toContain("https://x.test/feed?a=1&amp;b=2");
		// `&` is escaped first, so entities are not double-escaped.
		expect(doc).not.toContain("&amp;amp;");
	});

	it("round-trips an escaped export back through importOPML", async () => {
		const { app, created } = makeApp();
		const feeds: PodcastFeed[] = [
			{
				title: "Tom & Jerry",
				url: "https://x.test/feed?a=1&b=2",
				artworkUrl: "",
			},
		];

		await exportOPML(app as never, feeds, "out.opml");
		await importOPML(created[0]?.data ?? "");

		// The escaped attributes parse back to the original raw values.
		expect(getFeed).toHaveBeenCalledTimes(1);
		expect(getFeed).toHaveBeenCalledWith("https://x.test/feed?a=1&b=2");
	});
});

describe("importOPML (IE-01)", () => {
	it("throws on invalid XML (parsererror is detected)", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		await importOPML("<opml><body><outline text='oops'></body></opml>");

		// importOPML catches and logs rather than rethrowing; assert it surfaced
		// the invalid-XML error and never reached the feed fetch.
		expect(consoleError).toHaveBeenCalledWith(
			"Error importing OPML:",
			expect.objectContaining({ message: "Invalid XML format" }),
		);
		expect(getFeed).not.toHaveBeenCalled();

		consoleError.mockRestore();
	});

	it("does not false-positive on valid OPML", async () => {
		const validOpml =
			'<?xml version="1.0" encoding="utf-8"?>' +
			'<opml version="1.0"><head><title>t</title></head>' +
			'<body><outline text="feeds">' +
			'<outline text="Show A" type="rss" xmlUrl="https://a.test/feed" />' +
			"</outline></body></opml>";

		await importOPML(validOpml);

		expect(getFeed).toHaveBeenCalledTimes(1);
		expect(getFeed).toHaveBeenCalledWith("https://a.test/feed");
	});

	it("imports feeds whose xmlUrl attribute is lower/variant cased", async () => {
		const opml =
			'<?xml version="1.0" encoding="utf-8"?>' +
			"<opml><body>" +
			'<outline text="Lower" xmlurl="https://lower.test/feed" />' +
			'<outline text="Mixed" XmlUrl="https://mixed.test/feed" />' +
			'<outline text="Upper" XMLURL="https://upper.test/feed" />' +
			'<outline text="Camel" xmlUrl="https://camel.test/feed" />' +
			"</body></opml>";

		await importOPML(opml);

		const urls = getFeed.mock.calls.map((c) => c[0]).sort();
		expect(urls).toEqual([
			"https://camel.test/feed",
			"https://lower.test/feed",
			"https://mixed.test/feed",
			"https://upper.test/feed",
		]);
	});

	it("skips outlines with an empty or missing url attribute", async () => {
		const opml =
			"<opml><body>" +
			'<outline text="NoUrl" />' +
			'<outline text="Empty" xmlUrl="   " />' +
			'<outline text="Good" xmlUrl="https://good.test/feed" />' +
			"</body></opml>";

		await importOPML(opml);

		expect(getFeed).toHaveBeenCalledTimes(1);
		expect(getFeed).toHaveBeenCalledWith("https://good.test/feed");
	});

	it("does not re-fetch a feed whose url is already saved", async () => {
		savedFeeds.set({
			Existing: {
				title: "Existing",
				url: "https://dup.test/feed",
				artworkUrl: "",
			},
		});

		const opml =
			"<opml><body>" +
			'<outline text="Dup" xmlUrl="https://dup.test/feed" />' +
			"</body></opml>";

		await importOPML(opml);

		expect(getFeed).not.toHaveBeenCalled();
		expect(Object.keys(get(savedFeeds))).toEqual(["Existing"]);
	});
});
