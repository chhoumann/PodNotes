import type { Chapter, ChaptersData } from "src/types/Chapter";
import { requestWithTimeout } from "./networkRequest";
import { normalizeChapters } from "./normalizeChapters";

const MAX_CHAPTERS_RESPONSE_CHARS = 1_000_000;

/**
 * Fetches and parses podcast chapters from a chapters URL.
 * Returns an empty array if the URL is invalid or the request fails.
 */
export async function fetchChapters(chaptersUrl: string): Promise<Chapter[]> {
	if (!chaptersUrl || !isSupportedChaptersUrl(chaptersUrl)) {
		return [];
	}

	try {
		const response = await requestWithTimeout(chaptersUrl, { timeoutMs: 10000 });
		if (response.text.length > MAX_CHAPTERS_RESPONSE_CHARS) {
			return [];
		}

		const data: ChaptersData = JSON.parse(response.text);

		if (!data.chapters || !Array.isArray(data.chapters)) {
			return [];
		}

		return normalizeChapters(data.chapters);
	} catch {
		console.warn("Failed to fetch chapters.");
		return [];
	}
}

function isSupportedChaptersUrl(chaptersUrl: string): boolean {
	try {
		const url = new URL(chaptersUrl);
		return url.protocol === "https:" || url.protocol === "http:";
	} catch {
		return false;
	}
}
