import { describe, expect, test, vi, beforeEach } from "vitest";
import FeedParser from "./feedParser";
import type { PodcastFeed } from "src/types/PodcastFeed";

vi.mock("src/utility/networkRequest", () => ({
	requestWithTimeout: vi.fn(),
}));

import { requestWithTimeout } from "src/utility/networkRequest";

const mockRequestWithTimeout = vi.mocked(requestWithTimeout);

const sampleRssFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Test Podcast</title>
    <link>https://example.com</link>
    <image>
      <url>https://example.com/artwork.jpg</url>
    </image>
    <item>
      <title>Episode 1</title>
      <enclosure url="https://example.com/episode1.mp3" type="audio/mpeg"/>
      <link>https://example.com/episode1</link>
      <description>First episode description</description>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
      <itunes:title>Episode 1 iTunes Title</itunes:title>
    </item>
    <item>
      <title>Episode 2</title>
      <enclosure url="https://example.com/episode2.mp3" type="audio/mpeg"/>
      <link>https://example.com/episode2</link>
      <description>Second episode description</description>
      <pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const sampleRssFeedWithItunesImage = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Test Podcast With iTunes Image</title>
    <link>https://example.com</link>
    <image href="https://example.com/itunes-artwork.jpg"/>
    <item>
      <title>Episode 1</title>
      <enclosure url="https://example.com/episode1.mp3" type="audio/mpeg"/>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
      <image href="https://example.com/episode1-artwork.jpg"/>
    </item>
  </channel>
</rss>`;

const invalidRssFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <description>Missing title and link</description>
  </channel>
</rss>`;

const rssFeedWithInvalidItem = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Podcast</title>
    <link>https://example.com</link>
    <item>
      <title>Valid Episode</title>
      <enclosure url="https://example.com/episode.mp3"/>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Invalid Episode - Missing enclosure</title>
      <pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Invalid Episode - Missing pubDate</title>
      <enclosure url="https://example.com/episode2.mp3"/>
    </item>
  </channel>
</rss>`;

describe("FeedParser", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("getFeed", () => {
		test("parses feed title and URL correctly", async () => {
			mockRequestWithTimeout.mockResolvedValueOnce({
				text: sampleRssFeed,
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
				json: {},
			});

			const parser = new FeedParser();
			const feed = await parser.getFeed("https://example.com/feed.xml");

			expect(feed.title).toBe("Test Podcast");
			expect(feed.url).toBe("https://example.com/feed.xml");
		});

		test("parses artwork URL from image element", async () => {
			mockRequestWithTimeout.mockResolvedValueOnce({
				text: sampleRssFeed,
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
				json: {},
			});

			const parser = new FeedParser();
			const feed = await parser.getFeed("https://example.com/feed.xml");

			expect(feed.artworkUrl).toBe("https://example.com/artwork.jpg");
		});

		test("parses artwork URL from itunes:image href attribute", async () => {
			mockRequestWithTimeout.mockResolvedValueOnce({
				text: sampleRssFeedWithItunesImage,
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
				json: {},
			});

			const parser = new FeedParser();
			const feed = await parser.getFeed("https://example.com/feed.xml");

			expect(feed.artworkUrl).toBe("https://example.com/itunes-artwork.jpg");
		});

		test("throws error for invalid RSS feed without title", async () => {
			mockRequestWithTimeout.mockResolvedValueOnce({
				text: invalidRssFeed,
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
				json: {},
			});

			const parser = new FeedParser();

			await expect(parser.getFeed("https://example.com/feed.xml")).rejects.toThrow(
				"Invalid RSS feed",
			);
		});
	});

	describe("getEpisodes", () => {
		test("parses all valid episodes from feed", async () => {
			// getEpisodes now calls getFeed first, then parseFeed again
			mockRequestWithTimeout
				.mockResolvedValueOnce({
					text: sampleRssFeed,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				})
				.mockResolvedValueOnce({
					text: sampleRssFeed,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				});

			const parser = new FeedParser();
			const episodes = await parser.getEpisodes("https://example.com/feed.xml");

			expect(episodes).toHaveLength(2);
			expect(episodes[0].title).toBe("Episode 1");
			expect(episodes[1].title).toBe("Episode 2");
		});

		test("parses episode properties correctly and populates feed metadata", async () => {
			mockRequestWithTimeout
				.mockResolvedValueOnce({
					text: sampleRssFeed,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				})
				.mockResolvedValueOnce({
					text: sampleRssFeed,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				});

			const parser = new FeedParser();
			const episodes = await parser.getEpisodes("https://example.com/feed.xml");

			const episode = episodes[0];
			expect(episode.title).toBe("Episode 1");
			expect(episode.streamUrl).toBe("https://example.com/episode1.mp3");
			expect(episode.url).toBe("https://example.com/episode1");
			expect(episode.description).toBe("First episode description");
			expect(episode.episodeDate).toEqual(new Date("Mon, 01 Jan 2024 00:00:00 GMT"));
			expect(episode.itunesTitle).toBe("Episode 1 iTunes Title");
			// Feed metadata should now be populated
			expect(episode.podcastName).toBe("Test Podcast");
			expect(episode.feedUrl).toBe("https://example.com/feed.xml");
		});

		test("filters out invalid episodes missing required fields", async () => {
			mockRequestWithTimeout
				.mockResolvedValueOnce({
					text: rssFeedWithInvalidItem,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				})
				.mockResolvedValueOnce({
					text: rssFeedWithInvalidItem,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				});

			const parser = new FeedParser();
			const episodes = await parser.getEpisodes("https://example.com/feed.xml");

			expect(episodes).toHaveLength(1);
			expect(episodes[0].title).toBe("Valid Episode");
		});

		test("uses feed artwork when episode has no artwork", async () => {
			const mockFeed: PodcastFeed = {
				title: "Test Podcast",
				url: "https://example.com/feed.xml",
				artworkUrl: "https://example.com/feed-artwork.jpg",
			};

			mockRequestWithTimeout.mockResolvedValueOnce({
				text: sampleRssFeed,
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
				json: {},
			});

			// When constructed with a feed, it skips calling getFeed
			const parser = new FeedParser(mockFeed);
			const episodes = await parser.getEpisodes("https://example.com/feed.xml");

			expect(episodes[1].artworkUrl).toBe("https://example.com/feed-artwork.jpg");
		});

		test("uses episode artwork from itunes:image when available", async () => {
			mockRequestWithTimeout
				.mockResolvedValueOnce({
					text: sampleRssFeedWithItunesImage,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				})
				.mockResolvedValueOnce({
					text: sampleRssFeedWithItunesImage,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				});

			const parser = new FeedParser();
			const episodes = await parser.getEpisodes("https://example.com/feed.xml");

			expect(episodes[0].artworkUrl).toBe("https://example.com/episode1-artwork.jpg");
		});
	});

	describe("findItemByTitle", () => {
		test("finds episode by exact title match", async () => {
			mockRequestWithTimeout
				.mockResolvedValueOnce({
					text: sampleRssFeed,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				})
				.mockResolvedValueOnce({
					text: sampleRssFeed,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				});

			const parser = new FeedParser();
			const episode = await parser.findItemByTitle(
				"Episode 1",
				"https://example.com/feed.xml",
			);

			expect(episode.title).toBe("Episode 1");
			expect(episode.streamUrl).toBe("https://example.com/episode1.mp3");
		});

		test("throws error when episode not found", async () => {
			mockRequestWithTimeout
				.mockResolvedValueOnce({
					text: sampleRssFeed,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				})
				.mockResolvedValueOnce({
					text: sampleRssFeed,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				});

			const parser = new FeedParser();

			await expect(
				parser.findItemByTitle("Non-existent Episode", "https://example.com/feed.xml"),
			).rejects.toThrow("Could not find episode");
		});

		test("finds episode with case-insensitive matching", async () => {
			mockRequestWithTimeout
				.mockResolvedValueOnce({
					text: sampleRssFeed,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				})
				.mockResolvedValueOnce({
					text: sampleRssFeed,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				});

			const parser = new FeedParser();
			const episode = await parser.findItemByTitle(
				"EPISODE 1",
				"https://example.com/feed.xml",
			);

			expect(episode.title).toBe("Episode 1");
		});

		test("finds episode with whitespace trimming", async () => {
			mockRequestWithTimeout
				.mockResolvedValueOnce({
					text: sampleRssFeed,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				})
				.mockResolvedValueOnce({
					text: sampleRssFeed,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				});

			const parser = new FeedParser();
			const episode = await parser.findItemByTitle(
				"  Episode 1  ",
				"https://example.com/feed.xml",
			);

			expect(episode.title).toBe("Episode 1");
		});

		test("fills in missing episode data from feed", async () => {
			const feedWithMissingEpisodeData = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Feed Title</title>
    <link>https://example.com</link>
    <image>
      <url>https://example.com/feed-artwork.jpg</url>
    </image>
    <item>
      <title>Episode Without Artwork</title>
      <enclosure url="https://example.com/episode.mp3"/>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

			mockRequestWithTimeout
				.mockResolvedValueOnce({
					text: feedWithMissingEpisodeData,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				})
				.mockResolvedValueOnce({
					text: feedWithMissingEpisodeData,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				});

			const parser = new FeedParser();
			const episode = await parser.findItemByTitle(
				"Episode Without Artwork",
				"https://example.com/feed.xml",
			);

			expect(episode.artworkUrl).toBe("https://example.com/feed-artwork.jpg");
			expect(episode.podcastName).toBe("Feed Title");
			expect(episode.feedUrl).toBe("https://example.com/feed.xml");
		});
	});

	describe("constructor", () => {
		test("accepts optional feed parameter", () => {
			const mockFeed: PodcastFeed = {
				title: "Test Podcast",
				url: "https://example.com/feed.xml",
				artworkUrl: "https://example.com/artwork.jpg",
			};

			const parser = new FeedParser(mockFeed);
			expect(parser).toBeInstanceOf(FeedParser);
		});

		test("works without feed parameter", () => {
			const parser = new FeedParser();
			expect(parser).toBeInstanceOf(FeedParser);
		});
	});

	describe("edge cases", () => {
		test("handles empty feed with no items", async () => {
			const emptyFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Empty Podcast</title>
    <link>https://example.com</link>
  </channel>
</rss>`;

			mockRequestWithTimeout
				.mockResolvedValueOnce({
					text: emptyFeed,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				})
				.mockResolvedValueOnce({
					text: emptyFeed,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				});

			const parser = new FeedParser();
			const episodes = await parser.getEpisodes("https://example.com/feed.xml");

			expect(episodes).toHaveLength(0);
		});

		test("handles missing optional fields gracefully", async () => {
			const minimalFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Minimal Podcast</title>
    <link>https://example.com</link>
    <item>
      <title>Minimal Episode</title>
      <enclosure url="https://example.com/episode.mp3"/>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

			mockRequestWithTimeout
				.mockResolvedValueOnce({
					text: minimalFeed,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				})
				.mockResolvedValueOnce({
					text: minimalFeed,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				});

			const parser = new FeedParser();
			const episodes = await parser.getEpisodes("https://example.com/feed.xml");

			expect(episodes).toHaveLength(1);
			expect(episodes[0].description).toBe("");
			expect(episodes[0].content).toBe("");
			// url falls back to feed.url when episode link is missing
			expect(episodes[0].url).toBe("https://example.com/feed.xml");
		});

		test("handles CDATA content in description", async () => {
			const cdataFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>CDATA Podcast</title>
    <link>https://example.com</link>
    <item>
      <title>CDATA Episode</title>
      <enclosure url="https://example.com/episode.mp3"/>
      <description><![CDATA[<p>HTML description</p>]]></description>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

			mockRequestWithTimeout
				.mockResolvedValueOnce({
					text: cdataFeed,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				})
				.mockResolvedValueOnce({
					text: cdataFeed,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				});

			const parser = new FeedParser();
			const episodes = await parser.getEpisodes("https://example.com/feed.xml");

			expect(episodes[0].description).toBe("<p>HTML description</p>");
		});

		test("getFeed sets internal feed state for subsequent calls", async () => {
			mockRequestWithTimeout
				.mockResolvedValueOnce({
					text: sampleRssFeed,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				})
				.mockResolvedValueOnce({
					text: sampleRssFeed,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				});

			const parser = new FeedParser();
			await parser.getFeed("https://example.com/feed.xml");
			const episodes = await parser.getEpisodes("https://example.com/feed.xml");

			// Episodes should have feed metadata populated
			expect(episodes[0].podcastName).toBe("Test Podcast");
			expect(episodes[0].feedUrl).toBe("https://example.com/feed.xml");
		});
	});
});
