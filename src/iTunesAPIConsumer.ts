import type { PodcastFeed } from "./types/PodcastFeed";
import { requestWithTimeout, NetworkError } from "./utility/networkRequest";

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
		if (error instanceof NetworkError) {
			console.error(`iTunes search failed: ${error.message}`);
		}
		return [];
	}
}
