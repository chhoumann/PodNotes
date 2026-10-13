import type { Workspace } from "obsidian";
import type { Attachment } from "svelte/attachments";

export type Layout = "compact" | "wide";

type ObservableWindow = Window & { ResizeObserver: typeof ResizeObserver };

/** Below this view width the shell is compact (a page stack); from it on, wide (a rail). */
export const COMPACT_MAX_WIDTH = 560;

export function layoutFor(width: number): Layout {
	return width < COMPACT_MAX_WIDTH ? "compact" : "wide";
}

/**
 * Reports the element's width now and on every resize. The observer comes from
 * the element's own window and is made again when Obsidian moves the element to
 * a popout: an observer from another window stops reporting there.
 */
export function observeWidth(onWidth: (width: number) => void): Attachment<HTMLElement> {
	return (el) => {
		let observer: ResizeObserver | undefined;
		const observe = (win: Window) => {
			observer?.disconnect();
			observer = new (win as ObservableWindow).ResizeObserver(([entry]) =>
				onWidth(entry.contentRect.width),
			);
			observer.observe(el);
			onWidth(el.clientWidth);
		};
		observe(el.win);
		const stopFollowing = el.onWindowMigrated(observe);
		return () => {
			stopFollowing();
			observer?.disconnect();
		};
	};
}

type Box = Pick<DOMRectReadOnly, "top" | "bottom" | "left" | "right">;

/** How far a status bar at `bar` reaches up into a view at `view`: 0 when it is hidden or clear of the view. */
export function statusBarInset(view: Box, bar: Box): number {
	const overlaps =
		bar.left < view.right &&
		bar.right > view.left &&
		bar.top < view.bottom &&
		bar.bottom > view.top;
	return overlaps ? view.bottom - bar.top : 0;
}

/**
 * Reports how far Obsidian's status bar reaches up into the element, now, whenever
 * either of them resizes, as the bar's items come and go, and whenever Obsidian
 * resizes the workspace, which can move the view without resizing it: to a pane of
 * the same size, or as its sidebar slides open. The bar floats over the bottom of the
 * window, so it covers the bottom of a view beneath it. Like `observeWidth`, it
 * follows the element to a popout.
 */
export function observeStatusBar(
	onInset: (inset: number) => void,
	workspace: Workspace,
): Attachment<HTMLElement> {
	return (el) => {
		const bar = () => el.doc.querySelector(".status-bar");
		const report = () => {
			const shown = bar();
			// A popout window has no status bar.
			onInset(
				shown
					? statusBarInset(el.getBoundingClientRect(), shown.getBoundingClientRect())
					: 0,
			);
		};
		let observer: ResizeObserver | undefined;
		const observe = (win: Window) => {
			observer?.disconnect();
			observer = new (win as ObservableWindow).ResizeObserver(report);
			observer.observe(el);
			const shown = bar();
			if (shown) observer.observe(shown);
			report();
		};
		observe(el.win);
		const stopFollowing = el.onWindowMigrated(observe);
		const moved = workspace.on("resize", report);
		return () => {
			stopFollowing();
			observer?.disconnect();
			workspace.offref(moved);
		};
	};
}

/**
 * Scrolls a page's scroller to where the page opens. It reads once, when the
 * page mounts, so opening or closing the full player never moves the page.
 */
export function restoreScroll(read: () => number): Attachment<HTMLElement> {
	return (el) => {
		el.scrollTop = read();
	};
}
