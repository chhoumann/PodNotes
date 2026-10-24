import type { Chapter, ChaptersData } from "src/types/Chapter";
import type { Episode } from "src/types/Episode";
import { isFetchableUrl } from "./assertFetchableUrl";
import { fetchId3Chapters } from "./id3Chapters";
import { fetchTextWithTimeout } from "./networkRequest";
import { normalizeChapters } from "./normalizeChapters";

const MAX_CHAPTERS_RESPONSE_CHARS = 1_000_000;
const MAX_CHAPTERS_RESPONSE_BYTES = MAX_CHAPTERS_RESPONSE_CHARS * 4;
const CHAPTERS_REQUEST_TIMEOUT_MS = 10_000;

export type ChaptersSource = Pick<Episode, "chaptersUrl" | "streamUrl">;

/** Where the chapters come from: the chapters file, else the media they are read from. */
export function chaptersKey(episode: ChaptersSource): string {
	return episode.chaptersUrl || episode.streamUrl;
}

/**
 * An episode's chapters: its Podcasting 2.0 chapters file, else the ID3 chapters of its
 * media. Undefined when a request failed, as offline, so a later call tries again.
 */
export async function fetchChapters(episode: ChaptersSource): Promise<Chapter[] | undefined> {
	if (episode.chaptersUrl) return fetchJsonChapters(episode.chaptersUrl);
	if (!isFetchableUrl(episode.streamUrl)) return [];
	return fetchId3Chapters(episode.streamUrl);
}

async function fetchJsonChapters(chaptersUrl: string): Promise<Chapter[] | undefined> {
	try {
		const responseText = await fetchTextWithTimeout(chaptersUrl, {
			timeoutMs: CHAPTERS_REQUEST_TIMEOUT_MS,
			maxResponseBytes: MAX_CHAPTERS_RESPONSE_BYTES,
			acceptedStatuses: [200],
		});
		if (responseText.length > MAX_CHAPTERS_RESPONSE_CHARS) {
			return [];
		}

		const data: ChaptersData = JSON.parse(responseText);

		if (!Array.isArray(data.chapters)) {
			return [];
		}

		return normalizeChapters(data.chapters);
	} catch {
		console.warn("Failed to fetch chapters.");
		return undefined;
	}
}
