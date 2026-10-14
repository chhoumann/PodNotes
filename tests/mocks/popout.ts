import { onTestFinished, vi } from "vitest";
import { installResizeObserver } from "./resizeObserver";

export interface FakePopout {
	readonly win: Window;
	/** Moves `el` into the popout as Obsidian moves a leaf, telling the listeners in it. */
	moveIn(el: HTMLElement): void;
	/** Makes the popout the active window, as Obsidian does when it gets focus. */
	focus(): void;
}

/**
 * A second window, as Obsidian's popout, for elements that follow `onWindowMigrated`.
 * It closes when the test ends.
 */
export function openPopout(): FakePopout {
	const frame = document.body.appendChild(document.createElement("iframe"));
	const win = frame.contentWindow!;
	const widths = installResizeObserver(win);
	const listeners = new Map<HTMLElement, Set<(win: Window) => unknown>>();
	const migrated = vi
		.spyOn(HTMLElement.prototype, "onWindowMigrated")
		.mockImplementation(function (this: HTMLElement, listener) {
			const own = listeners.get(this) ?? new Set();
			listeners.set(this, own.add(listener));
			return () => own.delete(listener);
		});

	onTestFinished(() => {
		activeWindow = window;
		migrated.mockRestore();
		widths.uninstall();
		frame.remove();
	});

	return {
		win,
		moveIn(el) {
			win.document.body.appendChild(el);
			for (const [target, own] of listeners) {
				if (el.contains(target)) for (const listener of own) listener(win);
			}
		},
		focus() {
			activeWindow = win;
		},
	};
}
