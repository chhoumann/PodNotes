import { describe, expect, it } from "vitest";

import FeedDocumentParser from "./feedDocumentParser";

const subscriptionUrl = "https://feeds.example.com/podcast.xml";
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>Pure Parser Podcast</title>
    <link>https://example.com/show</link>
    <itunes:image href="https://cdn.example.com/feed.jpg"/>
    <podcast:guid>feed-guid</podcast:guid>
    <item>
      <title>Episode One</title>
      <enclosure url="https://media.example.com/one.mp3" type="audio/mpeg"/>
      <link>https://example.com/episodes/one</link>
      <guid>episode-guid</guid>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
      <itunes:duration>90</itunes:duration>
    </item>
  </channel>
</rss>`;

describe("FeedDocumentParser", () => {
	it("keeps feed and episode targets purpose-explicit without performing retrieval", () => {
		const parsed = new FeedDocumentParser().parseEpisodes(xml, subscriptionUrl);

		expect(parsed.feed).toEqual({
			title: "Pure Parser Podcast",
			subscriptionUrl,
			artworkUrl: "https://cdn.example.com/feed.jpg",
			siteUrl: "https://example.com/show",
			guid: "feed-guid",
		});
		expect(parsed.episodes).toEqual([
			expect.objectContaining({
				title: "Episode One",
				streamUrl: "https://media.example.com/one.mp3",
				itemLink: "https://example.com/episodes/one",
				guid: "episode-guid",
				duration: 90,
			}),
		]);
		expect(parsed.episodes[0]).not.toHaveProperty("artworkUrl");
		expect(parsed.episodes[0]).not.toHaveProperty("feedUrl");
		expect(parsed.episodes[0]).not.toHaveProperty("podcastName");
	});

	it("does not turn feed fallbacks into episode-scoped targets", () => {
		const noEpisodeTargets = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Fallback Podcast</title>
    <image><url>https://cdn.example.com/feed.jpg</url></image>
    <item>
      <title>No Link or Artwork</title>
      <enclosure url="https://media.example.com/episode.mp3"/>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

		const parsed = new FeedDocumentParser().parseEpisodes(noEpisodeTargets, subscriptionUrl);

		expect(parsed.feed.artworkUrl).toBe("https://cdn.example.com/feed.jpg");
		expect(parsed.episodes[0]).not.toHaveProperty("artworkUrl");
		expect(parsed.episodes[0]).not.toHaveProperty("itemLink");
	});

	it("rejects a parser-generated malformed XML document", () => {
		expect(() =>
			new FeedDocumentParser().parseFeed("<rss><channel><title>broken", subscriptionUrl),
		).toThrow("Invalid RSS feed");
	});

	it("accepts a valid feed containing an extension named parsererror", () => {
		const validExtension = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Valid Extension Podcast</title>
    <parsererror>extension payload</parsererror>
  </channel>
</rss>`;

		expect(new FeedDocumentParser().parseFeed(validExtension, subscriptionUrl)).toEqual({
			title: "Valid Extension Podcast",
			subscriptionUrl,
		});
	});

	it("rejects Chromium's partial-root XHTML parser error document", () => {
		const chromiumErrorShape = `<?xml version="1.0"?>
<rss version="2.0">
  <parsererror xmlns="http://www.w3.org/1999/xhtml">
    <h3>This page contains the following errors:</h3>
    <div>Premature end of data</div>
    <h3>Below is a rendering of the page up to the first error.</h3>
  </parsererror>
  <channel><title>Partial Recovery</title></channel>
</rss>`;

		expect(() =>
			new FeedDocumentParser().parseFeed(chromiumErrorShape, subscriptionUrl),
		).toThrow("Invalid RSS feed");
	});

	it("accepts a nested XHTML extension with the same local name", () => {
		const nestedXhtmlExtension = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Nested Extension Podcast</title>
    <parsererror xmlns="http://www.w3.org/1999/xhtml">extension payload</parsererror>
  </channel>
</rss>`;

		expect(new FeedDocumentParser().parseFeed(nestedXhtmlExtension, subscriptionUrl)).toEqual({
			title: "Nested Extension Podcast",
			subscriptionUrl,
		});
	});
});
