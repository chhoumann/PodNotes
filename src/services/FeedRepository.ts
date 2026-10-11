import type { App } from "obsidian";
import { writable, type Readable, type Subscriber, type Unsubscriber } from "svelte/store";
import FeedDocumentParser, {
	type ParsedEpisodeDocument,
	type ParsedFeedDocument,
	type ParsedFeedEpisodes,
} from "src/parser/feedDocumentParser";
import { DANGEROUS_KEYS, isPlainObject } from "src/persistence/codecUtils";
import { dateTimestamp, decodeDate } from "src/persistence/dateCodec";
import type { Episode } from "src/types/Episode";
import type { PodcastFeed } from "src/types/PodcastFeed";
import { fetchTextWithTimeout } from "src/utility/networkRequest";

/** A savedFeeds key, the only identity of a subscription. */
export type FeedKey = string;

export type FeedStatus = "idle" | "loading" | "ready" | "stale" | "error";

/** "unavailable": the private feed URL is not on this device. "network": fetching or parsing failed. */
export type FeedError = "unavailable" | "network";

export interface FeedState {
	readonly feed: PodcastFeed;
	readonly status: FeedStatus;
	readonly error?: FeedError;
	/** Projected against `feed`. Keeps its array reference until the document, title or artwork changes. */
	readonly episodes: readonly Episode[];
	/** Set once the feed has a document, fresh or stale. */
	readonly channel?: ParsedFeedDocument;
}

/**
 * cached: fetch when there is no document or it expired.
 * complete: also fetch when the cache cap cut the document short.
 * network: always fetch.
 */
export type LoadMode = "cached" | "complete" | "network";

export type FeedCacheStorage = Pick<App, "loadLocalStorage" | "saveLocalStorage">;

export interface FeedRepositoryDeps {
	load(url: string): Promise<ParsedFeedEpisodes>;
	/** The URL to fetch a saved feed from, or null when its private URL is not on this device. */
	resolveUrl(feed: PodcastFeed): string | null;
	storage: FeedCacheStorage;
	cache(): { enabled: boolean; ttlHours: number };
	now(): number;
}

interface FeedDocument {
	channel: ParsedFeedDocument;
	items: ParsedEpisodeDocument[];
	/** False when the cache kept only the newest items. */
	complete: boolean;
	updatedAt: number;
}

interface Source {
	doc?: FeedDocument;
	error?: FeedError;
	/** Resolves to the failure, if any. */
	inflight?: Promise<unknown>;
}

interface Projection {
	doc?: FeedDocument;
	title: string;
	artworkUrl: string;
	episodes: Episode[];
}

/**
 * Fetches, parses and caches feeds, and emits one state per subscription.
 *
 * Documents are keyed by feed URL, so subscriptions that share a URL share one
 * request and one document but get their own projected episodes. A source no
 * subscription references is dropped from `sources`, so a request still in flight
 * for it settles into a detached object nobody reads.
 */
export class FeedRepository implements Readable<ReadonlyMap<FeedKey, FeedState>> {
	private subscriptions = new Map<FeedKey, PodcastFeed>();
	private readonly sources = new Map<string, Source>();
	private projections = new Map<FeedKey, Projection>();
	private readonly state = writable<ReadonlyMap<FeedKey, FeedState>>(new Map());
	private hydrated = false;

	constructor(private readonly deps: FeedRepositoryDeps) {}

	subscribe(run: Subscriber<ReadonlyMap<FeedKey, FeedState>>): Unsubscriber {
		return this.state.subscribe(run);
	}

	setSubscriptions(feeds: Record<FeedKey, PodcastFeed>): void {
		this.subscriptions = new Map(Object.entries(feeds));
		const urls = new Set(Object.values(feeds).map((feed) => feed.url));
		let dropped = false;
		for (const url of this.sources.keys()) {
			if (urls.has(url)) continue;
			this.sources.delete(url);
			dropped = true;
		}
		if (dropped) this.persist();
		this.emit();
	}

	/** Resolves when every request it started or joined has settled. Never rejects. */
	load(keys: Iterable<FeedKey>, mode: LoadMode): Promise<void> {
		this.hydrate();
		const requests: Promise<unknown>[] = [];
		for (const key of keys) {
			const feed = this.subscriptions.get(key);
			if (!feed) continue;
			const source = this.source(feed.url);
			if (source.inflight) {
				requests.push(source.inflight);
			} else if (this.needsFetch(source.doc, mode)) {
				const url = this.deps.resolveUrl(feed);
				if (url === null) source.error = "unavailable";
				else requests.push(this.fetch(feed.url, url));
			}
		}
		this.emit();
		return Promise.all(requests).then(() => undefined);
	}

	ensureAll(): Promise<void> {
		return this.load(this.subscriptions.keys(), "cached");
	}

	/** Episodes of the feed at `url`, named after its channel, for links that name a feed by URL. */
	async episodesAt(url: string): Promise<Episode[]> {
		const doc = await this.documentAt(url);
		const feed = channelFeed(doc.channel, url);
		return doc.items.map((item) => projectEpisode(item, feed));
	}

	clear(): void {
		for (const source of this.sources.values()) source.doc = undefined;
		this.deps.storage.saveLocalStorage(CACHE_KEY, null);
		removeLegacyCaches(this.deps.storage);
		this.emit();
		void this.ensureAll();
	}

	private async documentAt(url: string): Promise<FeedDocument> {
		this.hydrate();
		const source = this.source(url);
		const failure = await (source.inflight ??
			(this.needsFetch(source.doc, "complete") ? this.fetch(url, url) : undefined));
		if (!source.doc) throw failure;
		return source.doc;
	}

	private source(url: string): Source {
		let source = this.sources.get(url);
		if (!source) this.sources.set(url, (source = {}));
		return source;
	}

	private needsFetch(doc: FeedDocument | undefined, mode: LoadMode): boolean {
		return (
			!doc ||
			mode === "network" ||
			(mode === "complete" && !doc.complete) ||
			this.isExpired(doc)
		);
	}

	private isExpired(doc: FeedDocument): boolean {
		return (
			this.deps.now() - doc.updatedAt > Math.max(1, this.deps.cache().ttlHours) * 3_600_000
		);
	}

	/** `sourceUrl` keys the document; `url` is what to fetch, the secret one for a private feed. */
	private fetch(sourceUrl: string, url: string): Promise<unknown> {
		const source = this.source(sourceUrl);
		source.inflight = this.deps
			.load(url)
			.then(
				(parsed) => {
					source.doc = {
						channel: parsed.feed,
						items: parsed.episodes,
						complete: true,
						updatedAt: this.deps.now(),
					};
					source.error = undefined;
					this.persist();
				},
				(error: unknown) => {
					console.error(`PodNotes: could not load the feed ${sourceUrl}`, error);
					source.error = "network";
					return error;
				},
			)
			.then((failure) => {
				source.inflight = undefined;
				this.emit();
				return failure;
			});
		return source.inflight;
	}

	private statusOf(source: Source | undefined): FeedStatus {
		if (source?.inflight) return "loading";
		if (source?.doc) return source.error || this.isExpired(source.doc) ? "stale" : "ready";
		return source?.error ? "error" : "idle";
	}

	private emit(): void {
		const projections = new Map<FeedKey, Projection>();
		const state = new Map<FeedKey, FeedState>();
		for (const [key, feed] of this.subscriptions) {
			const source = this.sources.get(feed.url);
			const doc = source?.doc;
			let projection = this.projections.get(key);
			if (
				!projection ||
				projection.doc !== doc ||
				projection.title !== feed.title ||
				projection.artworkUrl !== feed.artworkUrl
			) {
				projection = {
					doc,
					title: feed.title,
					artworkUrl: feed.artworkUrl,
					episodes: doc?.items.map((item) => projectEpisode(item, feed)) ?? [],
				};
			}
			projections.set(key, projection);
			state.set(key, {
				feed,
				status: this.statusOf(source),
				error: source?.error,
				episodes: projection.episodes,
				channel: doc?.channel,
			});
		}
		this.projections = projections;
		this.state.set(state);
	}

	private hydrate(): void {
		if (this.hydrated) return;
		this.hydrated = true;
		if (!this.deps.cache().enabled) return;
		removeLegacyCaches(this.deps.storage);
		for (const [url, doc] of decodeCache(this.deps.storage.loadLocalStorage(CACHE_KEY))) {
			this.source(url).doc = doc;
		}
	}

	/** Writes only subscribed feeds, so a removed one leaves the cache with the next write. */
	private persist(): void {
		if (!this.deps.cache().enabled) return;
		const entries: Record<string, FeedDocument> = {};
		for (const { url } of this.subscriptions.values()) {
			const doc = this.sources.get(url)?.doc;
			if (doc) entries[url] = keepNewestItems(doc);
		}
		let serialized = JSON.stringify(entries);
		if (serialized.length > MAX_CACHE_BYTES) {
			serialized = JSON.stringify(evictOldest(entries, MAX_CACHE_BYTES * 0.8));
		}
		try {
			this.deps.storage.saveLocalStorage(CACHE_KEY, serialized);
		} catch (error) {
			console.warn("PodNotes: could not save the feed cache", error);
			this.deps.storage.saveLocalStorage(CACHE_KEY, null);
		}
	}
}

const parser = new FeedDocumentParser();

export async function loadFeed(url: string): Promise<ParsedFeedEpisodes> {
	const xml = await fetchTextWithTimeout(url, {
		timeoutMs: 30_000,
		maxResponseBytes: 16 * 1024 * 1024,
		acceptedStatuses: [200],
	});
	return parser.parseEpisodes(xml);
}

function projectEpisode(
	item: ParsedEpisodeDocument,
	feed: Pick<PodcastFeed, "title" | "url" | "artworkUrl">,
): Episode {
	return {
		title: item.title,
		streamUrl: item.streamUrl,
		url: item.itemLink || feed.url,
		description: item.description,
		content: item.content,
		podcastName: feed.title,
		artworkUrl: item.artworkUrl || feed.artworkUrl,
		episodeDate: item.episodeDate,
		feedUrl: feed.url,
		itunesTitle: item.itunesTitle || "",
		episodeNumber: item.episodeNumber,
		duration: item.duration,
		chaptersUrl: item.chaptersUrl,
		mediaType: item.mediaType,
	};
}

function channelFeed(channel: ParsedFeedDocument, url: string): PodcastFeed {
	return {
		title: channel.title,
		url,
		artworkUrl: channel.artworkUrl ?? "",
		link: channel.siteUrl,
		description: channel.description,
		author: channel.author,
	};
}

// v6 stores parsed documents instead of episodes projected for one subscription.
// v1-v4 lived in the global localStorage, v5 in the vault-scoped one.
const CACHE_KEY = "podnotes:feed-cache:v6";
// Keep this >= MAX_EPISODE_LIST_LIMIT (src/constants.ts): Latest Episodes is built
// from cached documents on a warm start.
const MAX_ITEMS_PER_FEED = 75;
const MAX_CACHE_BYTES = 4 * 1024 * 1024;

function removeLegacyCaches(storage: FeedCacheStorage): void {
	storage.saveLocalStorage("podnotes:feed-cache:v5", null);
	for (const version of [1, 2, 3, 4]) {
		window.localStorage.removeItem(`podnotes:feed-cache:v${version}`);
	}
}

/** The newest items by date, in feed order, so an oldest-first feed still keeps its latest episodes. */
function keepNewestItems(doc: FeedDocument): FeedDocument {
	if (doc.items.length <= MAX_ITEMS_PER_FEED) return doc;
	const time = (item: ParsedEpisodeDocument) => dateTimestamp(item.episodeDate) ?? 0;
	const kept = new Set(
		[...doc.items].sort((a, b) => time(b) - time(a)).slice(0, MAX_ITEMS_PER_FEED),
	);
	return { ...doc, items: doc.items.filter((item) => kept.has(item)), complete: false };
}

function evictOldest(
	entries: Record<string, FeedDocument>,
	targetBytes: number,
): Record<string, FeedDocument> {
	const kept: Record<string, FeedDocument> = {};
	let bytes = 0;
	for (const [url, doc] of Object.entries(entries).sort(
		([, a], [, b]) => b.updatedAt - a.updatedAt,
	)) {
		const size = JSON.stringify({ [url]: doc }).length;
		if (bytes + size > targetBytes) continue;
		kept[url] = doc;
		bytes += size;
	}
	return kept;
}

function decodeCache(raw: unknown): [string, FeedDocument][] {
	let value: unknown;
	try {
		value = typeof raw === "string" ? JSON.parse(raw) : undefined;
	} catch {
		return [];
	}
	if (!isPlainObject(value)) return [];
	return Object.entries(value).flatMap(([url, entry]): [string, FeedDocument][] => {
		if (
			DANGEROUS_KEYS.has(url) ||
			!isPlainObject(entry) ||
			!isPlainObject(entry.channel) ||
			typeof entry.channel.title !== "string" ||
			!Number.isFinite(entry.updatedAt) ||
			!Array.isArray(entry.items)
		) {
			return [];
		}
		const items = entry.items.filter(
			(item): item is ParsedEpisodeDocument =>
				isPlainObject(item) &&
				typeof item.title === "string" &&
				typeof item.streamUrl === "string",
		);
		for (const item of items) item.episodeDate = decodeDate(item.episodeDate);
		return [
			[
				url,
				{
					channel: entry.channel as unknown as ParsedFeedDocument,
					items,
					complete: entry.complete === true,
					updatedAt: entry.updatedAt as number,
				},
			],
		];
	});
}
