import { Notice } from "obsidian";
import { get } from "svelte/store";
import { plugin } from "src/store";
import type { Episode } from "src/types/Episode";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import type { PodcastFeed } from "src/types/PodcastFeed";
import checkStringIsUrl from "src/utility/checkStringIsUrl";
import { ownRecord } from "src/utility/ownRecord";
import {
	canonicalUrl,
	isCredentialBearingUrl,
	isPrivateFeedPlaceholder,
	privateFeedPlaceholder,
	redactPrivateFeedAddresses,
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
 * on this device. The persistence boundary also resolves addresses to replace
 * their copies with placeholders. OPML export deliberately carries the real
 * feed URLs at the user's request.
 */

/**
 * Return the feed as it may be persisted: a credential-bearing URL moves into
 * SecretStorage and is replaced by a placeholder + reference. Applies even
 * when a reference already exists (an imported or hand-edited record can
 * carry BOTH a reference and a raw URL - the raw URL is the visible ground
 * truth, so it is re-interned and the placeholder restored). Non-credentialed
 * feeds pass through untouched. Throws when SecretStorage fails: the URL must
 * never be saved in its place.
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
	const urlSecretId = feedUrls.store(feed.url);
	return { ...feed, url: privateFeedPlaceholder(savedKey), urlSecretId };
}

/**
 * The http(s) address of a public feed, safe to show and to copy. A private feed has
 * none, since its address is a secret, and this never resolves one.
 */
export function publicFeedUrl(feed: PodcastFeed): string | undefined {
	if (feed.urlSecretId?.trim() || isPrivateFeedPlaceholder(feed.url)) return undefined;
	if (isCredentialBearingUrl(feed.url)) return undefined;
	const protocol = checkStringIsUrl(feed.url)?.protocol;
	return protocol === "http:" || protocol === "https:" ? feed.url : undefined;
}

/** Whether this saved private feed waits for its URL to be set on this device. */
export function needsPrivateFeedAddress(feed: PodcastFeed, feedUrls: FeedUrlRepository): boolean {
	return Boolean(feed.urlSecretId?.trim()) && resolveFeedUrl(feed, feedUrls) === null;
}

/**
 * Set a saved private feed's URL on this device, under the reference data.json
 * already holds. Every device keeps its own copy under that one reference, so
 * setting it up here leaves the feed working on the others. Throws when `url`
 * is not a private feed URL or SecretStorage cannot keep it.
 */
export function setPrivateFeedAddress(
	feed: PodcastFeed,
	url: string,
	feedUrls: FeedUrlRepository,
): void {
	if (!feed.urlSecretId || !isCredentialBearingUrl(url)) {
		throw new Error("Not a private feed URL for this feed.");
	}
	feedUrls.attach(feed.urlSecretId, url);
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

/** The savedFeeds key of the feed at `url`, whatever the feed is called now. */
export function findSavedFeed(
	feeds: Record<string, PodcastFeed>,
	url: string,
	feedUrls: FeedUrlRepository,
): string | undefined {
	return Object.keys(feeds).find((key) => isSavedFeed(feeds[key], url, feedUrls));
}

/** Tells the user that a saved private feed's URL is not on this device. */
export function notifyPrivateFeedUnavailable(title: string): void {
	new Notice(`The private feed address for "${title}" is not available on this device.`);
}

export interface PrivateFeedProtection {
	settings: IPodNotesSettings;
	/** Feeds whose addresses are available only for this session. */
	failed: string[];
}

export function protectPrivateFeeds(
	settings: IPodNotesSettings,
	feedUrls: FeedUrlRepository,
): PrivateFeedProtection {
	const failed: string[] = [];
	const savedFeeds = ownRecord<PodcastFeed>();
	let moved = false;
	for (const [key, feed] of Object.entries(settings.savedFeeds)) {
		let interned = feed;
		try {
			interned = internPrivateFeed(feed, feedUrls, key);
		} catch (error) {
			console.error(`PodNotes: could not protect the private feed "${key}"`, error);
			failed.push(key);
			interned = {
				...feed,
				url: privateFeedPlaceholder(key),
				urlSecretId: feedUrls.retainForSession(feed.url),
			};
		}
		if (interned !== feed) moved = true;
		savedFeeds[key] = interned;
	}
	return {
		settings: redactPrivateFeedAddresses(
			moved ? { ...settings, savedFeeds } : settings,
			privateFeedAddresses(savedFeeds, feedUrls),
		),
		failed,
	};
}

/**
 * Each saved private feed's URL on this device, to the placeholder naming its
 * saved key, which links resolve by. An episode snapshot of the feed takes that
 * placeholder even when the feed is now called something else.
 */
export function privateFeedAddresses(
	feeds: Record<string, PodcastFeed>,
	feedUrls: FeedUrlRepository,
): Map<string, string> {
	const addresses = new Map<string, string>();
	for (const feed of Object.values(feeds)) {
		if (!isPrivateFeedPlaceholder(feed.url)) continue;
		const url = resolveFeedUrl(feed, feedUrls);
		if (url) addresses.set(url, feed.url);
	}
	return addresses;
}

export function withoutPrivateFeedAddresses<T>(value: T): T {
	const instance = get(plugin);
	return redactPrivateFeedAddresses(
		value,
		instance?.feedUrls && privateFeedAddresses(instance.settings.savedFeeds, instance.feedUrls),
	);
}

/**
 * `target` when a note may address `episode` by it, so a PodNotes link or note
 * identity can carry it with the episode's title and GUID. Undefined when the
 * target is a private feed's own address, or any of them quotes one, because a
 * redacted title or GUID would no longer find the episode.
 */
export function vaultSafeLinkTarget(
	episode: Pick<Episode, "title" | "guid">,
	target: string | undefined,
): string | undefined {
	if (!target || isCredentialBearingUrl(target)) return undefined;
	const fields = [target, episode.title, episode.guid];
	return withoutPrivateFeedAddresses(fields) === fields ? target : undefined;
}
