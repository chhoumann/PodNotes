import { fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { QUEUE_SETTINGS } from "src/constants";
import { queue } from "src/store";
import type { Episode } from "src/types/Episode";
import ReorderQueue from "./ReorderQueue.svelte";

function ep(title: string, podcastName = "Pod"): Episode {
	return {
		title,
		streamUrl: `https://example.com/${title}.mp3`,
		url: `https://example.com/${title}`,
		description: "",
		content: "",
		podcastName,
	};
}

function seed(...titles: string[]) {
	queue.set({ ...QUEUE_SETTINGS, episodes: titles.map((t) => ep(t)) });
}

function titles(): string[] {
	return get(queue).episodes.map((e) => e.title);
}

describe("ReorderQueue", () => {
	beforeEach(() => {
		queue.set({ ...QUEUE_SETTINGS, episodes: [] });
	});

	test("lists the queued episodes in order with 1-based positions", () => {
		seed("A", "B", "C");
		const { container } = render(ReorderQueue);

		const renderedTitles = Array.from(container.querySelectorAll(".queue-reorder-title")).map(
			(el) => el.textContent,
		);
		expect(renderedTitles).toEqual(["A", "B", "C"]);

		const positions = Array.from(container.querySelectorAll(".queue-reorder-position")).map(
			(el) => el.textContent,
		);
		expect(positions).toEqual(["1", "2", "3"]);
	});

	test("moving an episode up updates the queue order", async () => {
		seed("A", "B", "C");
		const { getAllByLabelText } = render(ReorderQueue);

		// Second row ("B") -> move up.
		await fireEvent.click(getAllByLabelText("Move up")[1]);

		expect(titles()).toEqual(["B", "A", "C"]);
	});

	test("moving a middle episode to the top updates the queue order", async () => {
		seed("A", "B", "C");
		const { getAllByLabelText } = render(ReorderQueue);

		// Second row ("B") -> move to top.
		await fireEvent.click(getAllByLabelText("Move to top")[1]);

		expect(titles()).toEqual(["B", "A", "C"]);
	});

	test("moving the first episode down updates the queue order", async () => {
		seed("A", "B", "C");
		const { getAllByLabelText } = render(ReorderQueue);

		// First row ("A") -> move down.
		await fireEvent.click(getAllByLabelText("Move down")[0]);

		expect(titles()).toEqual(["B", "A", "C"]);
	});

	test("moving an episode to the bottom updates the queue order", async () => {
		seed("A", "B", "C");
		const { getAllByLabelText } = render(ReorderQueue);

		// First row ("A") -> move to bottom.
		await fireEvent.click(getAllByLabelText("Move to bottom")[0]);

		expect(titles()).toEqual(["B", "C", "A"]);
	});

	test("the first episode's upward controls are disabled and inert", async () => {
		seed("A", "B", "C");
		const { getAllByLabelText } = render(ReorderQueue);

		const firstMoveUp = getAllByLabelText("Move up")[0] as HTMLButtonElement;
		const firstMoveToTop = getAllByLabelText("Move to top")[0] as HTMLButtonElement;
		expect(firstMoveUp).toBeDisabled();
		expect(firstMoveToTop).toBeDisabled();

		await fireEvent.click(firstMoveUp);
		await fireEvent.click(firstMoveToTop);
		expect(titles()).toEqual(["A", "B", "C"]);
	});

	test("the last episode's downward controls are disabled and inert", async () => {
		seed("A", "B", "C");
		const { getAllByLabelText } = render(ReorderQueue);

		const lastMoveDown = getAllByLabelText("Move down")[2] as HTMLButtonElement;
		const lastMoveToBottom = getAllByLabelText("Move to bottom")[2] as HTMLButtonElement;
		expect(lastMoveDown).toBeDisabled();
		expect(lastMoveToBottom).toBeDisabled();

		await fireEvent.click(lastMoveDown);
		await fireEvent.click(lastMoveToBottom);
		expect(titles()).toEqual(["A", "B", "C"]);
	});

	test("clicking Done invokes the close callback", async () => {
		seed("A", "B");
		const close = vi.fn();
		const { getByText } = render(ReorderQueue, { props: { close } });

		await fireEvent.click(getByText("Done"));
		expect(close).toHaveBeenCalledTimes(1);
	});

	test("removing an episode drops it from the queue", async () => {
		seed("A", "B", "C");
		const { getAllByLabelText } = render(ReorderQueue);

		await fireEvent.click(getAllByLabelText("Remove from queue")[1]);

		expect(titles()).toEqual(["A", "C"]);
	});

	test("shows an empty state when the queue is empty", () => {
		const { getByText } = render(ReorderQueue);
		expect(getByText("Your queue is empty.")).toBeInTheDocument();
	});
});
