import type { PodcastFeed } from "./types/PodcastFeed";
import checkStringIsUrl from "./utility/checkStringIsUrl";
import { NetworkError, fetchJsonWithTimeout } from "./utility/networkRequest";

const ITUNES_REQUEST_TIMEOUT_MS = 15_000;
const MAX_ITUNES_RESPONSE_BYTES = 2 * 1024 * 1024;
const APPLE_PODCASTS_HOSTS = new Set(["podcasts.apple.com", "itunes.apple.com"]);

interface iTunesResult {
	collectionName: string;
	artistName?: string;
	feedUrl?: string;
	artworkUrl100: string;
	collectionId: number;
	trackCount?: number;
}

export interface DirectoryShow {
	readonly feed: PodcastFeed;
	readonly episodes?: number;
}

interface iTunesResponse {
	results: iTunesResult[];
}

export async function queryiTunesPodcasts(query: string): Promise<DirectoryShow[]> {
	const url = new URL("https://itunes.apple.com/search");
	url.searchParams.append("term", query);
	url.searchParams.append("media", "podcast");
	url.searchParams.append("limit", "20");
	url.searchParams.append("kind", "podcast");

	// Search can list one feed under several shows; keep the best-ranked one.
	const shows = new Map<string, DirectoryShow>();
	for (const show of await fetchShows(url)) {
		if (!shows.has(show.feed.url)) shows.set(show.feed.url, show);
	}
	return [...shows.values()];
}

/** Resolve an Apple Podcasts show id to its public RSS feed, or null when it has none. */
export async function lookupiTunesPodcast(id: string): Promise<DirectoryShow | null> {
	const url = new URL("https://itunes.apple.com/lookup");
	url.searchParams.append("id", id);
	url.searchParams.append("entity", "podcast");
	// An artist id returns the artist's shows, none of which is the linked show.
	const shows = await fetchShows(url);
	return shows.find(({ feed }) => feed.collectionId === id) ?? null;
}

/**
 * Extract the show id from an Apple Podcasts link: a `podcast` or `viewPodcast`
 * path with the id in its last `id<digits>` segment or an `id` query parameter.
 */
export function parseApplePodcastsId(input: string): string | null {
	const url = checkStringIsUrl(input);
	if (
		!url ||
		(url.protocol !== "https:" && url.protocol !== "http:") ||
		!APPLE_PODCASTS_HOSTS.has(url.hostname)
	) {
		return null;
	}

	const segments = url.pathname.split("/");
	if (!segments.some((segment) => segment === "podcast" || segment === "viewPodcast")) {
		return null;
	}
	const id =
		segments
			.filter((segment) => /^id\d+$/.test(segment))
			.pop()
			?.slice(2) ?? url.searchParams.get("id");
	return id && /^\d+$/.test(id) ? id : null;
}

async function fetchShows(url: URL): Promise<DirectoryShow[]> {
	try {
		const data = await fetchJsonWithTimeout<iTunesResponse>(url.href, {
			timeoutMs: ITUNES_REQUEST_TIMEOUT_MS,
			maxResponseBytes: MAX_ITUNES_RESPONSE_BYTES,
			acceptedStatuses: [200],
		});
		if (!data || typeof data !== "object" || !Array.isArray(data.results)) {
			throw new NetworkError("invalid-response");
		}

		return data.results.map(toShow).filter((show) => show !== null);
	} catch (error) {
		// Keep diagnostics useful without copying a target, query, native error, or
		// response body into the console. NetworkError messages and status values are
		// deliberately redacted by the shared boundary.
		if (error instanceof NetworkError) {
			console.error("iTunes request failed.", error.code, error.status);
			throw error;
		}
		console.error("iTunes response is invalid.");
		throw new NetworkError("invalid-response");
	}
}

// Shows without a public RSS feed (Apple-hosted or subscription-only) cannot be added.
function toShow(result: iTunesResult): DirectoryShow | null {
	if (typeof result.feedUrl !== "string") return null;
	return {
		feed: {
			title: result.collectionName,
			url: result.feedUrl,
			artworkUrl: result.artworkUrl100,
			collectionId: String(result.collectionId),
			...(typeof result.artistName === "string" ? { author: result.artistName } : {}),
		},
		episodes: result.trackCount,
	};
}
