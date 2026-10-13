// @vitest-environment jsdom
import { App } from "obsidian";
import { afterEach, expect, test } from "vitest";
import { installResizeObserver } from "../../../tests/mocks/resizeObserver";
import { observeStatusBar, observeWidth, statusBarInset } from "./layout";

const uninstalls: Array<() => void> = [];
afterEach(() => uninstalls.splice(0).forEach((uninstall) => uninstall()));

test("width keeps reporting after the view moves to a popout window", () => {
	const main = installResizeObserver(window);
	const popout = { document } as unknown as Window;
	const inPopout = installResizeObserver(popout);
	uninstalls.push(main.uninstall, inPopout.uninstall);
	const el = document.createElement("div");
	let migrate: (win: Window) => void = () => {};
	el.onWindowMigrated = (listener) => {
		migrate = listener;
		return () => {};
	};
	const widths: number[] = [];

	const detach = observeWidth((width) => widths.push(width))(el);
	main.resize(el, 320);
	migrate(popout);
	inPopout.resize(el, 820);

	expect(widths).toEqual([0, 320, 0, 820]);
	expect(main.watching(el)).toBe(0);
	expect(inPopout.watching(el)).toBe(1);
	if (typeof detach === "function") detach();
	expect(inPopout.watching(el)).toBe(0);
});

// The window is 1024 x 800. Obsidian's status bar, showing "9 properties", is 89.5 x 27
// in its bottom-right corner, or in its bottom-left one for a right-to-left language.
const BAR = { left: 934.5, right: 1024, top: 773, bottom: 800 };
const RTL_BAR = { left: 0, right: 89.5, top: 773, bottom: 800 };
const RIGHT_SIDEBAR = { left: 724, right: 1024, top: 40, bottom: 800 };
const LEFT_SIDEBAR = { left: 44, right: 324, top: 40, bottom: 800 };

test("the status bar reaches its height into a view under the window's bottom corner", () => {
	expect(statusBarInset(RIGHT_SIDEBAR, BAR)).toBe(27);
	expect(statusBarInset({ ...LEFT_SIDEBAR, left: 0 }, RTL_BAR)).toBe(27);
});

test("a view beside the status bar, or above it, gets no inset", () => {
	expect(statusBarInset(LEFT_SIDEBAR, BAR)).toBe(0);
	expect(statusBarInset(RIGHT_SIDEBAR, RTL_BAR)).toBe(0);
	// A theme that puts the bar in flow, below the workspace.
	expect(statusBarInset({ ...RIGHT_SIDEBAR, bottom: 773 }, { ...BAR, left: 0 })).toBe(0);
});

test("a hidden status bar, as on mobile, gets no inset", () => {
	expect(statusBarInset(RIGHT_SIDEBAR, { left: 0, right: 0, top: 0, bottom: 0 })).toBe(0);
});

test("the inset follows the view when the workspace moves it without resizing it", () => {
	const observers = installResizeObserver(window);
	uninstalls.push(observers.uninstall);
	const bar = document.body.appendChild(document.createElement("div"));
	bar.className = "status-bar";
	const el = document.body.appendChild(document.createElement("div"));
	uninstalls.push(() => {
		bar.remove();
		el.remove();
	});
	const LEFT_PANE = { left: 44, right: 534, top: 40, bottom: 800 };
	const RIGHT_PANE = { left: 534, right: 1024, top: 40, bottom: 800 };
	// A collapsed right sidebar holds the view beyond the window's right edge.
	const CLOSED_SIDEBAR = { ...RIGHT_SIDEBAR, left: 1024, right: 1324 };
	let at = LEFT_PANE;
	el.getBoundingClientRect = () => at as DOMRect;
	bar.getBoundingClientRect = () => BAR as DOMRect;
	const { workspace } = new App();
	const insets: number[] = [];

	const detach = observeStatusBar((inset) => insets.push(inset), workspace)(el);
	// Obsidian resizes the workspace once the leaf is in its new pane of the same size,
	at = RIGHT_PANE;
	workspace.trigger("resize");
	at = CLOSED_SIDEBAR;
	workspace.trigger("resize");
	// and once a sidebar has slid open.
	at = RIGHT_SIDEBAR;
	workspace.trigger("resize");
	if (typeof detach === "function") detach();
	workspace.trigger("resize");

	expect(insets).toEqual([0, 27, 0, 27]);
});
