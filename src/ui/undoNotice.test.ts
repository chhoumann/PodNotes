// @vitest-environment jsdom
import * as obsidian from "obsidian";
import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { dismissUndoNotices, noticeWithUndo } from "./undoNotice";

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

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

test("builds its message in the main window, as Obsidian's Notice needs also with a popout focused", () => {
	const frame = document.body.appendChild(document.createElement("iframe"));
	const popout = frame.contentWindow as Window & typeof globalThis;
	// Obsidian gives a popout's nodes its DOM helpers too.
	const { createEl, createSpan } = DocumentFragment.prototype;
	Object.assign(popout.DocumentFragment.prototype, { createEl, createSpan });
	vi.stubGlobal("activeDocument", popout.document);
	onTestFinished(() => {
		vi.unstubAllGlobals();
		frame.remove();
	});
	const notice = vi.spyOn(obsidian, "Notice");

	noticeWithUndo("Timestamp added to Draft", () => {});

	// Obsidian shows any other message as its String().
	expect(notice.mock.calls[0][0]).toBeInstanceOf(DocumentFragment);
});

test("stops checking on a notice left in the document of a popout that closed", () => {
	vi.useFakeTimers();
	const notice = vi.spyOn(obsidian, "Notice");
	noticeWithUndo("Timestamp added to Draft", () => {});
	// A closed popout's document has no window, and still holds the notice.
	const closed = document.implementation.createHTMLDocument();
	closed.body.append(notice.mock.calls[0][0] as DocumentFragment);

	vi.advanceTimersByTime(9000);

	expect(vi.getTimerCount()).toBe(0);
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

test("dismissing hides each Undo notice still up, also one the pointer keeps past its seven seconds, and its Undo then does nothing", () => {
	vi.useFakeTimers();
	const notice = vi.spyOn(obsidian, "Notice");
	const undo = vi.fn();
	noticeWithUndo("Removed The Show", undo);
	noticeWithUndo("Deleted Walks", undo);
	const [[kept]] = notice.mock.calls;
	// Obsidian still shows the first notice, as it does while the pointer rests on it.
	const shownEl = document.body.appendChild(document.createElement("div"));
	shownEl.append(kept as DocumentFragment);
	vi.advanceTimersByTime(9000);

	dismissUndoNotices();
	shownEl.querySelector("button")!.click();
	shownEl.remove();

	expect(undo).not.toHaveBeenCalled();
	expect(
		notice.mock.instances.map((shown) => (shown as unknown as { hidden: boolean }).hidden),
	).toEqual([true, false]);
});
