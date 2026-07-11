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
 * Ingress (subscribe, OPML import, settings import, load-time migration)
 * interns a credential-bearing URL into SecretStorage and persists only a
 * placeholder. Egress (`resolveFeedUrl`) turns a saved feed back into a
 * fetchable URL immediately before retrieval and nowhere else - callers keep
 * the resolved value confined to the fetch call and never persist or log it.
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

export interface PrivateFeedMigration {
	savedFeeds: Record<string, PodcastFeed>;
	/** Old credential-bearing URL -> the placeholder that replaced it. */
	replacements: Map<string, string>;
	/** Feeds whose URL could NOT be protected (SecretStorage failure). */
	failed: string[];
}

/**
 * Move every credential-bearing saved-feed URL into SecretStorage.
 * Best-effort per feed: one failing feed keeps its URL, is reported in
 * `failed`, and the rest still move.
 */
export function migratePrivateFeedUrls(
	savedFeeds: Record<string, PodcastFeed>,
	feedUrls: FeedUrlRepository,
): PrivateFeedMigration {
	const replacements = new Map<string, string>();
	const failed: string[] = [];
	const result: Record<string, PodcastFeed> = {};
	for (const [key, feed] of Object.entries(savedFeeds)) {
		const interned = internPrivateFeed(feed, feedUrls, key);
		if (interned !== feed) {
			replacements.set(feed.url, interned.url);
		} else if (isCredentialBearingUrl(feed.url)) {
			failed.push(key);
		}
		result[key] = interned;
	}
	return { savedFeeds: result, replacements, failed };
}

/**
 * Rewrite persisted Episode snapshots that still carry a migrated feed's old
 * credential-bearing URL (played history, queue, favorites, playlists, local
 * files, downloads, and the current episode all persist full episode objects
 * whose `url`/`feedUrl` were stamped at fetch time).
 */
export function scrubMigratedEpisodeUrls<T>(value: T, replacements: Map<string, string>): T {
	if (replacements.size === 0) return value;
	if (Array.isArray(value)) {
		return value.map((entry) => scrubMigratedEpisodeUrls(entry, replacements)) as T;
	}
	if (typeof value !== "object" || value === null) return value;
	// Decoded settings carry Date instances (episodeDate); recursing into one
	// would flatten it into {}. Non-plain objects hold no episode URLs.
	if (Object.getPrototypeOf(value) !== Object.prototype) return value;

	const record = value as Record<string, unknown>;
	let changed = false;
	const next: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(record)) {
		let scrubbed: unknown;
		if ((key === "url" || key === "feedUrl") && typeof entry === "string") {
			scrubbed = replacements.get(entry) ?? entry;
		} else {
			scrubbed = scrubMigratedEpisodeUrls(entry, replacements);
		}
		if (scrubbed !== entry) changed = true;
		next[key] = scrubbed;
	}
	return (changed ? next : value) as T;
}
