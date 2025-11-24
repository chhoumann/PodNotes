import type { Chapter, ChaptersData } from "src/types/Chapter";
import { requestWithTimeout } from "./networkRequest";

/**
 * Fetches and parses podcast chapters from a chapters URL.
 * Returns an empty array if the URL is invalid or the request fails.
 */
export async function fetchChapters(chaptersUrl: string): Promise<Chapter[]> {
    if (!chaptersUrl) {
        return [];
    }

    try {
        const response = await requestWithTimeout(chaptersUrl, { timeoutMs: 10000 });
        const data: ChaptersData = JSON.parse(response.text);

        if (!data.chapters || !Array.isArray(data.chapters)) {
            return [];
        }

        // Filter out hidden chapters (toc === false) and sort by start time
        return data.chapters
            .filter((chapter) => chapter.toc !== false)
            .sort((a, b) => a.startTime - b.startTime);
    } catch (error) {
        console.warn("Failed to fetch chapters:", error);
        return [];
    }
}
