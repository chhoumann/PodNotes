import type { Chapter } from "src/types/Chapter";
import { chaptersKey, fetchChapters, type ChaptersSource } from "src/utility/fetchChapters";

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

const loaded = new Map<string, Chapter[]>();

export function cachedChapters(episode: ChaptersSource): Chapter[] | undefined {
	return loaded.get(chaptersKey(episode));
}

/** The episode's chapters. A failed load, as offline, is not kept, so the next one fetches again. */
export async function loadChapters(episode: ChaptersSource): Promise<Chapter[]> {
	const cached = cachedChapters(episode);
	if (cached) return cached;
	const chapters = await fetchChapters(episode);
	if (chapters) loaded.set(chaptersKey(episode), chapters);
	return chapters ?? [];
}
