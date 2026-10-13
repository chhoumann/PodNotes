// @vitest-environment jsdom
import * as obsidian from "obsidian";
import { afterEach, expect, test, vi } from "vitest";
import { noticeWithUndo } from "./undoNotice";

afterEach(() => vi.restoreAllMocks());

function shown() {
	const notice = vi.spyOn(obsidian, "Notice");
	return () => {
		const [[message, duration]] = notice.mock.calls;
		const fragment = message as DocumentFragment;
		return {
			text: fragment.textContent,
			duration,
			button: fragment.querySelector("button")!,
			hidden: (notice.mock.instances[0] as unknown as { hidden: boolean }).hidden,
		};
	};
}

test("says what happened, with an Undo button, for seven seconds", () => {
	const read = shown();

	noticeWithUndo("Removed <b>The Show</b>", () => {});

	expect(read()).toMatchObject({ text: "Removed <b>The Show</b>Undo", duration: 7000 });
	expect(read().button).toHaveTextContent("Undo");
});

test("Undo runs once and hides the notice", () => {
	const read = shown();
	const undo = vi.fn();
	noticeWithUndo("Queue cleared", undo);

	read().button.click();
	read().button.click();

	expect(undo).toHaveBeenCalledTimes(1);
	expect(read().hidden).toBe(true);
});
