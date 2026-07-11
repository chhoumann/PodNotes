import { Notice } from "obsidian";
import { get } from "svelte/store";
import type { IAPI } from "./API/IAPI";
import { queryiTunesPodcasts } from "./iTunesAPIConsumer";
import { savedFeeds } from "./store";
import { NetworkError, fetchJsonWithTimeout } from "./utility/networkRequest";

const POD_LINK_REQUEST_TIMEOUT_MS = 15_000;
const MAX_POD_LINK_RESPONSE_BYTES = 4 * 1024 * 1024;

interface PodLinkEpisode {
	episodeId: string;
	title: string;
}

interface PodLinkResponse {
	episodes: PodLinkEpisode[];
}

const normalizeFeedUrl = (url: string | undefined): string =>
	(url ?? "").trim().replace(/\/+$/, "").toLowerCase();

/**
 * Resolve the iTunes collectionId for the loaded episode's podcast. Prefer the
 * saved feed's collectionId (populated for iTunes-added feeds) so we skip the
 * iTunes re-query and the brittle channel-title/url comparison entirely. Only
 * when it is unavailable (custom-URL/OPML feeds) do we fall back to a tolerant
 * iTunes lookup that normalizes the feed URL before comparing.
 */
async function resolveCollectionId(
	podcastName: string,
	feedUrl: string | undefined,
): Promise<string | undefined> {
	const feeds = get(savedFeeds);
	const targetUrl = normalizeFeedUrl(feedUrl);
	// Prefer a normalized feed-URL match above everything else (even the
	// podcastName-keyed entry): duplicate or rehosted podcast titles mean a
	// same-name entry can point at a different feed while another saved entry's
	// URL actually matches the playing episode. Only when no URL match exists do
	// we fall back to the name key, then a title match (Codex review #213).
	const savedFeed =
		(targetUrl
			? Object.values(feeds).find((feed) => normalizeFeedUrl(feed.url) === targetUrl)
			: undefined) ??
		feeds[podcastName] ??
		Object.values(feeds).find((feed) => feed.title === podcastName);

	if (savedFeed?.collectionId) {
		return savedFeed.collectionId;
	}

	const iTunesResponse = await queryiTunesPodcasts(podcastName);
	const match =
		(targetUrl
			? iTunesResponse.find((pod) => normalizeFeedUrl(pod.url) === targetUrl)
			: undefined) ?? iTunesResponse.find((pod) => pod.title === podcastName);

	return match?.collectionId;
}

export default async function getUniversalPodcastLink(api: IAPI) {
	const { title, itunesTitle, podcastName, feedUrl } = api.podcast;

	let url: string;
	try {
		const collectionId = await resolveCollectionId(podcastName, feedUrl);
		if (!collectionId) {
			new Notice(
				`Could not find "${podcastName}" on Apple Podcasts to build a universal link.`,
			);
			return;
		}

		const podLinkUrl = `https://pod.link/${collectionId}.json?limit=1000`;
		const data = await fetchJsonWithTimeout<PodLinkResponse>(podLinkUrl, {
			timeoutMs: POD_LINK_REQUEST_TIMEOUT_MS,
			maxResponseBytes: MAX_POD_LINK_RESPONSE_BYTES,
			acceptedStatuses: [200],
		});

		const targetTitle = itunesTitle ?? title;

		if (!data || typeof data !== "object" || !Array.isArray(data.episodes)) {
			throw new NetworkError("invalid-response");
		}
		const ep = data.episodes.find(
			(episode) =>
				episode !== null &&
				typeof episode === "object" &&
				typeof episode.episodeId === "string" &&
				typeof episode.title === "string" &&
				episode.title === targetTitle,
		);
		if (!ep) {
			new Notice(
				`Could not find episode "${targetTitle}" on pod.link to build a universal link.`,
			);
			return;
		}

		url = `https://pod.link/${collectionId}/episode/${ep.episodeId}`;
	} catch {
		new Notice("Could not get podcast link.");
		console.error("Could not resolve universal podcast link.");

		return;
	}

	// Copy outside the lookup try/catch so a clipboard failure is reported on its
	// own terms, never mislabeled as a lookup failure. navigator.clipboard is
	// undefined on mobile / non-secure contexts, so fall back to surfacing the URL.
	if (navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(url);
			new Notice("Universal episode link copied to clipboard.");
		} catch {
			console.error("Could not copy universal podcast link to the clipboard.");
			new Notice(`Could not copy to clipboard. Episode link: ${url}`);
		}
	} else {
		new Notice(`Clipboard unavailable. Episode link: ${url}`);
	}
}
