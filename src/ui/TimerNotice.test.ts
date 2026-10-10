// @vitest-environment jsdom
import { Notice } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimerNotice } from "./TimerNotice";

describe("TimerNotice", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("prefixes each message with the heading and the elapsed time", () => {
		const setMessage = vi.spyOn(Notice.prototype, "setMessage");
		const notice = TimerNotice("Importing podcasts", "Preparing to import...");

		vi.advanceTimersByTime(3_661_000);
		notice.update("Importing... 1/2");

		expect(setMessage).toHaveBeenLastCalledWith(
			"Importing podcasts (01:01:01):\n\nImporting... 1/2",
		);
		notice.dispose();
	});

	it("freezes the elapsed time and stops ticking once stopped", () => {
		const setMessage = vi.spyOn(Notice.prototype, "setMessage");
		const notice = TimerNotice("Transcription", "Preparing to transcribe...");

		vi.advanceTimersByTime(5_000);
		notice.stop();
		const callsAtStop = setMessage.mock.calls.length;
		vi.advanceTimersByTime(60_000);

		expect(setMessage).toHaveBeenCalledTimes(callsAtStop);
		notice.update("Done");
		expect(setMessage).toHaveBeenLastCalledWith("Transcription (00:00:05):\n\nDone");
		notice.dispose();
	});

	it("hides after the scheduled delay and leaves no timer running", () => {
		const hide = vi.spyOn(Notice.prototype, "hide");
		const onHide = vi.fn();
		const notice = TimerNotice("Transcription", "Saved");

		notice.scheduleHide(5_000, onHide);
		vi.advanceTimersByTime(4_999);
		expect(hide).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);

		expect(hide).toHaveBeenCalledTimes(1);
		expect(onHide).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("hides at once on dispose and cancels a pending hide", () => {
		const hide = vi.spyOn(Notice.prototype, "hide");
		const onHide = vi.fn();
		const notice = TimerNotice("Transcription", "Saved");

		notice.scheduleHide(5_000, onHide);
		notice.dispose();

		expect(hide).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
		vi.advanceTimersByTime(5_000);
		expect(onHide).not.toHaveBeenCalled();
	});
});
