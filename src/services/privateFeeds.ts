import { Notice } from "obsidian";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import type { PodcastFeed } from "src/types/PodcastFeed";
import checkStringIsUrl from "src/utility/checkStringIsUrl";
import { ownRecord } from "src/utility/ownRecord";
import {
	isCredentialBearingUrl,
	isPrivateFeedPlaceholder,
	privateFeedPlaceholder,
} from "src/utility/privateFeedUrl";
import type { FeedAddress } from "./FeedRepository";
import type { FeedUrlRepository } from "./FeedUrlRepository";

/**
 * The single ingress/egress layer for private feed URLs.
 *
 * Ingress (subscribe, OPML import, settings import, load-time migration)
 * interns a credential-bearing URL into SecretStorage and persists only a
 * placeholder. Egress (`resolveFeedUrl`) turns a saved feed back into a
 * fetchable URL immediately before retrieval - callers keep the resolved
 * value confined to the fetch call and never persist or log it. Outside a
 * fetch, a secret is resolved only to compare it with a URL already in hand
 * (`isSavedFeed`, which returns just the answer) or to check that it exists
 * on this device. OPML export is the one deliberate exception: the user asks
 * for a file that carries the real feed URLs.
 */

/**
 * Return the feed as it may be persisted: a credential-bearing URL moves into
 * SecretStorage and is replaced by a placeholder + reference. Applies even
 * when a reference already exists (an imported or hand-edited record can
 * carry BOTH a reference and a raw URL - the raw URL is the visible ground
 * truth, so it is re-interned and the placeholder restored). Non-credentialed
 * feeds pass through untouched. On a SecretStorage failure the feed is
 * returned unchanged - keeping the URL in data.json (the status quo) rather
 * than breaking the subscription; migration surfaces that failure to the user.
 *
 * `savedKey` is the feed's savedFeeds key, which links and the URI handler
 * use to find the feed again; it defaults to the title (they match everywhere
 * feeds are created, but persisted data may disagree).
 */
export function internPrivateFeed(
	feed: PodcastFeed,
	feedUrls: FeedUrlRepository,
	savedKey: string = feed.title,
): PodcastFeed {
	if (!isCredentialBearingUrl(feed.url)) return feed;
	try {
		const urlSecretId = feedUrls.store(feed.url);
		return { ...feed, url: privateFeedPlaceholder(savedKey), urlSecretId };
	} catch (error) {
		console.error(`PodNotes: could not protect the private feed "${feed.title}"`, error);
		return feed;
	}
}

/**
 * The URL to fetch this feed from. For private feeds this resolves the secret
 * from SecretStorage; null means the secret is not available on this device
 * (SecretStorage is device-local) and the caller must not fetch.
 */
export function resolveFeedUrl(feed: FeedAddress, feedUrls: FeedUrlRepository): string | null {
	if (feed.urlSecretId) {
		return feedUrls.resolve(feed.urlSecretId);
	}
	return isPrivateFeedPlaceholder(feed.url) ? null : feed.url;
}

/**
 * Whether `url` is the saved feed's URL. A private feed matches both its
 * placeholder and the URL the placeholder stands for, so the same feed reads
 * as saved whether it is listed from settings or pasted again. URLs compare as
 * a request sends them: the scheme and host in any case, and with or without a
 * default port, name the same feed; the path, query and trailing slash must match.
 */
export function isSavedFeed(saved: PodcastFeed, url: string, feedUrls: FeedUrlRepository): boolean {
	const wanted = canonicalUrl(url);
	if (canonicalUrl(saved.url) === wanted) return true;
	const resolved = resolveFeedUrl(saved, feedUrls);
	return resolved !== null && canonicalUrl(resolved) === wanted;
}

/** `url` as the URL parser serializes it, or as given when it is not a URL. */
function canonicalUrl(url: string): string {
	return checkStringIsUrl(url)?.href ?? url;
}

/** Tells the user that a saved private feed's URL is not on this device. */
export function notifyPrivateFeedUnavailable(title: string): void {
	new Notice(
		`The private feed URL for "${title}" is not available on this device. ` +
			"Remove the feed and add it again with its private URL.",
	);
}

export interface PrivateFeedProtection {
	settings: IPodNotesSettings;
	/** Feeds whose URL could NOT be protected (SecretStorage failure). */
	failed: string[];
}

export function protectPrivateFeeds(
	settings: IPodNotesSettings,
	feedUrls: FeedUrlRepository,
): PrivateFeedProtection {
	const failed: string[] = [];
	const savedFeeds = ownRecord<PodcastFeed>();
	// A private feed's real URL maps to the placeholder naming its saved key,
	// which links resolve by.
	const byUrl = new Map<string, string>();
	let moved = false;
	for (const [key, feed] of Object.entries(settings.savedFeeds)) {
		const interned = internPrivateFeed(feed, feedUrls, key);
		if (interned !== feed) moved = true;
		else if (isCredentialBearingUrl(feed.url)) failed.push(key);
		if (isPrivateFeedPlaceholder(interned.url)) {
			byUrl.set(feed.url, interned.url);
			const url = interned.urlSecretId && feedUrls.resolve(interned.urlSecretId);
			if (url) byUrl.set(url, interned.url);
		}
		savedFeeds[key] = interned;
	}
	// Snapshots stamp `feedUrl`, and an episode without a link of its own takes
	// the feed URL as `url`. A private URL no saved feed matches still goes: its
	// podcast's placeholder stands for it.
	const placeholderFor = (url: string, episode: Record<string, unknown>) =>
		byUrl.get(url) ??
		(url === episode.feedUrl &&
		typeof episode.podcastName === "string" &&
		isCredentialBearingUrl(url)
			? privateFeedPlaceholder(episode.podcastName)
			: url);
	return {
		settings: scrubEpisodeUrls(moved ? { ...settings, savedFeeds } : settings, placeholderFor),
		failed,
	};
}

/** Returns `value` itself when no URL changed, so callers can tell whether to save. */
function scrubEpisodeUrls<T>(
	value: T,
	placeholderFor: (url: string, episode: Record<string, unknown>) => string,
): T {
	if (typeof value !== "object" || value === null) return value;
	const isArray = Array.isArray(value);
	const prototype = Object.getPrototypeOf(value) as object | null;
	if (!isArray && prototype !== Object.prototype && prototype !== null) return value;

	const record = value as Record<string, unknown>;
	let changed = false;
	const next = (isArray ? [] : Object.create(prototype)) as Record<string, unknown>;
	for (const [key, entry] of Object.entries(record)) {
		const scrubbed =
			(key === "url" || key === "feedUrl") && typeof entry === "string"
				? placeholderFor(entry, record)
				: scrubEpisodeUrls(entry, placeholderFor);
		if (scrubbed !== entry) changed = true;
		next[key] = scrubbed;
	}
	return (changed ? next : value) as T;
}
