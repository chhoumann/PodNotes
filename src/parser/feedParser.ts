import type { PodcastFeed } from "src/types/PodcastFeed";
import type { Episode } from "src/types/Episode";
import { requestWithTimeout } from "src/utility/networkRequest";

export default class FeedParser {
	private feed: PodcastFeed | undefined;

	constructor(feed?: PodcastFeed) {
		this.feed = feed;
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
		const itunesImageEl = this.findImageElement(body);

		// A feed must have a title. <link> is intentionally NOT required: it is the
		// human website (now surfaced as {{url}} in feed notes), but many valid
		// feeds omit a channel <link> or only carry an <atom:link rel="self">.
		if (!titleEl) {
			throw new Error("Invalid RSS feed");
		}

		const channel = body.querySelector("channel") ?? body;

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

		const link = this.findFeedLink(channel);
		if (link) feed.link = link;

		const description = this.findDirectChildText(channel, [
			"description",
			"itunes:summary",
		]);
		if (description) feed.description = description;

		const author = this.findDirectChildText(channel, [
			"itunes:author",
			"author",
			"managingEditor",
		]);
		if (author) feed.author = author;

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

	/**
	 * Resolve the feed's website URL from the channel's direct <link> children.
	 * Prefers a <link> whose text content is an http(s) URL; RSS feeds commonly
	 * place an <atom:link rel="self" href="..."/> (URL in the attribute, empty
	 * text) before the website <link>, so those are skipped, with an atom
	 * alternate href used only as a last resort. Returns "" when none is present.
	 */
	private findFeedLink(scope: Document | Element): string {
		const directLinks = Array.from(scope.children).filter((el) => {
			const tag = el.tagName.toLowerCase();
			return tag === "link" || tag === "atom:link";
		});

		for (const link of directLinks) {
			const text = link.textContent?.trim();
			if (text && /^https?:\/\//i.test(text)) return text;
		}

		for (const link of directLinks) {
			// Only an "alternate" (or rel-less) atom link is the human website.
			// Skip self/hub/next/prev/first/last/payment/edit and similar relations
			// so a PubSubHubbub hub or pagination URL never becomes the feed link.
			const rel = link.getAttribute("rel");
			if (rel && rel !== "alternate") continue;
			const href = link.getAttribute("href")?.trim();
			if (href && /^https?:\/\//i.test(href)) return href;
		}

		return "";
	}

	/**
	 * Read a feed-level value from the first DIRECT child of `scope` matching
	 * `tagNames`, honouring the PRIORITY of `tagNames` (not document order): the
	 * first tag name with a non-empty value wins. This keeps a preferred tag
	 * (e.g. <itunes:author>) ahead of a fallback (<managingEditor>) regardless of
	 * their order in the XML, and lets an empty <description> fall through to
	 * <itunes:summary>. Direct-child scoping keeps it from matching the same tags
	 * nested inside an <item>.
	 */
	private findDirectChildText(
		scope: Document | Element,
		tagNames: string[],
	): string {
		const children = Array.from(scope.children);
		for (const tag of tagNames) {
			const wanted = tag.toLowerCase();
			for (const child of children) {
				if (child.tagName.toLowerCase() !== wanted) continue;
				const text = child.textContent?.trim() ?? "";
				if (text) return text;
			}
		}
		return "";
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
