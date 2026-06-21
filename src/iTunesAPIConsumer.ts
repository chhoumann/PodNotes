import type { PodcastFeed } from "./types/PodcastFeed";
import { requestWithTimeout } from "./utility/networkRequest";

interface iTunesResult {
	collectionName: string;
	feedUrl: string;
	artworkUrl100: string;
	collectionId: string;
}

interface iTunesSearchResponse {
	results: iTunesResult[];
}

export async function queryiTunesPodcasts(query: string): Promise<PodcastFeed[]> {
	const url = new URL("https://itunes.apple.com/search?");
	url.searchParams.append("term", query);
	url.searchParams.append("media", "podcast");
	url.searchParams.append("limit", "3");
	url.searchParams.append("kind", "podcast");

	try {
		const response = await requestWithTimeout(url.href, { timeoutMs: 15000 });
		const data = response.json as iTunesSearchResponse;

		return (data.results || []).map((d) => ({
			title: d.collectionName,
			url: d.feedUrl,
			artworkUrl: d.artworkUrl100,
			collectionId: d.collectionId,
		}));
	} catch (error) {
		// Log every failure (including a malformed-JSON SyntaxError from
		// response.json), not just NetworkError, so swallowed errors are
		// diagnosable, then rethrow so the caller can distinguish a genuine
		// failure from a legitimate empty result set (SA-01). Returning [] here
		// collapsed both into the benign "No results." message.
		const message = error instanceof Error ? error.message : String(error);
		console.error(`iTunes search failed: ${message}`);
		throw error instanceof Error ? error : new Error(message);
	}
}
