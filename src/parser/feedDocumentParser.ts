import { decodeDate } from "src/persistence/dateCodec";
import type { EpisodeMediaType } from "src/types/Episode";
import {
	getMediaTypeFromContentType,
	getUnambiguousMediaTypeFromPath,
} from "src/utility/mediaType";
import { parseDurationToSeconds } from "src/utility/parseDuration";
import { parseEpisodeNumber } from "src/utility/parseEpisodeNumber";

/**
 * Transient parser output. Raw targets stay purpose-explicit here so the
 * capability broker can seal each one under the correct resource kind. This
 * object must never be persisted or exposed to the UI, public API, or template
 * engine.
 */
export interface ParsedFeedDocument {
	title: string;
	subscriptionUrl: string;
	artworkUrl?: string;
	siteUrl?: string;
	description?: string;
	author?: string;
	guid?: string;
}

/** Transient episode metadata and purpose-explicit raw targets. */
export interface ParsedEpisodeDocument {
	title: string;
	streamUrl: string;
	itemLink?: string;
	description: string;
	content: string;
	artworkUrl?: string;
	episodeDate?: Date;
	itunesTitle?: string;
	episodeNumber?: number;
	duration?: number;
	chaptersUrl?: string;
	guid?: string;
	mediaType: EpisodeMediaType;
}

export interface ParsedFeedEpisodes {
	feed: ParsedFeedDocument;
	episodes: ParsedEpisodeDocument[];
}

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

function isParserErrorDocument(document: Document): boolean {
	const root = document.documentElement;
	if (!root) return true;
	if (root.localName.toLowerCase() === "parsererror") return true;

	// Chromium preserves the partial XML root and inserts its generated XHTML
	// parsererror as a direct root child. A feed-owned element with the same local
	// name remains ordinary XML unless it has that engine-owned provenance.
	return Array.from(document.getElementsByTagName("parsererror")).some(
		(element) => element.namespaceURI === XHTML_NAMESPACE && element.parentElement === root,
	);
}

/** Pure XML parsing boundary with no network or Obsidian dependency. */
export default class FeedDocumentParser {
	parseFeed(xml: string, subscriptionUrl: string): ParsedFeedDocument {
		return this.extractFeed(this.parseXml(xml), subscriptionUrl);
	}

	parseEpisodes(xml: string, subscriptionUrl: string): ParsedFeedEpisodes {
		const document = this.parseXml(xml);
		return {
			feed: this.extractFeed(document, subscriptionUrl),
			episodes: this.parsePage(document),
		};
	}

	/** Parse only item records when the legacy facade already has matching feed metadata. */
	parseEpisodeItems(xml: string): ParsedEpisodeDocument[] {
		return this.parsePage(this.parseXml(xml));
	}

	private parseXml(xml: string): Document {
		const document = new DOMParser().parseFromString(xml, "text/xml");
		if (isParserErrorDocument(document)) throw new Error("Invalid RSS feed");
		return document;
	}

	private extractFeed(body: Document, subscriptionUrl: string): ParsedFeedDocument {
		const titleEl = body.querySelector("title");

		// A feed must have a title. <link> is intentionally not required: it is the
		// human website, but many valid feeds omit it or only include an Atom self link.
		if (!titleEl) throw new Error("Invalid RSS feed");

		const channel = body.querySelector("channel") ?? body;
		const imageEl = this.findChannelImageElement(channel);
		const artworkUrl =
			imageEl?.getAttribute("href") || imageEl?.querySelector("url")?.textContent || "";
		const siteUrl = this.findFeedLink(channel);
		const description = this.findDirectChildText(channel, ["description", "itunes:summary"]);
		const author = this.findDirectChildText(channel, [
			"itunes:author",
			"author",
			"managingEditor",
		]);
		const guid = this.findDirectChildText(channel, ["podcast:guid", "id"]);

		return {
			title: titleEl.textContent || "",
			subscriptionUrl,
			...(artworkUrl ? { artworkUrl } : {}),
			...(siteUrl ? { siteUrl } : {}),
			...(description ? { description } : {}),
			...(author ? { author } : {}),
			...(guid ? { guid } : {}),
		};
	}

	private findImageElement(document: Document | Element): Element | null {
		const itunesImage = document.getElementsByTagName("itunes:image")[0];
		return itunesImage ?? document.querySelector("image");
	}

	/** A nested item image must never become channel artwork. */
	private findChannelImageElement(scope: Element | Document): Element | null {
		const directChildren = Array.from(scope.children);
		const itunesImage = directChildren.find(
			(element) => element.tagName.toLowerCase() === "itunes:image",
		);
		if (itunesImage) return itunesImage;
		return directChildren.find((element) => element.tagName.toLowerCase() === "image") ?? null;
	}

	/** Resolve only the human website link, never an Atom self or hub endpoint. */
	private findFeedLink(scope: Document | Element): string {
		const directLinks = Array.from(scope.children).filter((element) => {
			const tag = element.tagName.toLowerCase();
			return tag === "link" || tag === "atom:link";
		});

		for (const link of directLinks) {
			const text = link.textContent?.trim();
			if (text && /^https?:\/\//i.test(text)) return text;
		}

		for (const link of directLinks) {
			const relation = link.getAttribute("rel");
			if (relation && relation !== "alternate") continue;
			const href = link.getAttribute("href")?.trim();
			if (href && /^https?:\/\//i.test(href)) return href;
		}

		return "";
	}

	/** Read direct-child metadata in explicit tag-priority order. */
	private findDirectChildText(scope: Document | Element, tagNames: string[]): string {
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

	private parsePage(page: Document): ParsedEpisodeDocument[] {
		return Array.from(page.querySelectorAll("item"))
			.map((item) => this.parseItem(item))
			.filter((episode): episode is ParsedEpisodeDocument => episode !== null);
	}

	private parseItem(item: Element): ParsedEpisodeDocument | null {
		const titleEl = item.querySelector("title");
		const streamUrlEl = item.querySelector("enclosure");
		const pubDateEl = item.querySelector("pubDate");
		if (!titleEl || !streamUrlEl || !pubDateEl) return null;

		const title = titleEl.textContent || "";
		const streamUrl = streamUrlEl.getAttribute("url") || "";
		const itemLink = item.querySelector("link")?.textContent || "";
		const description = item.querySelector("description")?.textContent || "";
		const content = item.querySelector("*|encoded")?.textContent || "";
		const episodeDate = decodeDate(pubDateEl.textContent);
		const artworkUrl = this.findImageElement(item)?.getAttribute("href") || "";
		const itunesTitle = item.getElementsByTagName("itunes:title")[0]?.textContent || "";
		const episodeNumber = parseEpisodeNumber(
			item.getElementsByTagName("itunes:episode")[0]?.textContent,
			title,
		);
		const duration = parseDurationToSeconds(
			item.getElementsByTagName("itunes:duration")[0]?.textContent,
		);
		const chaptersUrl =
			item.getElementsByTagName("podcast:chapters")[0]?.getAttribute("url") || "";
		const guid = this.findDirectChildText(item, ["guid"]);
		const enclosureType = streamUrlEl.getAttribute("type");

		return {
			title,
			streamUrl,
			...(itemLink ? { itemLink } : {}),
			description,
			content,
			...(artworkUrl ? { artworkUrl } : {}),
			...(episodeDate ? { episodeDate } : {}),
			...(itunesTitle ? { itunesTitle } : {}),
			...(episodeNumber === undefined ? {} : { episodeNumber }),
			...(duration === undefined ? {} : { duration }),
			...(chaptersUrl ? { chaptersUrl } : {}),
			...(guid ? { guid } : {}),
			mediaType:
				getMediaTypeFromContentType(enclosureType) ??
				getUnambiguousMediaTypeFromPath(streamUrl) ??
				"audio",
		};
	}
}
