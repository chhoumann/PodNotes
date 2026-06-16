import type { Chapter } from "src/types/Chapter";

const MAX_VISIBLE_CHAPTERS = 500;
const MAX_CHAPTER_TITLE_CHARS = 500;

export function normalizeChapters(chapters: readonly unknown[]): Chapter[] {
	return chapters
		.filter(isVisibleChapter)
		.map((chapter) => ({
			...chapter,
			title: chapter.title.slice(0, MAX_CHAPTER_TITLE_CHARS),
		}))
		.filter((chapter) => chapter.title.trim().length > 0)
		.sort((a, b) => a.startTime - b.startTime)
		.slice(0, MAX_VISIBLE_CHAPTERS);
}

function isVisibleChapter(chapter: unknown): chapter is Chapter {
	if (!chapter || typeof chapter !== "object") {
		return false;
	}

	const candidate = chapter as Partial<Chapter>;
	return (
		candidate.toc !== false &&
		typeof candidate.title === "string" &&
		Number.isFinite(candidate.startTime)
	);
}
