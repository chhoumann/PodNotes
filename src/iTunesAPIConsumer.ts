import type { PodcastFeed } from "./types/PodcastFeed";
import { NetworkError, fetchJsonWithTimeout } from "./utility/networkRequest";

const ITUNES_REQUEST_TIMEOUT_MS = 15_000;
const MAX_ITUNES_RESPONSE_BYTES = 2 * 1024 * 1024;

interface iTunesResult {
	collectionName: string;
	feedUrl?: string;
	artworkUrl100: string;
	collectionId: number;
}

interface iTunesResponse {
	results: iTunesResult[];
}

export async function queryiTunesPodcasts(query: string): Promise<PodcastFeed[]> {
	const url = new URL("https://itunes.apple.com/search");
	url.searchParams.append("term", query);
	url.searchParams.append("media", "podcast");
	url.searchParams.append("limit", "20");
	url.searchParams.append("kind", "podcast");
	return fetchPodcastFeeds(url);
}

async function fetchPodcastFeeds(url: URL): Promise<PodcastFeed[]> {
	try {
		const data = await fetchJsonWithTimeout<iTunesResponse>(url.href, {
			timeoutMs: ITUNES_REQUEST_TIMEOUT_MS,
			maxResponseBytes: MAX_ITUNES_RESPONSE_BYTES,
			acceptedStatuses: [200],
		});
		if (!data || typeof data !== "object" || !Array.isArray(data.results)) {
			throw new NetworkError("invalid-response");
		}

		return data.results.map(toPodcastFeed).filter((feed) => feed !== null);
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
function toPodcastFeed(result: iTunesResult): PodcastFeed | null {
	if (typeof result.feedUrl !== "string") return null;
	return {
		title: result.collectionName,
		url: result.feedUrl,
		artworkUrl: result.artworkUrl100,
		collectionId: String(result.collectionId),
	};
}
