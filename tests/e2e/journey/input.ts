import type { ObsidianClient } from "obsidian-e2e";
import { ui, type UiTarget } from "./targets";
import { pageScrollTop } from "./wait";

type Located =
	| { state: "ready"; x: number; y: number; height: number }
	| { state: "behind notice"; detail: string; keyring: boolean }
	| { state: "absent" | "hidden" | "ambiguous" | "covered"; detail: string };

async function locate(obsidian: ObsidianClient, target: UiTarget): Promise<Located> {
	return await obsidian.dev.evalJson<Located>(`(() => {
		const all = (${target.elements});
		const visible = all.filter((el) => el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden");
		if (visible.length === 0) return { state: all.length ? "hidden" : "absent", detail: String(all.length) };
		if (visible.length > 1) return { state: "ambiguous", detail: String(visible.length) };
		const el = visible[0];
		el.scrollIntoView({ block: "nearest", inline: "nearest" });
		const rect = el.getBoundingClientRect();
		const x = rect.left + rect.width / 2;
		const y = rect.top + rect.height / 2;
		const hit = document.elementFromPoint(x, y);
		const notice = hit?.closest(".notice");
		if (notice?.dataset.podnotesE2ePersistent === "true" && !el.contains(hit))
			return { state: "behind notice", detail: (notice.querySelector(".notice-message") ?? notice).textContent.trim(), keyring: notice.dataset.podnotesE2eKeyring === "true" };
		if (!hit || !el.contains(hit)) return { state: "covered", detail: hit ? hit.outerHTML.slice(0, 120) : "nothing" };
		return { state: "ready", x, y, height: rect.height };
	})()`);
}

async function settledPoint(
	obsidian: ObsidianClient,
	target: UiTarget,
	timeoutMs = 10_000,
): Promise<{ x: number; y: number; height: number }> {
	let previous = "";
	let last = "";
	let coveringNotice: string | undefined;
	const point = await obsidian
		.waitFor(
			async () => {
				const sample = await locate(obsidian, target);
				coveringNotice = sample.state === "behind notice" ? sample.detail : undefined;
				if (sample.state === "behind notice" && sample.keyring) return sample;
				const key = JSON.stringify(sample);
				const settled = sample.state === "ready" && key === last;
				previous = last;
				last = key;
				return settled ? sample : false;
			},
			{ timeoutMs, intervalMs: 100, message: `${target.name} visible and still` },
		)
		.catch((error: Error) => {
			error.message += coveringNotice
				? ` ${target.name} is covered by a Notice: "${coveringNotice}".`
				: ` Last samples: ${previous}, ${last}.`;
			throw error;
		});
	if (point.state !== "ready")
		throw new Error(
			`${target.name} is behind Obsidian's persistent keyring Notice: "${point.detail}". Find what raised it; the test cannot click through it.`,
		);
	return point;
}

export async function cdp(
	obsidian: ObsidianClient,
	method: string,
	params: object,
): Promise<unknown> {
	const { stdout } = await obsidian.exec("dev:cdp", { method, params: JSON.stringify(params) });
	const output = stdout.trim();
	if (output.startsWith("Error")) throw new Error(`${method}: ${output}`);
	return output ? JSON.parse(output) : undefined;
}

export async function click(
	obsidian: ObsidianClient,
	target: UiTarget,
	options: { button?: "left" | "right"; timeoutMs?: number } = {},
): Promise<void> {
	await clickAt(
		obsidian,
		await settledPoint(obsidian, target, options.timeoutMs),
		options.button,
	);
}

export async function clickAt(
	obsidian: ObsidianClient,
	{ x, y }: Point,
	button: "left" | "right" = "left",
): Promise<void> {
	await cdp(obsidian, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
	for (const type of ["mousePressed", "mouseReleased"]) {
		await cdp(obsidian, "Input.dispatchMouseEvent", { type, x, y, button, clickCount: 1 });
	}
}

export type Point = Readonly<{ x: number; y: number }>;

/**
 * A point on `target` once it is visible, alone, still and not covered: its middle, or a
 * quarter of its height below its top or above its bottom.
 */
export async function pointOn(
	obsidian: ObsidianClient,
	target: UiTarget,
	part: "top" | "middle" | "bottom" = "middle",
): Promise<Point> {
	const { x, y, height } = await settledPoint(obsidian, target);
	return { x, y: part === "middle" ? y : y + (part === "top" ? -height / 4 : height / 4) };
}

/** Rests the mouse on `target`, as a user reading it does. */
export async function hover(obsidian: ObsidianClient, target: UiTarget): Promise<void> {
	await cdp(obsidian, "Input.dispatchMouseEvent", {
		type: "mouseMoved",
		...(await pointOn(obsidian, target)),
	});
}

export type HeldMouse = Readonly<{
	/** Moves the mouse in `steps` even steps, as a hand drags it. */
	moveTo(to: Point, steps?: number): Promise<void>;
	release(): Promise<void>;
}>;

export async function pressMouse(obsidian: ObsidianClient, at: Point): Promise<HeldMouse> {
	let current = at;
	const send = async (type: string, { x, y }: Point, buttons: number) => {
		const clickCount = type === "mouseMoved" ? 0 : 1;
		await cdp(obsidian, "Input.dispatchMouseEvent", {
			type,
			x,
			y,
			button: "left",
			buttons,
			clickCount,
		});
	};
	await cdp(obsidian, "Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
	await send("mousePressed", at, 1);
	return {
		async moveTo(to, steps = 8) {
			const from = current;
			for (let step = 1; step <= steps; step++) {
				current = {
					x: from.x + ((to.x - from.x) * step) / steps,
					y: from.y + ((to.y - from.y) * step) / steps,
				};
				await send("mouseMoved", current, 1);
			}
		},
		release: () => send("mouseReleased", current, 0),
	};
}

export async function drag(
	obsidian: ObsidianClient,
	from: UiTarget,
	to: UiTarget,
	part: "top" | "bottom",
): Promise<void> {
	const mouse = await pressMouse(obsidian, await pointOn(obsidian, from));
	await mouse.moveTo(await pointOn(obsidian, to, part));
	await mouse.release();
}

export async function typeInto(
	obsidian: ObsidianClient,
	target: UiTarget,
	text: string,
	options: { replace?: boolean } = {},
): Promise<void> {
	await click(obsidian, target);
	if (options.replace) {
		const selectAll = {
			key: "a",
			windowsVirtualKeyCode: 65,
			modifiers: process.platform === "darwin" ? 4 : 2,
		};
		await cdp(obsidian, "Input.dispatchKeyEvent", {
			type: "keyDown",
			...selectAll,
			...(process.platform === "darwin" ? { commands: ["selectAll"] } : {}),
		});
		await cdp(obsidian, "Input.dispatchKeyEvent", { type: "keyUp", ...selectAll });
	}
	await typeText(obsidian, text);
}

/** Types into whatever has focus, as a user does who starts typing without a click. */
export async function typeText(obsidian: ObsidianClient, text: string): Promise<void> {
	await cdp(obsidian, "Input.insertText", { text });
}

const KEY_CODES = { Enter: 13, Escape: 27, ArrowUp: 38, ArrowDown: 40 } as const;

/** Presses and releases `key` on whatever has focus. */
export async function pressKey(
	obsidian: ObsidianClient,
	key: keyof typeof KEY_CODES,
): Promise<void> {
	const event = { key, code: key, windowsVirtualKeyCode: KEY_CODES[key] };
	await cdp(obsidian, "Input.dispatchKeyEvent", { type: "keyDown", ...event });
	await cdp(obsidian, "Input.dispatchKeyEvent", { type: "keyUp", ...event });
}

/** Turns the mouse wheel over the page, as a user scrolls, and resolves to where it came to rest. */
export async function scrollPage(obsidian: ObsidianClient, deltaY: number): Promise<number> {
	const { x, y } = await settledPoint(obsidian, ui.pageScroller);
	await cdp(obsidian, "Input.dispatchMouseEvent", {
		type: "mouseWheel",
		x,
		y,
		deltaX: 0,
		deltaY,
	});
	let last = Number.NaN;
	return await obsidian.waitFor(
		async () => {
			const top = await pageScrollTop(obsidian);
			const settled = top > 0 && top === last;
			last = top;
			return settled ? top : false;
		},
		{ timeoutMs: 5_000, intervalMs: 150, message: "the page scrolled and came to rest" },
	);
}

/**
 * Clicks `opener`, which must open a file chooser, and answers it with
 * `filePath` from disk through the real `<input type="file">`. Electron
 * ignores Chromium's chooser interception and opens a native dialog that
 * stays modal and blocks obsidian:// links until the app quits, so only the
 * dialog itself is held back while the test holds the chooser.
 */
export async function chooseFile(
	obsidian: ObsidianClient,
	opener: UiTarget,
	filePath: string,
): Promise<void> {
	await obsidian.dev.evalJson(`(() => {
		if (window.__podnotesJourneyChooser) throw new Error("A file chooser is already held.");
		const prototype = HTMLInputElement.prototype;
		const own = Object.getOwnPropertyDescriptor(prototype, "click");
		const click = prototype.click;
		const held = [];
		prototype.click = function () {
			if (this.type === "file") return void held.push(this);
			return click.call(this);
		};
		window.__podnotesJourneyChooser = { own, held };
		return true;
	})()`);
	try {
		await click(obsidian, opener);
		const input = await obsidian.waitFor(
			async () => {
				const evaluated = (await cdp(obsidian, "Runtime.evaluate", {
					expression: "window.__podnotesJourneyChooser.held.at(-1) ?? null",
				})) as { result: { objectId?: string } };
				return evaluated.result.objectId ?? false;
			},
			{ timeoutMs: 5_000, intervalMs: 100, message: "the file chooser to open" },
		);
		await cdp(obsidian, "DOM.setFileInputFiles", { objectId: input, files: [filePath] });
	} finally {
		await obsidian.dev.evalJson(`(() => {
			const { own } = window.__podnotesJourneyChooser;
			if (own) Object.defineProperty(HTMLInputElement.prototype, "click", own);
			else delete HTMLInputElement.prototype.click;
			delete window.__podnotesJourneyChooser;
			return true;
		})()`);
	}
}
