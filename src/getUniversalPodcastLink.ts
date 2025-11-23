import { requestUrl, Notice } from "obsidian";
import type { IAPI } from "./API/IAPI";
import { queryiTunesPodcasts } from "./iTunesAPIConsumer";

export default async function getUniversalPodcastLink(api: IAPI) {
	const { title, itunesTitle, podcastName, feedUrl } = api.podcast;
    
	try {
		const iTunesResponse = await queryiTunesPodcasts(
			api.podcast.podcastName
		);
		const podcast = iTunesResponse.find(
			(pod) => pod.title === podcastName && pod.url === feedUrl
		);

		if (!podcast || !podcast.collectionId) {
			throw new Error("Failed to get podcast from iTunes.");
		}

		const podLinkUrl = `https://pod.link/${podcast.collectionId}.json?limit=1000`;
		const res = await requestUrl({
			url: podLinkUrl,
		});

		if (res.status !== 200) {
			throw new Error(
				`Failed to get response from pod.link: ${podLinkUrl}`
			);
		}

		const targetTitle = itunesTitle ?? title;

		const ep = res.json.episodes.find(
			(episode: {
				episodeId: string;
				title: string;
				[key: string]: string;
			}) => episode.title === targetTitle
		);
		if (!ep) {
			throw new Error(
				`Failed to find episode "${targetTitle}" on pod.link. URL: ${podLinkUrl}`
			);
		}

		window.navigator.clipboard.writeText(
			`https://pod.link/${podcast.collectionId}/episode/${ep.episodeId}`
		);

		new Notice("Universal episode link copied to clipboard.");
	} catch (error) {
		new Notice("Could not get podcast link.");
		console.error(error);

		return;
	}
}
