import type { App } from "obsidian";
import { writable, type Readable, type Subscriber, type Unsubscriber } from "svelte/store";
import FeedDocumentParser, {
	type ParsedEpisodeDocument,
	type ParsedFeedDocument,
	type ParsedFeedEpisodes,
	type TranscriptLink,
} from "src/parser/feedDocumentParser";
import { DANGEROUS_KEYS, isPlainObject } from "src/persistence/codecUtils";
import { decodeDate, newestFirst } from "src/persistence/dateCodec";
import type { Episode } from "src/types/Episode";
import type { PodcastFeed } from "src/types/PodcastFeed";
import { findByGuid } from "src/utility/findByGuid";
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

/** Where a feed lives: its URL, or the placeholder and secret of a private feed. */
export type FeedAddress = Pick<PodcastFeed, "url" | "urlSecretId">;

export interface FeedRepositoryDeps {
	load(url: string): Promise<ParsedFeedEpisodes>;
	/** The URL to fetch a feed from, or null when its private URL is not on this device. */
	resolveUrl(feed: FeedAddress): string | null;
	storage: FeedCacheStorage;
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
	/** Rejects when the fetch fails. */
	inflight?: Promise<void>;
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
	/** The subscriptions' URLs: the documents worth caching. */
	private urls = new Set<string>();
	private readonly sources = new Map<string, Source>();
	private projections = new Map<FeedKey, Projection>();
	private readonly state = writable<ReadonlyMap<FeedKey, FeedState>>(new Map());
	private hydrated = false;

	constructor(private readonly deps: FeedRepositoryDeps) {
		// Earlier versions' caches can hold private feed URLs, so they go as soon as
		// PodNotes loads, not when a feed first loads (on mobile the view may stay closed).
		try {
			deps.storage.saveLocalStorage("podnotes:feed-cache:v5", null);
			for (const version of [1, 2, 3, 4]) {
				window.localStorage.removeItem(`podnotes:feed-cache:v${version}`);
			}
		} catch (error) {
			console.warn("PodNotes: could not remove old feed caches", error);
		}
	}

	subscribe(run: Subscriber<ReadonlyMap<FeedKey, FeedState>>): Unsubscriber {
		return this.state.subscribe(run);
	}

	setSubscriptions(feeds: Record<FeedKey, PodcastFeed>): void {
		const urls = new Set(Object.values(feeds).map((feed) => feed.url));
		const changed = [...urls].join() !== [...this.urls].join();
		this.subscriptions = new Map(Object.entries(feeds));
		this.urls = urls;
		for (const url of this.sources.keys()) {
			if (!urls.has(url)) this.sources.delete(url);
		}
		if (changed) this.persist();
		this.emit();
	}

	/**
	 * Resolves when every request it started or joined has settled, to false when one
	 * failed. Never rejects.
	 */
	load(keys: Iterable<FeedKey>, mode: LoadMode): Promise<boolean> {
		this.hydrate();
		const requests: Promise<void>[] = [];
		for (const key of keys) {
			const feed = this.subscriptions.get(key);
			const request = feed && this.request(feed, mode);
			if (request) requests.push(request);
		}
		return Promise.allSettled(requests).then((results) =>
			results.every(({ status }) => status === "fulfilled"),
		);
	}

	ensureAll(): Promise<boolean> {
		return this.load(this.subscriptions.keys(), "cached");
	}

	/**
	 * Episodes of the feed at `url`, named after its channel, for links that name a
	 * feed by URL. Fetches even a fresh feed, so a link finds an episode published
	 * since; the last copy stands in when the feed cannot be reached.
	 */
	async episodesAt(url: string): Promise<Episode[]> {
		const doc = await this.documentAt({ url }, "network");
		return projectEpisodes(doc.items, channelFeed(doc.channel, url));
	}

	/** Feed metadata that episodes do not carry, for one of a subscription's episodes. */
	episodeMetadata(key: FeedKey, episode: Episode): { transcripts: TranscriptLink[] } | undefined {
		const feed = this.subscriptions.get(key);
		const items = (feed && this.sources.get(feed.url)?.doc?.items) ?? [];
		// A guid is unique only within its feed, and another feed can share the subscription's name.
		const item =
			(feed?.url === episode.feedUrl ? findByGuid(items, episode.guid) : undefined) ??
			items.find(({ streamUrl }) => streamUrl === episode.streamUrl);
		return item && { transcripts: item.transcripts ?? [] };
	}

	itemUrl(key: FeedKey, reference: string): string | undefined {
		const [target] = reference.split("#", 1);
		if (/^[a-z][a-z\d+.-]*:/i.test(target)) return target;
		const feed = this.subscriptions.get(key);
		const base = feed && this.deps.resolveUrl(feed);
		if (!base) return undefined;
		try {
			return new URL(target, base).href;
		} catch {
			return undefined;
		}
	}

	/** The feed as a podcast, to preview, subscribe to or describe in a feed note. */
	async channelAt(feed: FeedAddress): Promise<PodcastFeed> {
		return channelFeed((await this.documentAt(feed, "cached")).channel, feed.url);
	}

	private async documentAt(feed: FeedAddress, mode: LoadMode): Promise<FeedDocument> {
		this.hydrate();
		const source = this.source(feed.url);
		const failure = await this.request(feed, mode)?.then(
			() => undefined,
			(error: unknown) => error,
		);
		if (source.doc) return source.doc;
		throw failure instanceof Error ? failure : new Error("Could not load the feed");
	}

	/** Joins the feed's request in flight, or starts one when `mode` asks for it. */
	private request(feed: FeedAddress, mode: LoadMode): Promise<void> | undefined {
		const source = this.source(feed.url);
		if (source.inflight || !this.needsFetch(source.doc, mode)) return source.inflight;
		const url = this.deps.resolveUrl(feed);
		if (url === null) {
			source.error = "unavailable";
			this.emit();
			return undefined;
		}
		return this.fetch(feed.url, url);
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
		return this.deps.now() - doc.updatedAt > CACHE_TTL_MS;
	}

	/** `sourceUrl` keys the document; `url` is what to fetch, the secret one for a private feed. */
	private fetch(sourceUrl: string, url: string): Promise<void> {
		const source = this.source(sourceUrl);
		const request = this.deps
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
					if (this.urls.has(sourceUrl)) this.persist();
				},
				(error: unknown) => {
					// A pasted or linked URL can carry a credential, so the log leaves it out.
					console.error("PodNotes: could not load a feed", error);
					source.error = "network";
					throw error;
				},
			)
			.finally(() => {
				source.inflight = undefined;
				this.emit();
			});
		source.inflight = request;
		this.emit();
		return request;
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
					episodes: doc ? projectEpisodes(doc.items, feed) : [],
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
		let cached: [string, FeedDocument][] = [];
		try {
			cached = decodeCache(this.deps.storage.loadLocalStorage(CACHE_KEY));
		} catch (error) {
			console.warn("PodNotes: could not read the feed cache", error);
		}
		const kept = cached.filter(([url]) => this.urls.has(url));
		for (const [url, doc] of kept) this.source(url).doc = doc;
		if (kept.length < cached.length) this.persist();
		if (kept.length) this.emit();
	}

	/** Writes only subscribed feeds, so a removed one leaves the cache with the next write. */
	private persist(): void {
		if (!this.hydrated) return;
		const entries: Record<string, FeedDocument> = {};
		for (const url of this.urls) {
			const doc = this.sources.get(url)?.doc;
			if (doc) entries[url] = keepNewestItems(doc);
		}
		let serialized = JSON.stringify(entries);
		if (serialized.length > MAX_CACHE_BYTES) {
			serialized = JSON.stringify(evictOldest(entries, MAX_CACHE_BYTES * 0.8));
		}
		try {
			// Clearing first leaves no cache, rather than an outdated one, when the write fails.
			this.deps.storage.saveLocalStorage(CACHE_KEY, null);
			this.deps.storage.saveLocalStorage(CACHE_KEY, serialized);
		} catch (error) {
			console.warn("PodNotes: could not save the feed cache", error);
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

function projectEpisodes(
	items: readonly ParsedEpisodeDocument[],
	feed: Pick<PodcastFeed, "title" | "url" | "artworkUrl">,
): Episode[] {
	const repeated = repeatedGuids(items);
	return items.map((item) => ({
		title: item.title,
		streamUrl: item.streamUrl,
		url: item.itemLink || feed.url,
		description: item.description,
		content: item.content,
		podcastName: feed.title,
		artworkUrl: item.artworkUrl || feed.artworkUrl,
		episodeDate: item.episodeDate,
		feedUrl: feed.url,
		// A guid that several items repeat identifies none of them, so notes and links never get it.
		guid: item.guid && !repeated.has(item.guid) ? item.guid : undefined,
		itunesTitle: item.itunesTitle || "",
		episodeNumber: item.episodeNumber,
		duration: item.duration,
		chaptersUrl: item.chaptersUrl,
		mediaType: item.mediaType,
	}));
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
const CACHE_TTL_MS = 6 * 3_600_000;
// Keep this >= MAX_EPISODE_LIST_LIMIT (src/constants.ts): Latest Episodes is built
// from cached documents on a warm start.
const MAX_ITEMS_PER_FEED = 75;
const MAX_CACHE_BYTES = 4 * 1024 * 1024;

/** The newest items by date, in feed order, so an oldest-first feed still keeps its latest episodes. */
function keepNewestItems(doc: FeedDocument): FeedDocument {
	if (doc.items.length <= MAX_ITEMS_PER_FEED) return doc;
	const kept = new Set([...doc.items].sort(newestFirst).slice(0, MAX_ITEMS_PER_FEED));
	// The cut can drop one of two items that share a guid, which would make the other look unique.
	const repeated = repeatedGuids(doc.items);
	const items = doc.items
		.filter((item) => kept.has(item))
		.map((item) =>
			item.guid && repeated.has(item.guid) ? { ...item, guid: undefined } : item,
		);
	return { ...doc, items, complete: false };
}

/** Guids that more than one item carries. */
function repeatedGuids(items: readonly ParsedEpisodeDocument[]): Set<string> {
	const seen = new Set<string>();
	const repeated = new Set<string>();
	for (const { guid } of items) if (guid) (seen.has(guid) ? repeated : seen).add(guid);
	return repeated;
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
		for (const item of items) {
			item.episodeDate = decodeDate(item.episodeDate);
			item.transcripts = decodeTranscripts(item.transcripts);
		}
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

function decodeTranscripts(value: unknown): TranscriptLink[] | undefined {
	return Array.isArray(value) ? value.filter(isTranscriptLink) : undefined;
}

function isTranscriptLink(value: unknown): value is TranscriptLink {
	return (
		isPlainObject(value) &&
		typeof value.url === "string" &&
		(["type", "language", "rel"] as const).every(
			(name) => value[name] === undefined || typeof value[name] === "string",
		)
	);
}
