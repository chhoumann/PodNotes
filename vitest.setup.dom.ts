import "@testing-library/jest-dom/vitest";

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

// Obsidian exposes an `activeDocument` global that resolves to the currently
// focused (possibly popped-out) document. In jsdom there is a single document,
// so point it at the test global for code that prefers it over the bare
// `document` for popout-window compatibility.
if (typeof (globalThis as { activeDocument?: unknown }).activeDocument === "undefined") {
	Object.defineProperty(globalThis, "activeDocument", {
		configurable: true,
		get: () => document,
	});
}

if (!Element.prototype.scrollIntoView) {
	Element.prototype.scrollIntoView = () => {};
}

if (!(Element.prototype as unknown as { instanceOf?: unknown }).instanceOf) {
	(
		Element.prototype as unknown as {
			instanceOf: (constructor: typeof Element) => boolean;
		}
	).instanceOf = function (this: Element, constructor: typeof Element): boolean {
		const localConstructor = this.ownerDocument.defaultView?.[
			constructor.name as keyof Window
		] as unknown;
		const elementConstructor =
			typeof localConstructor === "function" ? localConstructor : constructor;
		return this instanceof elementConstructor;
	};
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
		createSpan?: (options?: CreateElOptions) => HTMLSpanElement;
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

	if (!helpers.createSpan) {
		helpers.createSpan = function (this: ObsidianDomContainer, options: CreateElOptions = {}) {
			const createEl = (
				this as ObsidianDomContainer & {
					createEl: (
						tag: keyof HTMLElementTagNameMap,
						options?: CreateElOptions,
					) => HTMLElement;
				}
			).createEl;
			return createEl.call(this, "span", options) as HTMLSpanElement;
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
