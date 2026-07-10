import "@testing-library/jest-dom";

function createMemoryStorage(): Storage {
	const items = new Map<string, string>();

	return {
		get length() {
			return items.size;
		},
		clear: () => {
			items.clear();
		},
		getItem: (key: string) => items.get(key) ?? null,
		key: (index: number) => Array.from(items.keys())[index] ?? null,
		removeItem: (key: string) => {
			items.delete(key);
		},
		setItem: (key: string, value: string) => {
			items.set(key, value);
		},
	};
}

function ensureLocalStorage(): void {
	let storage: Storage;

	try {
		storage = window.localStorage;
	} catch {
		storage = createMemoryStorage();
	}

	if (!storage) {
		storage = createMemoryStorage();
	}

	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: storage,
	});

	Object.defineProperty(window, "localStorage", {
		configurable: true,
		value: storage,
	});
}

ensureLocalStorage();

const months = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

function formatDate(date: Date, pattern: string): string {
	const pad = (value: number) => value.toString().padStart(2, "0");
	const year = date.getUTCFullYear();
	const monthIndex = date.getUTCMonth();
	const day = date.getUTCDate();
	const hours = date.getUTCHours();
	const minutes = date.getUTCMinutes();
	const seconds = date.getUTCSeconds();

	return pattern
		.replace("YYYY", year.toString())
		.replace("MMMM", months[monthIndex])
		.replace("MM", pad(monthIndex + 1))
		.replace("DD", pad(day))
		.replace("HH", pad(hours))
		.replace("mm", pad(minutes))
		.replace("ss", pad(seconds));
}

function createMoment(dateInput?: Date | string | number) {
	let date =
		dateInput instanceof Date
			? new Date(dateInput)
			: dateInput
				? new Date(dateInput)
				: new Date();

	const api = {
		format: (pattern: string = "YYYY-MM-DD") => formatDate(date, pattern),
		startOf: (unit?: string) => {
			if (unit === "day") {
				date = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
			}

			return api;
		},
		seconds: (seconds: number) => {
			const updated = new Date(date);
			updated.setSeconds(seconds);
			updated.setMilliseconds(0);
			date = updated;
			return api;
		},
	};

	return api;
}

(window as unknown as { moment: typeof createMoment }).moment = createMoment;

// Obsidian exposes `activeWindow`/`activeDocument` globals that resolve to the
// currently focused (possibly popped-out) window/document. In jsdom there is a
// single window, so point them at the test globals for code that prefers them
// over the bare `window`/`document` for popout-window compatibility.
if (typeof (globalThis as { activeWindow?: unknown }).activeWindow === "undefined") {
	Object.defineProperty(globalThis, "activeWindow", {
		configurable: true,
		get: () => window,
	});
}
if (typeof (globalThis as { activeDocument?: unknown }).activeDocument === "undefined") {
	Object.defineProperty(globalThis, "activeDocument", {
		configurable: true,
		get: () => document,
	});
}

if (typeof IntersectionObserver === "undefined") {
	class MockIntersectionObserver implements IntersectionObserver {
		constructor(
			private callback: IntersectionObserverCallback,
			private _options?: IntersectionObserverInit,
		) {}

		readonly root: Element | Document | null = null;
		readonly rootMargin: string = this._options?.rootMargin ?? "0px";
		readonly scrollMargin: string = this._options?.scrollMargin ?? "0px";
		readonly thresholds: ReadonlyArray<number> = [0];

		disconnect(): void {}

		observe(target: Element): void {
			this.callback(
				[
					{
						isIntersecting: true,
						target,
						intersectionRatio: 1,
						boundingClientRect: target.getBoundingClientRect(),
						intersectionRect: target.getBoundingClientRect(),
						rootBounds: null,
						time: 0,
					} as IntersectionObserverEntry,
				],
				this,
			);
		}

		takeRecords(): IntersectionObserverEntry[] {
			return [];
		}

		unobserve(): void {}
	}

	(
		globalThis as unknown as { IntersectionObserver: typeof MockIntersectionObserver }
	).IntersectionObserver = MockIntersectionObserver;
}

if (!Element.prototype.scrollIntoView) {
	Element.prototype.scrollIntoView = () => {};
}

if (
	!(HTMLElement.prototype as unknown as { setAttr?: (name: string, value: string) => void })
		.setAttr
) {
	(
		HTMLElement.prototype as unknown as { setAttr: (name: string, value: string) => void }
	).setAttr = function (this: HTMLElement, name: string, value: string) {
		this.setAttribute(name, value);
	};
}

if (!(HTMLElement.prototype as unknown as { setText?: (text: string) => void }).setText) {
	(HTMLElement.prototype as unknown as { setText: (text: string) => void }).setText = function (
		this: HTMLElement,
		text: string,
	) {
		this.textContent = text;
	};
}

type ObsidianDomContainer = HTMLElement | DocumentFragment;
type CreateElOptions = { text?: string; cls?: string };

function installCreateEl(proto: object): void {
	const helpers = proto as {
		createEl?: (tag: keyof HTMLElementTagNameMap, options?: CreateElOptions) => HTMLElement;
		createDiv?: (options?: CreateElOptions) => HTMLDivElement;
	};

	if (!helpers.createEl) {
		helpers.createEl = function (
			this: ObsidianDomContainer,
			tag: keyof HTMLElementTagNameMap,
			options: CreateElOptions = {},
		) {
			const el = document.createElement(tag);
			if (options.text !== undefined) el.textContent = options.text;
			if (options.cls) el.className = options.cls;
			this.appendChild(el);
			return el;
		};
	}

	if (!helpers.createDiv) {
		helpers.createDiv = function (this: ObsidianDomContainer, options: CreateElOptions = {}) {
			const createEl = (
				this as ObsidianDomContainer & {
					createEl: (
						tag: keyof HTMLElementTagNameMap,
						options?: CreateElOptions,
					) => HTMLElement;
				}
			).createEl;
			return createEl.call(this, "div", options) as HTMLDivElement;
		};
	}
}

installCreateEl(HTMLElement.prototype);
installCreateEl(DocumentFragment.prototype);

if (!(HTMLElement.prototype as unknown as { empty?: () => void }).empty) {
	(HTMLElement.prototype as unknown as { empty: () => void }).empty = function (
		this: HTMLElement,
	) {
		while (this.firstChild) {
			this.removeChild(this.firstChild);
		}
	};
}

// Obsidian augments HTMLElement with setCssStyles (assigns a batch of inline
// styles, the sanctioned alternative to direct `el.style.x = y` writes). jsdom
// has no such method, so mirror Obsidian's behaviour for component/DOM tests.
if (!(HTMLElement.prototype as unknown as { setCssStyles?: unknown }).setCssStyles) {
	(
		HTMLElement.prototype as unknown as {
			setCssStyles: (styles: Partial<CSSStyleDeclaration>) => void;
		}
	).setCssStyles = function (this: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
		Object.assign(this.style, styles);
	};
}

// jsdom does not implement the Web Animations API, which Svelte 5 transitions
// (e.g. transition:fade) rely on. Provide a minimal mock so components that use
// transitions can be rendered and asserted on in component tests.
//
// Known fidelity gaps (acceptable for the current suite, which only renders
// CSS fade transitions): `onfinish` fires immediately on a microtask rather
// than after the real duration, `playState` is always "finished", and
// `finished` is pre-resolved and ignores `cancel()`. If a future test needs to
// assert mid-transition or outro-timing behaviour, replace this with a fuller
// fake (e.g. a timer-driven animation) instead of relying on these defaults.
if (!Element.prototype.animate) {
	(Element.prototype as unknown as { animate: () => Animation }).animate = function () {
		let onfinish: (() => void) | null = null;
		const animation = {
			cancel() {},
			finish() {},
			play() {},
			pause() {},
			reverse() {},
			currentTime: 0,
			startTime: 0,
			playbackRate: 1,
			playState: "finished",
			finished: Promise.resolve(),
			effect: null,
			addEventListener() {},
			removeEventListener() {},
			get onfinish() {
				return onfinish;
			},
			set onfinish(fn: (() => void) | null) {
				onfinish = fn;
				if (fn) {
					queueMicrotask(() => fn());
				}
			},
			oncancel: null,
		};

		return animation as unknown as Animation;
	};
}
