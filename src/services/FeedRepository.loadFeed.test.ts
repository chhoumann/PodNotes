// @vitest-environment jsdom
import { expect, test, vi } from "vitest";

import { fetchTextWithTimeout } from "src/utility/networkRequest";
import { loadFeed } from "./FeedRepository";

vi.mock("src/utility/networkRequest", () => ({ fetchTextWithTimeout: vi.fn() }));

test("loads a feed through the bounded request boundary and parses it", async () => {
	vi.mocked(fetchTextWithTimeout).mockResolvedValue(
		`<rss><channel><title>Loaded</title><item><title>One</title><enclosure url="https://media.test/1.mp3"/></item></channel></rss>`,
	);

	const parsed = await loadFeed("https://feeds.test/feed.xml");

	expect(fetchTextWithTimeout).toHaveBeenCalledWith("https://feeds.test/feed.xml", {
		timeoutMs: 30_000,
		maxResponseBytes: 16 * 1024 * 1024,
		acceptedStatuses: [200],
	});
	expect(parsed.feed.title).toBe("Loaded");
	expect(parsed.episodes.map((episode) => episode.streamUrl)).toEqual([
		"https://media.test/1.mp3",
	]);
});
