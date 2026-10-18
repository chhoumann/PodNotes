import { expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness } from "./harness";
import {
	asPhone,
	placePodNotes,
	setOffline,
	showLibrary,
	showList,
	showPodNotes,
} from "./journey/actions";
import { click, pressKey } from "./journey/input";
import { PLAYER_VIEW, ui } from "./journey/targets";
import { eventually, isShown, waitUntilShown } from "./journey/wait";
import { type FixtureFeed, pubDate, startFixtureServer } from "./journey/fixtures";
import { seedLibrary } from "./journey/library";
import { jsLiteral, RELOAD_OPTIONS } from "./runtime";

const getContext = createPodNotesE2EHarness("view-polish");

const LONG: FixtureFeed = {
	title: "The Remarkably Long Podcast Title That Keeps Going",
	slug: "long-title",
	artwork: false,
	episodes: [{ title: "First Steps", seconds: 60, pubDate: pubDate(0) }],
};
const SHORT: FixtureFeed = {
	title: "Short Show",
	slug: "short-show",
	artwork: true,
	episodes: [{ title: "First Steps", seconds: 60, pubDate: pubDate(0) }],
};
const PRIVATE = "Missing Address";
const SECRET_ID = "podnotes-feed-url-4b0c7e1a-2f6d-4c3b-9a8e-5d1f0e2c7b9a";

async function atSidebarWidth(width: number): Promise<void> {
	const { obsidian } = getContext();
	await obsidian.dev.evalJson(`app.workspace.rightSplit.setSize(${width}), true`);
	await obsidian.waitFor(
		() =>
			obsidian.dev.evalJson<boolean>(
				`Math.round(document.querySelector(${jsLiteral(PLAYER_VIEW)}).getBoundingClientRect().width) === ${width}`,
			),
		{ timeoutMs: 5_000, intervalMs: 100, message: `the view ${width} px wide` },
	);
}

type CoverText = Readonly<{
	size: number;
	firstInside: boolean;
	bottomGap: number;
	fontSize: number;
	lines: number;
}>;

/** Where a text cover draws its title's first letter and its last line, and how many lines show. */
function coverText(selector: string): Promise<CoverText[]> {
	return getContext().obsidian.dev.evalJson<CoverText[]>(`(() =>
		[...document.querySelectorAll(${jsLiteral(`${PLAYER_VIEW} ${selector} .pn-cover.is-text`)})].map((cover) => {
			const box = cover.getBoundingClientRect();
			const text = cover.firstElementChild;
			const range = document.createRange();
			range.setStart(text.firstChild, 0);
			range.setEnd(text.firstChild, 1);
			const first = range.getBoundingClientRect();
			range.selectNodeContents(text);
			const shown = text.getBoundingClientRect();
			const bottom = Math.min(shown.bottom, box.bottom);
			const lines = new Set(
				[...range.getClientRects()]
					.map((line) => Math.round((line.top + line.bottom) / 2))
					.filter((middle) => middle > shown.top && middle < bottom),
			);
			return {
				size: Math.round(box.width),
				firstInside: first.top >= box.top && first.bottom <= box.bottom && first.left >= box.left,
				bottomGap: Math.round(box.bottom - text.getBoundingClientRect().bottom),
				fontSize: parseFloat(getComputedStyle(text).fontSize),
				lines: lines.size,
			};
		}))()`);
}

test("at 320 px, a podcast without artwork shows the start of its long name in three lines on its card and rows", async () => {
	const context = getContext();
	const server = await startFixtureServer([LONG]);
	onTestFinished(() => server.stop());
	await seedLibrary(context, server, { subscriptions: [LONG] });
	await showPodNotes(context.obsidian);
	await atSidebarWidth(320);
	await showLibrary(context.obsidian);

	const [card] = await coverText(".pn-gridcard");
	expect(card).toMatchObject({
		firstInside: true,
		bottomGap: Math.round(card.size / 10),
		lines: 3,
	});
	expect(card.fontSize).toBeGreaterThanOrEqual(10);

	await showList(context.obsidian, "Latest episodes");
	await waitUntilShown(context.obsidian, ui.episode("First Steps"));
	const [row] = await coverText(".pn-ep-main");
	expect(row).toMatchObject({
		size: 40,
		firstInside: true,
		bottomGap: 4,
		fontSize: 10,
		lines: 3,
	});
});

type Look = Readonly<{ opacity: number; dimmedBy: number }>;

/** A control's own opacity, and the opacity of everything it is drawn in. */
function look(selector: string, text?: string): Promise<Look> {
	return getContext().obsidian.dev.evalJson<Look>(`(() => {
		const el = [...document.querySelectorAll(${jsLiteral(`${PLAYER_VIEW} ${selector}`)})].find(
			(el) => ${jsLiteral(text ?? null)} === null || el.textContent.trim() === ${jsLiteral(text ?? "")},
		);
		let dimmedBy = 1;
		for (let at = el.parentElement; at; at = at.parentElement) dimmedBy *= Number(getComputedStyle(at).opacity);
		return { opacity: Number(getComputedStyle(el).opacity), dimmedBy };
	})()`);
}

test("a feed address missing from this device wraps in the banner, and offline every disabled control looks alike", async () => {
	const context = getContext();
	const { obsidian, plugin } = context;
	const server = await startFixtureServer([LONG]);
	onTestFinished(() => server.stop());
	await seedLibrary(context, server, { subscriptions: [LONG] });
	await obsidian.dev.evalJson(`app.secretStorage.setSecret(${jsLiteral(SECRET_ID)}, ""), true`);
	await plugin.updateDataAndReload<Record<string, Record<string, unknown>>>((data) => {
		data.savedFeeds[PRIVATE] = {
			title: PRIVATE,
			artworkUrl: "",
			url: `podnotes-private-feed:${encodeURIComponent(PRIVATE)}`,
			urlSecretId: SECRET_ID,
		};
	}, RELOAD_OPTIONS);
	await showPodNotes(obsidian);
	await atSidebarWidth(320);
	await showList(obsidian, "Latest episodes");
	await waitUntilShown(obsidian, ui.episode("First Steps"));
	await showLibrary(obsidian);
	await click(obsidian, ui.podcastCard(PRIVATE));
	await waitUntilShown(obsidian, ui.feedErrorAction("Set feed address"));

	const detail = await obsidian.dev.evalJson<{ text: string; clipped: boolean }>(`(() => {
		const detail = document.querySelector(${jsLiteral(`${PLAYER_VIEW} .pn-banner .d`)});
		return { text: detail.textContent, clipped: detail.scrollWidth > detail.clientWidth };
	})()`);
	expect(detail).toEqual({ text: "Address not on this device", clipped: false });

	await setOffline(obsidian, true);
	onTestFinished(() => setOffline(obsidian, false));
	expect(
		await eventually(
			obsidian,
			async () => [
				await look(".pn-banner button", "Set feed address"),
				await look('button[aria-label="Refresh episodes"]'),
			],
			[
				{ opacity: 0.4, dimmedBy: 1 },
				{ opacity: 0.4, dimmedBy: 1 },
			],
		),
	).toEqual([
		{ opacity: 0.4, dimmedBy: 1 },
		{ opacity: 0.4, dimmedBy: 1 },
	]);

	await click(obsidian, ui.back);
	await showList(obsidian, "Latest episodes");
	expect(await look('.pn-ep-main[aria-disabled="true"]')).toEqual({ opacity: 0.4, dimmedBy: 1 });
});

test("on a phone, the Escape that closes a row's menu in the right drawer leaves focus on the row's More button", async () => {
	const context = getContext();
	const { obsidian } = context;
	await asPhone(obsidian);
	const server = await startFixtureServer([LONG]);
	onTestFinished(() => server.stop());
	await seedLibrary(context, server, { subscriptions: [LONG] });
	// Obsidian sends focus from a sidebar to the main area on an Escape nothing handled.
	await placePodNotes(obsidian, "right drawer");
	await showList(obsidian, "Latest episodes");
	await click(obsidian, ui.episodeMenu("First Steps"));
	await waitUntilShown(obsidian, ui.menuItem("Add to queue"));
	// Obsidian gives a menu the keys a timer tick after it shows.
	await obsidian.waitFor(
		() =>
			obsidian.dev.evalJson<boolean>(
				'(app.keymap.getWindowStack(activeWindow).scope.keys ?? []).some((key) => key.key === "ArrowDown")',
			),
		{ timeoutMs: 5_000, intervalMs: 50, message: "the menu to take the keys" },
	);
	// Where focus is in the task after the Escape, and 200 ms later, past the menu's 150 ms hide.
	await obsidian.dev.evalJson(`(() => {
		const more = (${ui.episodeMenu("First Steps").elements})[0];
		const view = document.querySelector(${jsLiteral(PLAYER_VIEW)});
		const at = () => ({ onMore: document.activeElement === more, inView: view.contains(document.activeElement) });
		window.pnEscapeFocus = [];
		activeWindow.addEventListener("keydown", (event) => {
			if (event.key !== "Escape") return;
			setTimeout(() => window.pnEscapeFocus.push(at()));
			setTimeout(() => window.pnEscapeFocus.push(at()), 200);
		}, { capture: true, once: true });
		return true;
	})()`);
	onTestFinished(async () => {
		await obsidian.dev.evalJson("delete window.pnEscapeFocus");
	});

	await pressKey(obsidian, "Escape");

	expect(
		await eventually(obsidian, () => obsidian.dev.evalJson<unknown[]>("window.pnEscapeFocus"), [
			{ onMore: true, inView: true },
			{ onMore: true, inView: true },
		]),
	).toEqual([
		{ onMore: true, inView: true },
		{ onMore: true, inView: true },
	]);
	expect(
		await eventually(obsidian, () => isShown(obsidian, ui.menuItem("Add to queue")), false),
	).toBe(false);
});

test("on a phone, a podcast's header keeps its cover at the left under a theme that centers images, over a search row in the color of the page behind it", async () => {
	const context = getContext();
	const { obsidian } = context;
	await asPhone(obsidian);
	const server = await startFixtureServer([SHORT]);
	onTestFinished(() => server.stop());
	await seedLibrary(context, server, { subscriptions: [SHORT] });

	const headers: Record<string, unknown> = {};
	for (const place of ["right drawer", "main area"] as const) {
		await placePodNotes(obsidian, place);
		await showLibrary(obsidian);
		await click(obsidian, ui.podcastCard(SHORT.title));
		await waitUntilShown(obsidian, ui.podcastPage(SHORT.title));
		// A theme or snippet that centers every image, as on the phone in #506.
		const shown = await obsidian.dev.evalJson<Record<string, unknown>>(`(() => {
			const view = document.querySelector(${jsLiteral(PLAYER_VIEW)});
			const hero = view.querySelector(".pn-hero");
			const filter = view.querySelector(".pn-filter");
			const centered = document.head.appendChild(document.createElement("style"));
			centered.textContent = "img { margin-inline: auto !important; }";
			const classes = document.body.className;
			try {
				return Object.fromEntries(["dark", "light"].map((theme) => {
					document.body.classList.remove("theme-dark", "theme-light");
					document.body.classList.add("theme-" + theme);
					const cover = hero.querySelector(".pn-cover").getBoundingClientRect();
					let page = filter.parentElement;
					while (getComputedStyle(page).backgroundColor === "rgba(0, 0, 0, 0)") page = page.parentElement;
					return [${jsLiteral(place)} + ", " + theme, {
						coverFromEdge: Math.round(cover.left - hero.getBoundingClientRect().left),
						titleFromCover: Math.round(hero.querySelector("h1").getBoundingClientRect().left - cover.right),
						band: getComputedStyle(filter).backgroundColor,
						page: getComputedStyle(page).backgroundColor,
					}];
				}));
			} finally {
				centered.remove();
				document.body.className = classes;
			}
		})()`);
		Object.assign(headers, shown);
	}

	const atLeft = { coverFromEdge: 0, titleFromCover: 12 };
	expect(headers).toEqual({
		"right drawer, dark": { ...atLeft, band: "rgb(30, 30, 30)", page: "rgb(30, 30, 30)" },
		"right drawer, light": {
			...atLeft,
			band: "rgb(255, 255, 255)",
			page: "rgb(255, 255, 255)",
		},
		"main area, dark": { ...atLeft, band: "rgb(0, 0, 0)", page: "rgb(0, 0, 0)" },
		"main area, light": { ...atLeft, band: "rgb(255, 255, 255)", page: "rgb(255, 255, 255)" },
	});
});
