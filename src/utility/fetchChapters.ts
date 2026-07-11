import type { Chapter, ChaptersData } from "src/types/Chapter";
import { fetchTextWithTimeout } from "./networkRequest";
import { normalizeChapters } from "./normalizeChapters";

const MAX_CHAPTERS_RESPONSE_CHARS = 1_000_000;
const MAX_CHAPTERS_RESPONSE_BYTES = MAX_CHAPTERS_RESPONSE_CHARS * 4;
const CHAPTERS_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Fetches and parses podcast chapters from a chapters URL.
 * Returns an empty array if the URL is invalid or the request fails.
 */
export async function fetchChapters(chaptersUrl: string): Promise<Chapter[]> {
	if (!chaptersUrl) {
		return [];
	}

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

		if (!data.chapters || !Array.isArray(data.chapters)) {
			return [];
		}

		return normalizeChapters(data.chapters);
	} catch {
		console.warn("Failed to fetch chapters.");
		return [];
	}
}
