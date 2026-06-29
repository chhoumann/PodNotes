import { get, writable } from "svelte/store";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { PodcastFeed } from "./types/PodcastFeed";

// Mock the heavy collaborators so the tests exercise only opml.ts's own
// parse/validate/serialize logic: FeedParser would otherwise make real network
// requests for every imported feed, and savedFeeds pulls in the whole store.
const savedFeeds = writable<Record<string, PodcastFeed>>({});
const defaultGetFeed = async (url: string) => ({
	title: `Feed for ${url}`,
	url,
	artworkUrl: "",
});
const getFeed = vi.fn(defaultGetFeed);

// Every string the import flow renders into the progress Notice is recorded
// here so tests can assert on what the user actually sees (e.g. no "NaN%", an
// accurate saved count).
const noticeMessages = vi.hoisted(() => [] as string[]);

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
		constructor(message?: unknown) {
			if (typeof message === "string") noticeMessages.push(message);
		}
		setMessage(message?: unknown) {
			if (typeof message === "string") noticeMessages.push(message);
		}
		hide() {}
	},
}));

import { exportOPML, importOPML } from "./opml";

beforeEach(() => {
	savedFeeds.set({});
	getFeed.mockReset();
	getFeed.mockImplementation(defaultGetFeed);
	noticeMessages.length = 0;
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

	it("never renders 'NaN%' when every feed is already subscribed", async () => {
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

		// Nothing to fetch, so the 0/0 progress division must not surface as NaN.
		expect(getFeed).not.toHaveBeenCalled();
		expect(noticeMessages.some((m) => m.includes("NaN"))).toBe(false);
		expect(noticeMessages.some((m) => m.includes("Saved 0 new podcasts"))).toBe(
			true,
		);
	});

	it("reports the saved count, not the fetched count, on duplicate titles", async () => {
		// Two distinct URLs that resolve to the same feed title. Both fetch fine,
		// but the title-keyed store can only hold one of them.
		getFeed.mockImplementation(async (url: string) => ({
			title: "Same Title",
			url,
			artworkUrl: "",
		}));

		const opml =
			"<opml><body>" +
			'<outline text="A" xmlUrl="https://a.test/feed" />' +
			'<outline text="B" xmlUrl="https://b.test/feed" />' +
			"</body></opml>";

		await importOPML(opml);

		expect(getFeed).toHaveBeenCalledTimes(2);
		expect(Object.keys(get(savedFeeds))).toEqual(["Same Title"]);
		// Exactly one was written, so the summary must say "Saved 1", not "Saved 2".
		expect(noticeMessages.some((m) => m.includes("Saved 1 new podcasts"))).toBe(
			true,
		);
		expect(noticeMessages.some((m) => m.includes("Saved 2 new podcasts"))).toBe(
			false,
		);
		expect(
			noticeMessages.some((m) => m.includes("Skipped 1 with duplicate titles")),
		).toBe(true);
	});

	it("counts a title-collision against an existing feed as not saved", async () => {
		// The existing feed has a different URL, so the new feed passes the
		// URL-dedup and is fetched, but its title collides and it is dropped.
		savedFeeds.set({
			"Same Title": {
				title: "Same Title",
				url: "https://old.test/feed",
				artworkUrl: "",
			},
		});
		getFeed.mockImplementation(async (url: string) => ({
			title: "Same Title",
			url,
			artworkUrl: "",
		}));

		const opml =
			"<opml><body>" +
			'<outline text="New" xmlUrl="https://new.test/feed" />' +
			"</body></opml>";

		await importOPML(opml);

		expect(getFeed).toHaveBeenCalledTimes(1);
		expect(Object.keys(get(savedFeeds))).toEqual(["Same Title"]);
		// The original feed must be preserved, not overwritten.
		expect(get(savedFeeds)["Same Title"].url).toBe("https://old.test/feed");
		expect(noticeMessages.some((m) => m.includes("Saved 0 new podcasts"))).toBe(
			true,
		);
		expect(
			noticeMessages.some((m) => m.includes("Skipped 1 with duplicate titles")),
		).toBe(true);
	});

	it("reports URL-skipped and title-dropped feeds in distinct counters", async () => {
		// One feed is already saved by URL (skipped before fetch); two new feeds
		// share a title (one saved, one title-dropped). Each bucket is counted on
		// its own axis so the summary stays honest.
		savedFeeds.set({
			Old: { title: "Old", url: "https://old.test/feed", artworkUrl: "" },
		});
		getFeed.mockImplementation(async (url: string) => ({
			title: "Shared",
			url,
			artworkUrl: "",
		}));

		const opml =
			"<opml><body>" +
			'<outline text="Old" xmlUrl="https://old.test/feed" />' +
			'<outline text="A" xmlUrl="https://a.test/feed" />' +
			'<outline text="B" xmlUrl="https://b.test/feed" />' +
			"</body></opml>";

		await importOPML(opml);

		// Only the two new URLs are fetched; one is saved, the other title-dropped.
		expect(getFeed).toHaveBeenCalledTimes(2);
		expect(Object.keys(get(savedFeeds)).sort()).toEqual(["Old", "Shared"]);
		expect(
			noticeMessages.some(
				(m) =>
					m.includes("Saved 1 new podcasts") &&
					m.includes("Skipped 1 existing podcasts") &&
					m.includes("Skipped 1 with duplicate titles"),
			),
		).toBe(true);
	});
});
