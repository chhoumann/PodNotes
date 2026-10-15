import { vi } from "vitest";

/**
 * Lays a player panel's list out as the browser would: `height` px tall, with Panel's faded
 * edges, 12 px at the top and 20 px at the bottom, as its scroll padding, and each row 40 px
 * tall or as `tall` sets it by index. Its scroll position stays within the rows, and a change
 * to it fires `scroll` soon after. Returns a resize to `height`, which clamps the scroll
 * position to the rows left.
 */
export function layOut(
	list: HTMLElement,
	{ height = 120, tall = {} }: { height?: number; tall?: Record<number, number> } = {},
): (height: number) => void {
	let top = 0;
	const rowHeight = (index: number) => tall[index] ?? 40;
	const rowTop = (index: number) =>
		Array.from({ length: index }, (_, at) => rowHeight(at)).reduce((sum, h) => sum + h, 0);
	const scrollTo = (value: number) => {
		const next = Math.max(0, Math.min(value, list.scrollHeight - height));
		if (next === top) return;
		top = next;
		queueMicrotask(() => list.dispatchEvent(new Event("scroll")));
	};
	list.style.setProperty("scroll-padding-top", "12px");
	list.style.setProperty("scroll-padding-bottom", "20px");
	Object.defineProperties(list, {
		clientHeight: { configurable: true, get: () => height },
		scrollHeight: { configurable: true, get: () => rowTop(list.children.length) },
		scrollTop: { configurable: true, get: () => top, set: scrollTo },
	});
	vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
		this: Element,
	) {
		const index = [...list.children].indexOf(this);
		const y = this === list ? 0 : rowTop(index) - top;
		const h = this === list ? height : rowHeight(index);
		return { top: y, bottom: y + h, height: h, left: 0, right: 300 } as DOMRect;
	});
	return (to) => {
		height = to;
		scrollTo(top);
	};
}

/** Where the row marked current starts, from the top of its list. */
export function currentRowTop(list: HTMLElement): number {
	const row = list.querySelector('[aria-current="true"]')!.closest("li")!;
	return row.getBoundingClientRect().top - list.getBoundingClientRect().top;
}
