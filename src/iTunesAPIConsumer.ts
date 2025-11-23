import { requestUrl } from "obsidian";
import type { PodcastFeed } from "./types/PodcastFeed";

export async function queryiTunesPodcasts(query: string): Promise<PodcastFeed[]> {
	const url = new URL("https://itunes.apple.com/search?");
	url.searchParams.append("term", query);
	url.searchParams.append("media", "podcast");
	url.searchParams.append("limit", "3");
	url.searchParams.append("kind", "podcast");

	const res = await requestUrl({ url: url.href });
	const data = res.json.results;

	return data.map((d: { collectionName: string, feedUrl: string, artworkUrl100: string, collectionId: string }) => ({
		title: d.collectionName,
		url: d.feedUrl,
		artworkUrl: d.artworkUrl100,
		collectionId: d.collectionId
	}));
}
