import type { ObsidianClient } from "obsidian-e2e";
import { jsLiteral, PLUGIN_ID } from "../runtime";
import { PLAYER_VIEW, type UiTarget } from "./targets";

/** Waits until `target` has focus, as a user sees the caret before typing. */
export async function waitUntilFocused(obsidian: ObsidianClient, target: UiTarget): Promise<void> {
	await obsidian.waitFor(
		() =>
			obsidian.dev.evalJson<boolean>(`(${target.elements}).includes(document.activeElement)`),
		{ timeoutMs: 5_000, intervalMs: 100, message: `${target.name} focused` },
	);
}

/** Where the page's scroller is scrolled to, in whole pixels. */
export async function pageScrollTop(obsidian: ObsidianClient): Promise<number> {
	return await obsidian.dev.evalJson<number>(
		`Math.round(document.querySelector(${jsLiteral(`${PLAYER_VIEW} .pn-scroll`)})?.scrollTop ?? -1)`,
	);
}

export async function isShown(obsidian: ObsidianClient, target: UiTarget): Promise<boolean> {
	return (
		(await obsidian.dev.evalJson<number>(
			`(${target.elements}).filter((el) => el && el.getClientRects().length > 0).length`,
		)) > 0
	);
}

export async function waitUntilShown(
	obsidian: ObsidianClient,
	target: UiTarget,
	timeoutMs = 15_000,
): Promise<void> {
	await obsidian.waitFor(() => isShown(obsidian, target), {
		timeoutMs,
		intervalMs: 200,
		message: `${target.name} shown`,
	});
}

export async function listedEpisodes(obsidian: ObsidianClient): Promise<string[]> {
	return await obsidian.dev.evalJson<string[]>(
		`[...document.querySelectorAll(${jsLiteral(`${PLAYER_VIEW} .pn-ep-main`)})].filter((el) => !el.closest(".pn-player") && el.getClientRects().length > 0).map((el) => el.querySelector(".pn-ep-title")?.textContent.trim() ?? "")`,
	);
}

/** The shown episode rows' accessible names, which carry played, time left and playing state. */
export async function listedEpisodeLabels(obsidian: ObsidianClient): Promise<string[]> {
	return await obsidian.dev.evalJson<string[]>(
		`[...document.querySelectorAll(${jsLiteral(`${PLAYER_VIEW} .pn-ep-main`)})].filter((el) => !el.closest(".pn-player") && el.getClientRects().length > 0).map((el) => el.getAttribute("aria-label") ?? "")`,
	);
}

export async function listedEpisodesWithHeadings(obsidian: ObsidianClient): Promise<string[]> {
	return await obsidian.dev.evalJson<string[]>(
		`[...document.querySelectorAll(${jsLiteral(`${PLAYER_VIEW} .pn-scroll :is(h2.pn-h2, .pn-ep-main .pn-ep-title)`)})].filter((el) => el.getClientRects().length > 0).map((el) => el.textContent.trim())`,
	);
}

export async function isDisabled(obsidian: ObsidianClient, target: UiTarget): Promise<boolean> {
	return await obsidian.dev.evalJson<boolean>(
		`(() => { const all = (${target.elements}); return all.length > 0 && all.every((el) => el.disabled); })()`,
	);
}

/** The Library's podcast cards, in grid order, by their names. */
export async function shownPodcasts(obsidian: ObsidianClient): Promise<string[]> {
	return await obsidian.dev.evalJson<string[]>(
		`[...document.querySelectorAll(${jsLiteral(`${PLAYER_VIEW} button.pn-gridcard`)})].map((el) => el.getAttribute("aria-label"))`,
	);
}

export type ShownResult = Readonly<{ label: string; title: string; via: string | null }>;

export async function shownResults(obsidian: ObsidianClient): Promise<ShownResult[]> {
	return await obsidian.dev.evalJson<ShownResult[]>(
		`[...document.querySelectorAll(${jsLiteral(`${PLAYER_VIEW} button.pn-result`)})].map((el) => ({ label: el.getAttribute("aria-label"), title: el.querySelector(".t")?.textContent.trim() ?? "", via: el.querySelector(".pn-linkchip")?.textContent.trim() ?? null }))`,
	);
}

export type ShownMenuItem = Readonly<{ title: string; checked: boolean }>;

export async function shownMenu(obsidian: ObsidianClient): Promise<ShownMenuItem[]> {
	return await obsidian.dev.evalJson<ShownMenuItem[]>(
		`[...document.querySelectorAll(".menu .menu-item")].filter((el) => el.getClientRects().length > 0).map((el) => ({ title: el.querySelector(".menu-item-title")?.textContent.trim() ?? "", checked: el.classList.contains("mod-checked") }))`,
	);
}

export async function feedsLoading(obsidian: ObsidianClient): Promise<boolean> {
	return await obsidian.dev.evalJson<boolean>(`(() => {
		let states;
		app.plugins.plugins.${PLUGIN_ID}.feeds.subscribe((value) => (states = value))();
		return [...states.values()].some(({ status }) => status === "loading");
	})()`);
}

export async function shownText(obsidian: ObsidianClient): Promise<string> {
	return await obsidian.dev.evalJson<string>(
		`document.querySelector(${jsLiteral(PLAYER_VIEW)})?.innerText ?? ""`,
	);
}

export async function notices(obsidian: ObsidianClient): Promise<string[]> {
	return await obsidian.dev.evalJson<string[]>(
		`[...document.querySelectorAll(".notice")].map((notice) => notice.textContent.trim())`,
	);
}

/**
 * Resolves to what `read` returns once it equals `expected`, or after `ms` to its last
 * read, so the assertion that follows shows what differed.
 */
export async function eventually<T>(
	obsidian: ObsidianClient,
	read: () => Promise<T>,
	expected: T,
	ms = 5_000,
): Promise<T> {
	let last = await read();
	await obsidian
		.waitFor(async () => JSON.stringify((last = await read())) === JSON.stringify(expected), {
			timeoutMs: ms,
			intervalMs: 100,
		})
		.catch(() => undefined);
	return last;
}

/**
 * Reads `read` every 100 ms for `ms` and resolves to `expected` when every read
 * matched it, or to the first read that did not.
 */
export async function holdsFor<T>(
	obsidian: ObsidianClient,
	read: () => Promise<T>,
	expected: T,
	ms = 1500,
): Promise<T> {
	const deadline = Date.now() + ms;
	const { value } = await obsidian.waitFor(
		async () => {
			const value = await read();
			const settled =
				JSON.stringify(value) !== JSON.stringify(expected) || Date.now() >= deadline;
			return settled ? { value } : false;
		},
		{
			timeoutMs: ms + 10_000,
			intervalMs: 100,
			message: `${JSON.stringify(expected)} for ${ms} ms`,
		},
	);
	return value;
}
