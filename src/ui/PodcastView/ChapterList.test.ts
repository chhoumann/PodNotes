import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";

import type { Chapter } from "src/types/Chapter";
import ChapterList from "./ChapterList.svelte";

const chapters: Chapter[] = [
	{ title: "Intro", startTime: 0 },
	{ title: "Main topic", startTime: 60 },
	{ title: "Wrap up", startTime: 120 },
];

function activeIndex(container: HTMLElement): number {
	const items = Array.from(container.querySelectorAll(".chapters li"));
	return items.findIndex((li) => li.classList.contains("active"));
}

describe("ChapterList", () => {
	test("highlights the chapter containing the initial currentTime", () => {
		const { container } = render(ChapterList, {
			props: { chapters, currentTime: 75 },
		});

		expect(activeIndex(container)).toBe(1);
	});

	test("moves the highlight as currentTime advances (CH-05)", async () => {
		const { container, rerender } = render(ChapterList, {
			props: { chapters, currentTime: 10 },
		});

		expect(activeIndex(container)).toBe(0);

		await rerender({ chapters, currentTime: 65 });
		expect(activeIndex(container)).toBe(1);

		await rerender({ chapters, currentTime: 130 });
		expect(activeIndex(container)).toBe(2);
	});

	test("no chapter is active before the first chapter's startTime", () => {
		const before: Chapter[] = [{ title: "Late start", startTime: 30 }];
		const { container } = render(ChapterList, {
			props: { chapters: before, currentTime: 10 },
		});

		expect(activeIndex(container)).toBe(-1);
	});

	test("clicking a chapter dispatches a seek and the highlight follows the resulting currentTime (CH-06)", async () => {
		const seek = vi.fn();
		const { container, rerender } = render(ChapterList, {
			props: { chapters, currentTime: 0 },
			events: { seek },
		});

		expect(activeIndex(container)).toBe(0);

		const buttons = container.querySelectorAll(".chapter-item");
		await fireEvent.click(buttons[2]);

		expect(seek).toHaveBeenCalledTimes(1);
		expect(seek.mock.calls[0][0].detail).toEqual({ time: 120 });

		// The parent seeks; reflecting that back as currentTime must move the
		// highlight onto the clicked chapter.
		await rerender({ chapters, currentTime: 120 });
		expect(activeIndex(container)).toBe(2);
	});

	test("exposes aria-controls / list id and per-chapter seek labels (CH-04)", () => {
		const { container } = render(ChapterList, {
			props: { chapters, currentTime: 0 },
		});

		const header = container.querySelector(".chapter-header") as HTMLButtonElement;
		const list = container.querySelector(".chapters") as HTMLUListElement;

		expect(list.id).toBeTruthy();
		expect(header.getAttribute("aria-controls")).toBe(list.id);

		const labels = Array.from(container.querySelectorAll(".chapter-item")).map((b) =>
			b.getAttribute("aria-label"),
		);
		expect(labels).toEqual(["Jump to Intro", "Jump to Main topic", "Jump to Wrap up"]);
	});
});
