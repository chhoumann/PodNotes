import { Notice } from "obsidian";
import type { PodcastFeed } from "src/types/PodcastFeed";
import {
	isCredentialBearingUrl,
	isPrivateFeedPlaceholder,
	privateFeedPlaceholder,
} from "src/utility/privateFeedUrl";
import type { FeedUrlRepository } from "./FeedUrlRepository";

/**
 * The single ingress/egress layer for private feed URLs.
 *
 * Ingress (subscribe, OPML import, load-time migration) interns a
 * credential-bearing URL into SecretStorage and persists only a placeholder.
 * Egress (`resolveFeedUrl`) turns a saved feed back into a fetchable URL
 * immediately before retrieval and nowhere else - callers keep the resolved
 * value confined to the fetch call and never persist or log it.
 */

/**
 * Return the feed as it may be persisted: a credential-bearing URL moves into
 * SecretStorage and is replaced by a placeholder + reference. Non-credentialed
 * feeds pass through untouched. On a SecretStorage failure the feed is
 * returned unchanged - keeping the URL in data.json (the status quo) rather
 * than breaking the subscription.
 */
export function internPrivateFeed(feed: PodcastFeed, feedUrls: FeedUrlRepository): PodcastFeed {
	if (feed.urlSecretId || !isCredentialBearingUrl(feed.url)) return feed;
	try {
		const urlSecretId = feedUrls.store(feed.url);
		return { ...feed, url: privateFeedPlaceholder(feed.title), urlSecretId };
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
export function resolveFeedUrl(feed: PodcastFeed, feedUrls: FeedUrlRepository): string | null {
	if (feed.urlSecretId) {
		return feedUrls.resolve(feed.urlSecretId);
	}
	return isPrivateFeedPlaceholder(feed.url) ? null : feed.url;
}

/** resolveFeedUrl plus the standard user-facing failure Notice. */
export function resolveFeedUrlWithNotice(
	feed: PodcastFeed,
	feedUrls: FeedUrlRepository,
): string | null {
	const url = resolveFeedUrl(feed, feedUrls);
	if (url === null) {
		new Notice(
			`The private feed URL for "${feed.title}" is not available on this device. ` +
				"Remove the feed and add it again with its private URL.",
		);
	}
	return url;
}

/**
 * Move every credential-bearing saved-feed URL into SecretStorage. Returns the
 * migrated savedFeeds and how many feeds moved; zero means nothing to persist.
 * Best-effort per feed: one failing feed keeps its URL and the rest still move.
 */
export function migratePrivateFeedUrls(
	savedFeeds: Record<string, PodcastFeed>,
	feedUrls: FeedUrlRepository,
): { savedFeeds: Record<string, PodcastFeed>; migrated: number } {
	let migrated = 0;
	const result: Record<string, PodcastFeed> = {};
	for (const [key, feed] of Object.entries(savedFeeds)) {
		const interned = internPrivateFeed(feed, feedUrls);
		if (interned !== feed) migrated += 1;
		result[key] = interned;
	}
	return { savedFeeds: result, migrated };
}
