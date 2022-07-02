import { PodcastFeed } from 'src/types/PodcastFeed';
import { requestUrl } from "obsidian";
import { Episode } from "src/types/Episode";

export default class FeedParser {
	private feed: PodcastFeed;

	constructor(feed: PodcastFeed) {
		this.feed = feed;
	}

	public async parse(url: string) {
		const req = await requestUrl({url: url});
		const dp = new DOMParser();

		const body = dp.parseFromString(req.text, "text/xml");

		return this.parsePage(body);
	}

	protected parsePage(page: Document): Episode[] {
		const items = page.querySelectorAll("item");
		return [this.parseItem(items[0])];

		return Array.from(items).map(this.parseItem.bind(this));
	}

	protected parseItem(item: Element): Episode {
		const titleEl = item.querySelector("title");
		const streamUrlEl = item.querySelector("enclosure");
		const linkEl = item.querySelector("link");
		const descriptionEl = item.querySelector("description");
		const pubDateEl = item.querySelector("pubDate");
		const itunesImageEl = item.querySelector("image");

		if (!titleEl || !streamUrlEl || !descriptionEl || !pubDateEl) {
			console.log(titleEl, streamUrlEl, linkEl, descriptionEl, pubDateEl);
			throw new Error("Invalid RSS feed");
		}

		const title = titleEl.textContent || "";
		const streamUrl = streamUrlEl.getAttribute("url") || "";
		const url = linkEl?.textContent || "";
		const description = descriptionEl.textContent || "";
		const pubDate = new Date(pubDateEl.textContent as string);
		const artworkUrl = itunesImageEl?.getAttribute("href") || this.feed.artworkUrl;

		return {
			title,
			streamUrl,
			url: url || this.feed.url,
			description,
			podcastName: this.feed.title,
			artworkUrl,
			episodeDate: pubDate
		}
	}
}
