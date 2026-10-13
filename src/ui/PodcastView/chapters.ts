import type { Chapter } from "src/types/Chapter";
import { fetchChapters } from "src/utility/fetchChapters";

/** The chapter under way at `time`: the last to start at or before it. -1 before the first. */
export function chapterAt(chapters: readonly Chapter[], time: number): number {
	let at = -1;
	for (const [index, chapter] of chapters.entries()) if (chapter.startTime <= time) at = index;
	return at;
}

/**
 * The scrubber's stretches, in seconds, between the chapter starts inside the episode.
 * Unsorted or repeated starts make no empty or backward stretch.
 */
export function segmentsOf(chapters: readonly Chapter[], duration: number): [number, number][] {
	const starts = [
		...new Set(chapters.map((c) => c.startTime).filter((t) => t > 0 && t < duration)),
	].sort((a, b) => a - b);
	const bounds = [0, ...starts, Math.max(0, duration)];
	return bounds.slice(1).map((end, index) => [bounds[index], end]);
}

let last: { url: string; chapters: Promise<Chapter[]> } | undefined;

/** The chapters at `url`. The last one stays loaded, so reopening the player fetches nothing. */
export function loadChapters(url: string): Promise<Chapter[]> {
	if (last?.url !== url) last = { url, chapters: fetchChapters(url) };
	return last.chapters;
}
