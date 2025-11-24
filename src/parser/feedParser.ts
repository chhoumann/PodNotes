import type { PodcastFeed } from "src/types/PodcastFeed";
import type { Episode } from "src/types/Episode";
import { requestWithTimeout } from "src/utility/networkRequest";

export default class FeedParser {
	private feed: PodcastFeed | undefined;

	constructor(feed?: PodcastFeed) {
		this.feed = feed;
	}

	public async findItemByTitle(title: string, url: string): Promise<Episode> {
		// Ensure feed metadata is loaded first
		if (!this.feed || this.feed.url !== url) {
			await this.getFeed(url);
		}

		const body = await this.parseFeed(url);
		const items = body.querySelectorAll("item");
		const target = title.trim().toLowerCase();

		// Parse all items once and find by case-insensitive match
		const episodes = Array.from(items)
			.map((item) => this.parseItem(item))
			.filter((ep): ep is Episode => !!ep);

		const episode = episodes.find(
			(ep) => ep.title.trim().toLowerCase() === target,
		);

		if (!episode) {
			throw new Error("Could not find episode");
		}

		// Fill in any missing fields from feed metadata
		if (!episode.artworkUrl && this.feed) {
			episode.artworkUrl = this.feed.artworkUrl;
		}

		if (!episode.podcastName && this.feed) {
			episode.podcastName = this.feed.title;
		}

		if (!episode.feedUrl && this.feed) {
			episode.feedUrl = this.feed.url;
		}

		return episode;
	}

	public async getEpisodes(url: string): Promise<Episode[]> {
		// Ensure feed metadata is loaded and cached
		if (!this.feed || this.feed.url !== url) {
			await this.getFeed(url);
		}

		const body = await this.parseFeed(url);

		return this.parsePage(body);
	}

	public async getFeed(url: string): Promise<PodcastFeed> {
		const body = await this.parseFeed(url);

		const titleEl = body.querySelector("title");
		const linkEl = body.querySelector("link");
		const itunesImageEl = this.findImageElement(body);

		if (!titleEl || !linkEl) {
			throw new Error("Invalid RSS feed");
		}

		const title = titleEl.textContent || "";
		const artworkUrl =
			itunesImageEl?.getAttribute("href") ||
			itunesImageEl?.querySelector("url")?.textContent ||
			"";

		const feed: PodcastFeed = {
			title,
			url,
			artworkUrl,
		};

		this.feed = feed;
		return feed;
	}

	private findImageElement(doc: Document | Element): Element | null {
		// Try iTunes-specific first (handles <itunes:image href="..."/>)
		const itunesImage = doc.getElementsByTagName("itunes:image")[0];
		if (itunesImage) return itunesImage;

		// Fallback to generic <image> element
		return doc.querySelector("image");
	}

	protected parsePage(page: Document): Episode[] {
		const items = page.querySelectorAll("item");

		function isEpisode(ep: Episode | null): ep is Episode {
			return !!ep;
		}

		return Array.from(items).map(this.parseItem.bind(this)).filter(isEpisode);
	}

	protected parseItem(item: Element): Episode | null {
		const titleEl = item.querySelector("title");
		const streamUrlEl = item.querySelector("enclosure");
		const linkEl = item.querySelector("link");
		const descriptionEl = item.querySelector("description");
		const contentEl = item.querySelector("*|encoded");
		const pubDateEl = item.querySelector("pubDate");
		const itunesImageEl = this.findImageElement(item);
		const itunesTitleEl = item.getElementsByTagName("itunes:title")[0];
		const chaptersEl = item.getElementsByTagName("podcast:chapters")[0];

		if (!titleEl || !streamUrlEl || !pubDateEl) {
			return null;
		}

		const title = titleEl.textContent || "";
		const streamUrl = streamUrlEl.getAttribute("url") || "";
		const url = linkEl?.textContent || "";
		const description = descriptionEl?.textContent || "";
		const content = contentEl?.textContent || "";
		const pubDate = new Date(pubDateEl.textContent as string);
		const artworkUrl =
			itunesImageEl?.getAttribute("href") || this.feed?.artworkUrl;
		const itunesTitle = itunesTitleEl?.textContent;
		const chaptersUrl = chaptersEl?.getAttribute("url") || undefined;

		return {
			title,
			streamUrl,
			url: url || this.feed?.url || "",
			description,
			content,
			podcastName: this.feed?.title || "",
			artworkUrl,
			episodeDate: pubDate,
			feedUrl: this.feed?.url || "",
			itunesTitle: itunesTitle || "",
			chaptersUrl,
		};
	}

	private async parseFeed(feedUrl: string): Promise<Document> {
		const req = await requestWithTimeout(feedUrl, { timeoutMs: 30000 });
		const dp = new DOMParser();

		const body = dp.parseFromString(req.text, "text/xml");

		return body;
	}
}
