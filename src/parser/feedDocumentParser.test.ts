// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import FeedDocumentParser from "./feedDocumentParser";

const parse = (xml: string) => new FeedDocumentParser().parseEpisodes(xml);

function rss(channel: string): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>${channel}</channel>
</rss>`;
}

function item(fields: string): string {
	return `<item><title>Episode</title><enclosure url="https://example.com/episode.mp3"/>${fields}</item>`;
}

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
		const parsed = new FeedDocumentParser().parseEpisodes(xml);

		expect(parsed.feed).toEqual({
			title: "Pure Parser Podcast",
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

		const parsed = new FeedDocumentParser().parseEpisodes(noEpisodeTargets);

		expect(parsed.feed.artworkUrl).toBe("https://cdn.example.com/feed.jpg");
		expect(parsed.episodes[0]).not.toHaveProperty("artworkUrl");
		expect(parsed.episodes[0]).not.toHaveProperty("itemLink");
	});

	it("keeps an episode without a publication date", () => {
		const undated = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Undated Podcast</title>
    <item>
      <title>Dated</title>
      <enclosure url="https://media.example.com/dated.mp3"/>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Undated</title>
      <enclosure url="https://media.example.com/undated.mp3"/>
    </item>
    <item>
      <title>No audio</title>
    </item>
  </channel>
</rss>`;

		const { episodes } = new FeedDocumentParser().parseEpisodes(undated);

		expect(episodes.map((episode) => episode.title)).toEqual(["Dated", "Undated"]);
		expect(episodes[1]).not.toHaveProperty("episodeDate");
	});

	it("reads each episode's guid, chapters and transcripts", () => {
		const podcasting20 = `<?xml version="1.0"?>
<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>Podcasting 2.0</title>
    <item>
      <title>With transcripts</title>
      <enclosure url="https://media.example.com/one.mp3"/>
      <guid isPermaLink="false">episode-one</guid>
      <podcast:chapters url="https://media.example.com/one.json" type="application/json+chapters"/>
      <podcast:transcript url="https://media.example.com/one.vtt" type="text/vtt" language="en" rel="captions"/>
      <podcast:transcript url="https://media.example.com/one.srt" type="application/x-subrip"/>
      <podcast:transcript type="text/html"/>
    </item>
    <item>
      <title>Without</title>
      <enclosure url="https://media.example.com/two.mp3"/>
    </item>
  </channel>
</rss>`;

		const [withTranscripts, without] = new FeedDocumentParser().parseEpisodes(
			podcasting20,
		).episodes;

		expect(withTranscripts).toMatchObject({
			guid: "episode-one",
			chaptersUrl: "https://media.example.com/one.json",
		});
		expect(withTranscripts.transcripts).toEqual([
			{
				url: "https://media.example.com/one.vtt",
				type: "text/vtt",
				language: "en",
				rel: "captions",
			},
			{ url: "https://media.example.com/one.srt", type: "application/x-subrip" },
		]);
		expect(without).not.toHaveProperty("transcripts");
		expect(without).not.toHaveProperty("guid");
	});

	describe("channel", () => {
		it("takes artwork from <image> or itunes:image, never from an item", () => {
			expect(
				parse(rss("<title>A</title><image><url>https://example.com/a.jpg</url></image>"))
					.feed.artworkUrl,
			).toBe("https://example.com/a.jpg");
			expect(
				parse(rss('<title>B</title><itunes:image href="https://example.com/b.jpg"/>')).feed
					.artworkUrl,
			).toBe("https://example.com/b.jpg");
			expect(
				parse(
					rss(
						`<title>C</title>${item('<itunes:image href="https://example.com/c.jpg"/>')}`,
					),
				).feed,
			).not.toHaveProperty("artworkUrl");
		});

		it("rejects a feed without a title", () => {
			expect(() => parse(rss("<description>Missing title</description>"))).toThrow(
				"Invalid RSS feed",
			);
		});

		it("reads the website, description and author, skipping Atom self and hub links", () => {
			const { feed } = parse(
				rss(`
    <atom:link href="https://example.com/feed.xml" rel="self"/>
    <atom:link href="https://pubsubhubbub.appspot.com/" rel="hub"/>
    <atom:link href="https://example.com/site" rel="alternate"/>
    <title>Meta Podcast</title>
    <description>Channel description</description>
    <itunes:author>Jane Author</itunes:author>
    ${item("<description>Episode description</description>")}`),
			);

			expect(feed).toEqual({
				title: "Meta Podcast",
				siteUrl: "https://example.com/site",
				description: "Channel description",
				author: "Jane Author",
			});
			expect(parse(rss("<title>No Link</title>")).feed).not.toHaveProperty("siteUrl");
		});

		it("prefers itunes:author over managingEditor, and itunes:summary over an empty description", () => {
			const { feed } = parse(
				rss(`
    <title>Priority Podcast</title>
    <managingEditor>editor@example.com (The Editor)</managingEditor>
    <itunes:author>The Real Author</itunes:author>
    <description></description>
    <itunes:summary>Summary used because description is empty</itunes:summary>`),
			);

			expect(feed.author).toBe("The Real Author");
			expect(feed.description).toBe("Summary used because description is empty");
		});
	});

	describe("episodes", () => {
		it("reads each episode's fields", () => {
			const [episode, minimal] = parse(
				rss(`<title>Show</title>
    <item>
      <title>Episode 1</title>
      <enclosure url="https://example.com/episode1.mp3" type="audio/mpeg"/>
      <link>https://example.com/episode1</link>
      <description><![CDATA[<p>HTML description</p>]]></description>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
      <itunes:title>Episode 1 iTunes Title</itunes:title>
      <itunes:image href="https://example.com/episode1.jpg"/>
    </item>
    <item><title>Minimal</title><enclosure url="https://example.com/minimal.mp3"/></item>`),
			).episodes;

			expect(episode).toEqual({
				title: "Episode 1",
				streamUrl: "https://example.com/episode1.mp3",
				itemLink: "https://example.com/episode1",
				description: "<p>HTML description</p>",
				content: "",
				artworkUrl: "https://example.com/episode1.jpg",
				episodeDate: new Date("Mon, 01 Jan 2024 00:00:00 GMT"),
				itunesTitle: "Episode 1 iTunes Title",
				episodeNumber: 1,
				mediaType: "audio",
			});
			expect(minimal).toEqual({
				title: "Minimal",
				streamUrl: "https://example.com/minimal.mp3",
				description: "",
				content: "",
				mediaType: "audio",
			});
		});

		it("keeps an episode with a malformed publication date but omits the date", () => {
			const [episode] = parse(
				rss(`<title>Show</title>${item("<pubDate>not a date</pubDate>")}`),
			).episodes;

			expect(episode).not.toHaveProperty("episodeDate");
		});

		it("reads the episode number and duration, with a title fallback (#34, #88)", () => {
			const episodes = parse(
				rss(`<title>Numbered</title>
    <item><title>Episode 1</title><enclosure url="https://example.com/1.mp3"/>
      <itunes:episode>42</itunes:episode><itunes:duration>1:02:03</itunes:duration></item>
    <item><title>#7 Lucky Seven</title><enclosure url="https://example.com/7.mp3"/>
      <itunes:duration>3600</itunes:duration></item>
    <item><title>No Number Here</title><enclosure url="https://example.com/x.mp3"/></item>`),
			).episodes;

			expect(
				episodes.map(({ episodeNumber, duration }) => [episodeNumber, duration]),
			).toEqual([
				[42, 3723],
				[7, 3600],
				[undefined, undefined],
			]);
		});

		it("plays video enclosures as video and trusts an audio type over an mp4 extension", () => {
			const enclosures = [
				'url="https://example.com/lecture.mp4" type="video/mp4"',
				'url="https://example.com/episode.mp4" type="audio/mp4"',
				'url="https://example.com/episode.mp4"',
				'url="https://example.com/episode.webm" type="application/octet-stream"',
				'url="https://example.com/lecture.mov"',
			];
			const episodes = parse(
				rss(
					`<title>Media</title>${enclosures
						.map(
							(enclosure) => `<item><title>E</title><enclosure ${enclosure}/></item>`,
						)
						.join("")}`,
				),
			).episodes;

			expect(episodes.map((episode) => episode.mediaType)).toEqual([
				"video",
				"audio",
				"audio",
				"audio",
				"video",
			]);
		});

		it("lists no episodes for a feed without items", () => {
			expect(parse(rss("<title>Empty</title>")).episodes).toEqual([]);
		});
	});

	it("rejects a parser-generated malformed XML document", () => {
		expect(() => parse("<rss><channel><title>broken")).toThrow("Invalid RSS feed");
	});

	it("accepts a valid feed containing an extension named parsererror", () => {
		const validExtension = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Valid Extension Podcast</title>
    <parsererror>extension payload</parsererror>
  </channel>
</rss>`;

		expect(parse(validExtension).feed).toEqual({
			title: "Valid Extension Podcast",
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

		expect(() => parse(chromiumErrorShape)).toThrow("Invalid RSS feed");
	});

	it("accepts a nested XHTML extension with the same local name", () => {
		const nestedXhtmlExtension = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Nested Extension Podcast</title>
    <parsererror xmlns="http://www.w3.org/1999/xhtml">extension payload</parsererror>
  </channel>
</rss>`;

		expect(parse(nestedXhtmlExtension).feed).toEqual({
			title: "Nested Extension Podcast",
		});
	});
});
