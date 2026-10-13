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
 * Reports how far Obsidian's status bar reaches up into the element, now and
 * whenever either of them resizes, as the bar's items come and go. The bar
 * floats over the bottom of the window, so it covers the bottom of a view
 * beneath it. Like `observeWidth`, it follows the element to a popout.
 */
export function observeStatusBar(onInset: (inset: number) => void): Attachment<HTMLElement> {
	return (el) => {
		let observer: ResizeObserver | undefined;
		const observe = (win: Window) => {
			observer?.disconnect();
			// A popout window has no status bar.
			const bar = el.doc.querySelector(".status-bar");
			if (!bar) return onInset(0);
			const report = () =>
				onInset(statusBarInset(el.getBoundingClientRect(), bar.getBoundingClientRect()));
			observer = new (win as ObservableWindow).ResizeObserver(report);
			observer.observe(el);
			observer.observe(bar);
			report();
		};
		observe(el.win);
		const stopFollowing = el.onWindowMigrated(observe);
		return () => {
			stopFollowing();
			observer?.disconnect();
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
