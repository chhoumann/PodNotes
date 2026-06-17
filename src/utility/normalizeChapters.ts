import type { Chapter } from "src/types/Chapter";

const MAX_VISIBLE_CHAPTERS = 500;
const MAX_CHAPTER_TITLE_CHARS = 500;

export function normalizeChapters(chapters: readonly unknown[]): Chapter[] {
	return chapters
		.filter(isVisibleChapter)
		.map((chapter) => ({
			...chapter,
			title:
				typeof chapter.title === "string"
					? chapter.title.slice(0, MAX_CHAPTER_TITLE_CHARS)
					: "",
		}))
		.sort((a, b) => a.startTime - b.startTime)
		.slice(0, MAX_VISIBLE_CHAPTERS);
}

function isVisibleChapter(
	chapter: unknown,
): chapter is Omit<Chapter, "title"> & { title?: string } {
	if (!chapter || typeof chapter !== "object") {
		return false;
	}

	const candidate = chapter as Partial<Chapter>;
	return (
		candidate.toc !== false &&
		(candidate.title === undefined || typeof candidate.title === "string") &&
		Number.isFinite(candidate.startTime)
	);
}
