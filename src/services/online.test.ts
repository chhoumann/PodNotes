// @vitest-environment jsdom
import { get } from "svelte/store";
import { afterEach, expect, test, vi } from "vitest";
import { onlineStatus } from "./online";

afterEach(() => vi.restoreAllMocks());

function goOnline(online: boolean) {
	vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
	window.dispatchEvent(new Event(online ? "online" : "offline"));
}

test("starts from what the navigator says, and follows the online and offline events", () => {
	vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
	const status = onlineStatus(window);
	const seen: boolean[] = [];
	const stop = status.subscribe((online) => seen.push(online));

	goOnline(true);
	goOnline(false);
	stop();

	expect(seen).toEqual([false, true, false]);
});

test("reads the navigator again when asked with nothing subscribed", () => {
	const status = onlineStatus(window);

	vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
	expect(get(status)).toBe(false);
	vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
	expect(get(status)).toBe(true);
});

test("stops listening once nothing subscribes", () => {
	const added = vi.spyOn(window, "addEventListener");
	const removed = vi.spyOn(window, "removeEventListener");
	const stop = onlineStatus(window).subscribe(() => {});

	stop();

	const listeners = (spy: typeof added) =>
		spy.mock.calls.filter(([type]) => type === "online" || type === "offline");
	expect(listeners(added)).toHaveLength(2);
	expect(listeners(removed)).toEqual(listeners(added));
});
