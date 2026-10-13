/** A window's ResizeObserver that reports only when a test resizes an element it observes. */
export interface FakeResizeObservers {
	resize(el: Element, width: number): void;
	/** How many observers watch `el` now. */
	watching(el: Element): number;
	uninstall(): void;
}

/** jsdom has no ResizeObserver. Installs one on `win` that the test drives. */
export function installResizeObserver(win: Window = window): FakeResizeObservers {
	const live = new Map<FakeResizeObserver, Set<Element>>();

	class FakeResizeObserver {
		constructor(private readonly callback: ResizeObserverCallback) {}

		observe(el: Element): void {
			live.set(this, (live.get(this) ?? new Set()).add(el));
		}

		unobserve(el: Element): void {
			live.get(this)?.delete(el);
		}

		disconnect(): void {
			live.delete(this);
		}

		report(el: Element, width: number): void {
			const entry = { target: el, contentRect: { width, height: 0 } } as ResizeObserverEntry;
			this.callback([entry], this as unknown as ResizeObserver);
		}
	}

	const target = win as unknown as { ResizeObserver?: unknown };
	const previous = target.ResizeObserver;
	target.ResizeObserver = FakeResizeObserver;

	return {
		resize(el, width) {
			for (const [observer, targets] of live) if (targets.has(el)) observer.report(el, width);
		},
		watching(el) {
			return [...live.values()].filter((targets) => targets.has(el)).length;
		},
		uninstall() {
			target.ResizeObserver = previous;
		},
	};
}
