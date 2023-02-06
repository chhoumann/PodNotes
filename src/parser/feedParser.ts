import { PodcastFeed } from "src/types/PodcastFeed";
import { requestUrl } from "obsidian";
import { Episode } from "src/types/Episode";

export default class FeedParser {
	private feed: PodcastFeed | undefined;

	constructor(feed?: PodcastFeed) {
		this.feed = feed;
	}

	public async findItemByTitle(title: string, url: string): Promise<Episode> {
		const body = await this.parseFeed(url);

		const items = body.querySelectorAll("item");

		const item = Array.from(items).find((item) => {
			const parsed = this.parseItem(item);
			return parsed.title === title;
		});

		if (!item) {
			throw new Error("Could not find episode");
		}

		const episode = this.parseItem(item);

		const feed = await this.getFeed(url);

		if (!episode.artworkUrl) {
			episode.artworkUrl = feed.artworkUrl;
		}

		if (!episode.podcastName) {
			episode.podcastName = feed.title;
		}

		if (!episode.feedUrl) {
			episode.feedUrl = feed.url;
		}

		return episode;
	}

	public async getEpisodes(url: string): Promise<Episode[]> {
		const body = await this.parseFeed(url);

		return this.parsePage(body);
	}

	public async getFeed(url: string): Promise<PodcastFeed> {
		const body = await this.parseFeed(url);

		const titleEl = body.querySelector("title");
		const linkEl = body.querySelector("link");
		const itunesImageEl = body.querySelector("image");

		if (!titleEl || !linkEl) {
			throw new Error("Invalid RSS feed");
		}

		const title = titleEl.textContent || "";
		const artworkUrl =
			itunesImageEl?.getAttribute("href") ||
			itunesImageEl?.querySelector("url")?.textContent ||
			"";

		return {
			title,
			url,
			artworkUrl,
		};
	}

	protected parsePage(page: Document): Episode[] {
		const items = page.querySelectorAll("item");

		function isEpisode(ep: Episode | null): ep is Episode {
			return !!ep;
		}

		return Array.from(items)
			.map(this.parseItem.bind(this))
			.filter(isEpisode);
	}

	protected parseItem(item: Element): Episode | null {
		const titleEl = item.querySelector("title");
		const streamUrlEl = item.querySelector("enclosure");
		const linkEl = item.querySelector("link");
		const descriptionEl = item.querySelector("description");
		const contentEl = item.querySelector("*|encoded");
		const pubDateEl = item.querySelector("pubDate");
		const itunesImageEl = item.querySelector("image");

		if (!titleEl || !streamUrlEl || !pubDateEl) {
			console.log(titleEl, streamUrlEl, linkEl, descriptionEl, pubDateEl);
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

		console.log(`Got this far`, title);

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
		};
	}

	private async parseFeed(feedUrl: string): Promise<Document> {
		const req = await requestUrl({ url: feedUrl });
		const dp = new DOMParser();

		const body = dp.parseFromString(req.text, "text/xml");

		return body;
	}
}
