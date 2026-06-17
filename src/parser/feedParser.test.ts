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

const sampleRssFeedWithAtomAndMetadata = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <atom:link href="https://example.com/feed.xml" rel="self" type="application/rss+xml"/>
    <title>Meta Podcast</title>
    <link>https://example.com/show</link>
    <description>Channel description here</description>
    <itunes:author>Jane Author</itunes:author>
    <image>
      <url>https://example.com/artwork.jpg</url>
    </image>
    <item>
      <title>Episode 1</title>
      <enclosure url="https://example.com/episode1.mp3" type="audio/mpeg"/>
      <description>Episode-level description (must not become the feed description)</description>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const rssFeedWithoutChannelLink = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <atom:link href="https://example.com/feed.xml" rel="self"/>
    <title>No Link Podcast</title>
    <image>
      <url>https://example.com/artwork.jpg</url>
    </image>
    <item>
      <title>Episode 1</title>
      <enclosure url="https://example.com/episode1.mp3" type="audio/mpeg"/>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const rssFeedWithMetadataPriority = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Priority Podcast</title>
    <link>https://example.com</link>
    <managingEditor>editor@example.com (The Editor)</managingEditor>
    <itunes:author>The Real Author</itunes:author>
    <description></description>
    <itunes:summary>Summary used because description is empty</itunes:summary>
    <item>
      <title>Episode 1</title>
      <enclosure url="https://example.com/episode1.mp3" type="audio/mpeg"/>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const rssFeedWithAtomHubAndAlternate = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <atom:link href="https://example.com/feed.xml" rel="self"/>
    <atom:link href="https://pubsubhubbub.appspot.com/" rel="hub"/>
    <atom:link href="https://example.com/site" rel="alternate"/>
    <title>Hub Podcast</title>
    <image>
      <url>https://example.com/artwork.jpg</url>
    </image>
    <item>
      <title>Episode 1</title>
      <enclosure url="https://example.com/episode1.mp3" type="audio/mpeg"/>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    </item>
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

const rssFeedWithEpisodeNumberAndDuration = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Numbered Podcast</title>
    <link>https://example.com</link>
    <item>
      <title>Episode 1</title>
      <enclosure url="https://example.com/episode1.mp3" type="audio/mpeg"/>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
      <itunes:episode>42</itunes:episode>
      <itunes:duration>1:02:03</itunes:duration>
    </item>
    <item>
      <title>#7 Lucky Seven</title>
      <enclosure url="https://example.com/episode2.mp3" type="audio/mpeg"/>
      <pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate>
      <itunes:duration>3600</itunes:duration>
    </item>
    <item>
      <title>No Number Here</title>
      <enclosure url="https://example.com/episode3.mp3" type="audio/mpeg"/>
      <pubDate>Wed, 03 Jan 2024 00:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const rssFeedWithPodcastChapters = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>Chaptered Podcast</title>
    <link>https://example.com</link>
    <item>
      <title>Chaptered Episode</title>
      <enclosure url="https://example.com/chaptered.mp3" type="audio/mpeg"/>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
      <podcast:chapters url="https://example.com/chapters.json" type="application/json"/>
    </item>
    <item>
      <title>Episode Without Chapters</title>
      <enclosure url="https://example.com/no-chapters.mp3" type="audio/mpeg"/>
      <pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate>
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

		test("captures channel link, description and author, skipping atom:link self-refs", async () => {
			mockRequestWithTimeout.mockResolvedValueOnce({
				text: sampleRssFeedWithAtomAndMetadata,
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
				json: {},
			});

			const parser = new FeedParser();
			const feed = await parser.getFeed("https://example.com/feed.xml");

			expect(feed.title).toBe("Meta Podcast");
			expect(feed.link).toBe("https://example.com/show");
			expect(feed.description).toBe("Channel description here");
			expect(feed.author).toBe("Jane Author");
		});

		test("does not throw when the channel has no website link", async () => {
			mockRequestWithTimeout.mockResolvedValueOnce({
				text: rssFeedWithoutChannelLink,
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
				json: {},
			});

			const parser = new FeedParser();
			const feed = await parser.getFeed("https://example.com/feed.xml");

			expect(feed.title).toBe("No Link Podcast");
			expect(feed.link).toBeUndefined();
		});

		test("uses the atom alternate link, never a hub/self link, for the website", async () => {
			mockRequestWithTimeout.mockResolvedValueOnce({
				text: rssFeedWithAtomHubAndAlternate,
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
				json: {},
			});

			const parser = new FeedParser();
			const feed = await parser.getFeed("https://example.com/feed.xml");

			expect(feed.link).toBe("https://example.com/site");
		});

		test("honours tag priority: itunes:author over managingEditor, itunes:summary when description is empty", async () => {
			mockRequestWithTimeout.mockResolvedValueOnce({
				text: rssFeedWithMetadataPriority,
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
				json: {},
			});

			const parser = new FeedParser();
			const feed = await parser.getFeed("https://example.com/feed.xml");

			expect(feed.author).toBe("The Real Author");
			expect(feed.description).toBe("Summary used because description is empty");
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

		test("parses Podcasting 2.0 chapter URLs from episodes (#47)", async () => {
			mockRequestWithTimeout
				.mockResolvedValueOnce({
					text: rssFeedWithPodcastChapters,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				})
				.mockResolvedValueOnce({
					text: rssFeedWithPodcastChapters,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				});

			const parser = new FeedParser();
			const episodes = await parser.getEpisodes("https://example.com/feed.xml");

			expect(episodes[0].chaptersUrl).toBe(
				"https://example.com/chapters.json",
			);
			expect(episodes[1].chaptersUrl).toBeUndefined();
		});

		test("marks video enclosures so the player can render video", async () => {
			const videoFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Video Podcast</title>
    <link>https://example.com</link>
    <item>
      <title>Lecture Video</title>
      <enclosure url="https://example.com/lecture.mp4" type="video/mp4"/>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;
			mockRequestWithTimeout
				.mockResolvedValueOnce({
					text: videoFeed,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				})
				.mockResolvedValueOnce({
					text: videoFeed,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				});

			const parser = new FeedParser();
			const episodes = await parser.getEpisodes("https://example.com/feed.xml");

			expect(episodes[0]).toMatchObject({
				title: "Lecture Video",
				streamUrl: "https://example.com/lecture.mp4",
				mediaType: "video",
			});
		});

		test("trusts audio enclosure type when URL uses an mp4 extension", async () => {
			const audioMp4Feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Audio Podcast</title>
    <link>https://example.com</link>
    <item>
      <title>Audio MP4 Episode</title>
      <enclosure url="https://example.com/episode.mp4" type="audio/mp4"/>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;
			mockRequestWithTimeout
				.mockResolvedValueOnce({
					text: audioMp4Feed,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				})
				.mockResolvedValueOnce({
					text: audioMp4Feed,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				});

			const parser = new FeedParser();
			const episodes = await parser.getEpisodes("https://example.com/feed.xml");

			expect(episodes[0]).toMatchObject({
				title: "Audio MP4 Episode",
				streamUrl: "https://example.com/episode.mp4",
				mediaType: "audio",
			});
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

	describe("episode number and duration (#34, #88)", () => {
		test("parses <itunes:episode>/<itunes:duration> with a title fallback", async () => {
			mockRequestWithTimeout
				.mockResolvedValueOnce({
					text: rssFeedWithEpisodeNumberAndDuration,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				})
				.mockResolvedValueOnce({
					text: rssFeedWithEpisodeNumberAndDuration,
					status: 200,
					headers: {},
					arrayBuffer: new ArrayBuffer(0),
					json: {},
				});

			const parser = new FeedParser();
			const episodes = await parser.getEpisodes("https://example.com/feed.xml");

			// Explicit <itunes:episode> and an HH:MM:SS duration.
			expect(episodes[0].episodeNumber).toBe(42);
			expect(episodes[0].duration).toBe(3723);

			// No <itunes:episode>: number recovered from the "#7" title prefix;
			// duration given as a plain seconds count.
			expect(episodes[1].episodeNumber).toBe(7);
			expect(episodes[1].duration).toBe(3600);

			// Neither tag nor a parseable title number.
			expect(episodes[2].episodeNumber).toBeUndefined();
			expect(episodes[2].duration).toBeUndefined();
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
