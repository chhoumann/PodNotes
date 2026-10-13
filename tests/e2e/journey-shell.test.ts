import { describe, expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness } from "./harness";
import {
	openInEditor,
	reloadObsidian,
	showLibrary,
	showList,
	showPodNotes,
} from "./journey/actions";
import { click, pressKey, scrollPage } from "./journey/input";
import { ui } from "./journey/targets";
import { isShown, listedEpisodes, pageScrollTop, shownMenu, waitUntilShown } from "./journey/wait";
import {
	type FixtureEpisode,
	type FixtureFeed,
	type FixtureServer,
	pubDate,
	startFixtureServer,
} from "./journey/fixtures";
import {
	episodeRef,
	observePlayback,
	playbackOver,
	seedLibrary,
	waitForLibrary,
	waitForPlayback,
	writeVaultFile,
} from "./journey/library";
import { jsLiteral, VIEW_TYPE } from "./runtime";

const LONG: FixtureEpisode = { title: "Shell Long Listen", seconds: 60, pubDate: pubDate(0) };
const OTHER: FixtureEpisode = { title: "Shell Other Listen", seconds: 60, pubDate: pubDate(1) };
const FEED: FixtureFeed = {
	title: "Journey Shell",
	slug: "shell",
	artwork: true,
	episodes: [LONG, OTHER],
};

/** Enough podcasts that the Library scrolls. */
const SHELF: FixtureFeed[] = Array.from({ length: 23 }, (_, index) => ({
	title: `Shell Shelf ${index + 1}`,
	slug: `shelf-${index + 1}`,
	artwork: true,
	episodes: [{ title: `Shelf Listen ${index + 1}`, seconds: 5, pubDate: pubDate(2) }],
}));

const getContext = createPodNotesE2EHarness("journey-shell");

async function serve(feeds: readonly FixtureFeed[] = [FEED]): Promise<FixtureServer> {
	const server = await startFixtureServer(feeds);
	onTestFinished(() => server.stop());
	return server;
}

async function playFromList(): Promise<void> {
	const { obsidian } = getContext();
	await showPodNotes(obsidian);
	await showLibrary(obsidian);
	await click(obsidian, ui.podcastCard(FEED.title));
	await click(obsidian, ui.episode(LONG.title));
	await waitForPlayback(
		obsidian,
		(playback) =>
			playback.episode?.title === LONG.title && playback.playing && playback.seconds > 0,
		`${LONG.title} playing`,
	);
}

/** The mini player's progress bar, in percent of the episode. */
async function miniProgress(): Promise<number> {
	return await getContext().obsidian.dev.evalJson<number>(
		`parseFloat(document.querySelector('.workspace-leaf-content[data-type="${VIEW_TYPE}"] .pn-mini-prog span')?.style.width ?? "NaN")`,
	);
}

/** The PodNotes view's state in the workspace Obsidian saved to disk. */
async function savedViewStates(): Promise<unknown[]> {
	return await getContext().obsidian.dev.evalJsonAsync<unknown[]>(`(async () => {
		const layout = JSON.parse(await app.vault.adapter.read(app.vault.configDir + "/workspace.json"));
		const states = [];
		const walk = (node) => {
			if (node?.state?.type === ${jsLiteral(VIEW_TYPE)}) states.push(node.state.state);
			for (const child of node?.children ?? []) walk(child);
		};
		[layout.main, layout.left, layout.right].forEach(walk);
		return states;
	})()`);
}

async function propertiesItem(): Promise<string> {
	return await getContext().obsidian.dev.evalJson<string>(
		'document.querySelector(".status-bar .plugin-properties").innerText',
	);
}

async function showStatusBarItem(): Promise<void> {
	const { obsidian, sandbox } = getContext();
	const notePath = sandbox.path("Nine properties.md");
	const properties = Array.from({ length: 9 }, (_, index) => `field${index + 1}: ${index + 1}`);
	await writeVaultFile(obsidian, notePath, `---\n${properties.join("\n")}\n---\n`);
	await openInEditor(obsidian, notePath);
	await obsidian.waitFor(async () => (await propertiesItem()) === "9 properties", {
		timeoutMs: 5_000,
		message: "Obsidian's core Properties plugin showing 9 properties in the status bar",
	});
}

type Box = Readonly<{ top: number; bottom: number; left: number; right: number }>;

async function expectPlaybackClearOfStatusBar(when: string): Promise<void> {
	const { bar, control, atCenter } = await getContext().obsidian.dev.evalJson<{
		bar: Box;
		control: Box;
		atCenter: boolean;
	}>(`(() => {
		const box = (el) => {
			const { top, bottom, left, right } = el.getBoundingClientRect();
			return { top, bottom, left, right };
		};
		const [control] = ${ui.miniPlayback.elements};
		const { top, bottom, left, right } = box(control);
		const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
		return { bar: box(document.querySelector(".status-bar")), control: box(control), atCenter: control.contains(hit) };
	})()`);
	expect(await propertiesItem(), `${when}: the Properties item`).toBe("9 properties");
	expect(
		bar.left < control.right && bar.right > control.left,
		`${when}: the status bar spans the play/pause control`,
	).toBe(true);
	expect(
		control.bottom,
		`${when}: the play/pause control ends at or above the status bar's top`,
	).toBeLessThanOrEqual(bar.top);
	expect(atCenter, `${when}: the play/pause control is what its center shows`).toBe(true);
}

async function expectAdvancing(label: string): Promise<void> {
	const [first, later] = await playbackOver(getContext().obsidian, 1500);
	expect({ label, playing: later.playing }).toEqual({ label, playing: true });
	expect(later.seconds - first.seconds, `${label}: seconds advanced`).toBeGreaterThan(1);
	expect(later.episode?.title, `${label}: same episode`).toBe(LONG.title);
}

describe("view shell journeys", () => {
	test("audio keeps playing and the mini player keeps time while the user browses the pages", async () => {
		const context = getContext();
		const { obsidian } = context;
		const library = [FEED, ...SHELF];
		await seedLibrary(context, await serve(library), { subscriptions: library });
		await playFromList();
		await click(obsidian, ui.collapsePlayer);
		await waitUntilShown(obsidian, ui.miniPlayer);
		const start = await miniProgress();

		for (const list of ["Latest episodes", "Queue", "Playlists", "Local files", "Played"]) {
			await showList(obsidian, list);
			await expectAdvancing(`on ${list}`);
		}
		await showLibrary(obsidian);
		// To the bottom, where the last podcast shows whole and a click scrolls nothing.
		const scrolled = await scrollPage(obsidian, 10_000);
		await click(obsidian, ui.podcastCard(SHELF[SHELF.length - 1].title));
		await waitUntilShown(obsidian, ui.backTo("Library"));
		await expectAdvancing("on a podcast's page");
		await click(obsidian, ui.backTo("Library"));
		await waitUntilShown(obsidian, ui.libraryHead);
		expect(await pageScrollTop(obsidian), "Back returns to where the Library was").toBe(
			scrolled,
		);

		await click(obsidian, ui.podcastCard(FEED.title));
		await expectAdvancing("on the podcast's page");

		expect(await isShown(obsidian, ui.fullPlayer)).toBe(false);
		expect(await miniProgress()).toBeGreaterThan(start + 5);
	});

	test("collapsing the full player keeps playing, and the mini player opens it again", async () => {
		const context = getContext();
		const { obsidian } = context;
		await seedLibrary(context, await serve(), { subscriptions: [FEED] });
		await playFromList();
		expect(await isShown(obsidian, ui.fullPlayer)).toBe(true);

		await click(obsidian, ui.collapsePlayer);
		await waitUntilShown(obsidian, ui.miniPlayer);
		expect(await isShown(obsidian, ui.fullPlayer)).toBe(false);
		await expectAdvancing("collapsed by its chevron");
		expect((await observePlayback(obsidian)).media?.paused).toBe(false);

		await click(obsidian, ui.openPlayer);
		await waitUntilShown(obsidian, ui.fullPlayer);
		expect(await isShown(obsidian, ui.miniPlayer)).toBe(false);
		await expectAdvancing("opened from the mini player");

		await pressKey(obsidian, "Escape");
		await waitUntilShown(obsidian, ui.miniPlayer);
		expect(await isShown(obsidian, ui.fullPlayer)).toBe(false);
		await expectAdvancing("collapsed by Escape");
	});

	test("a reload restores the last page and the episode paused where it stopped, in the mini player", async () => {
		const context = getContext();
		const { obsidian, plugin } = context;
		await seedLibrary(context, await serve(), { subscriptions: [FEED] });
		await showStatusBarItem();
		await playFromList();
		await waitForPlayback(
			obsidian,
			(playback) => playback.seconds >= 3,
			"three seconds played",
		);
		await click(obsidian, ui.collapsePlayer);
		await waitUntilShown(obsidian, ui.miniPlayer);
		await expectPlaybackClearOfStatusBar("before the reload");
		await click(obsidian, ui.miniPlayback);
		const paused = await waitForPlayback(obsidian, (playback) => !playback.playing, "paused");
		const saved = await waitForLibrary(
			plugin,
			(library) =>
				Math.abs(
					(library.progress(episodeRef(FEED, LONG))?.seconds ?? -1) - paused.seconds,
				) < 0.25,
			"the paused position saved",
		);
		const position = saved.progress(episodeRef(FEED, LONG))?.seconds as number;
		await obsidian.waitFor(
			async () =>
				JSON.stringify(await savedViewStates()) ===
				JSON.stringify([{ page: { kind: "feed", key: FEED.title } }]),
			{
				timeoutMs: 15_000,
				intervalMs: 200,
				message: "the podcast's page saved in the workspace",
			},
		);

		await reloadObsidian(obsidian);

		await waitUntilShown(obsidian, ui.miniPlayer);
		expect(await isShown(obsidian, ui.fullPlayer)).toBe(false);
		expect(await isShown(obsidian, ui.backTo("Library"))).toBe(true);
		await obsidian.waitFor(async () => (await listedEpisodes(obsidian)).length === 2, {
			timeoutMs: 15_000,
			message: "the restored podcast's episodes",
		});
		expect(await listedEpisodes(obsidian)).toEqual([LONG.title, OTHER.title]);
		expect(await isShown(obsidian, ui.openPlayerFor(LONG.title))).toBe(true);
		expect(await isShown(obsidian, ui.miniPlay)).toBe(true);
		const [first, later] = await playbackOver(obsidian, 1500);
		expect(first.episode).toEqual(episodeRef(FEED, LONG));
		expect(later.playing).toBe(false);
		expect(later.seconds).toBeCloseTo(position, 0);
		expect(later.seconds - first.seconds).toBe(0);
		await expectPlaybackClearOfStatusBar("after the reload");
	});

	test("J-CTX-01 J-CTX-02 J-CTX-09 an episode's menu opens from its button and by right-click, in the menu's order", async () => {
		const context = getContext();
		const { obsidian, plugin } = context;
		await seedLibrary(context, await serve(), {
			subscriptions: [FEED],
			playlists: [{ name: "Walks", removeAfterPlay: false, episodes: [] }],
		});
		const order = [
			"Play",
			"Add to queue",
			"Create note",
			"Download",
			"Add to Favorites",
			"Add to playlist",
			"Mark as played",
			"Copy episode link",
		];
		const titles = async () => (await shownMenu(obsidian)).map(({ title }) => title);

		await showPodNotes(obsidian);
		await showLibrary(obsidian);
		await click(obsidian, ui.podcastCard(FEED.title));
		await click(obsidian, ui.episodeMenu(OTHER.title));
		await waitUntilShown(obsidian, ui.menuItem("Play"));
		expect(await titles(), "the overflow button's menu").toEqual(order);
		await pressKey(obsidian, "Escape");
		await click(obsidian, ui.episode(OTHER.title), { button: "right" });
		await waitUntilShown(obsidian, ui.menuItem("Play"));
		expect(await titles(), "the right-click menu").toEqual(order);

		await click(obsidian, ui.menuItem("Add to playlist"));
		await waitUntilShown(obsidian, ui.menuItem("Walks"));
		expect(await shownMenu(obsidian)).toEqual([
			{ title: "Walks", checked: false },
			{ title: "New playlist", checked: false },
		]);
		await click(obsidian, ui.menuItem("Walks"));
		await waitForLibrary(
			plugin,
			(library) => library.playlists.Walks?.includes(OTHER.title) === true,
			"the episode added to Walks",
		);
		await click(obsidian, ui.episodeMenu(OTHER.title));
		await click(obsidian, ui.menuItem("Add to playlist"));
		await waitUntilShown(obsidian, ui.menuItem("Walks"));
		expect(await shownMenu(obsidian)).toEqual([
			{ title: "Walks", checked: true },
			{ title: "New playlist", checked: false },
		]);
		await pressKey(obsidian, "Escape");

		await click(obsidian, ui.episodeMenu(OTHER.title));
		await click(obsidian, ui.menuItem("Mark as played"));
		const played = await waitForLibrary(
			plugin,
			(library) => library.progress(episodeRef(FEED, OTHER))?.finished === true,
			"the episode marked as played",
		);
		expect(played.currentEpisode).toBeNull();
		await click(obsidian, ui.episodeMenu(OTHER.title));
		await waitUntilShown(obsidian, ui.menuItem("Mark as unplayed"));
		expect(await titles()).not.toContain("Mark as played");
		await pressKey(obsidian, "Escape");

		await click(obsidian, ui.episode(LONG.title));
		const started = await waitForPlayback(
			obsidian,
			(playback) =>
				playback.episode?.title === LONG.title && playback.playing && playback.seconds > 1,
			`${LONG.title} playing`,
		);
		await click(obsidian, ui.collapsePlayer);
		await click(obsidian, ui.episode(LONG.title), { button: "right" });
		await waitUntilShown(obsidian, ui.menuItem("Open player"));
		expect((await titles())[0]).toBe("Open player");
		expect(await titles()).not.toContain("Play");
		await click(obsidian, ui.menuItem("Open player"));
		await waitUntilShown(obsidian, ui.fullPlayer);
		const after = await observePlayback(obsidian);
		expect(after.episode, "the same episode, not restarted").toEqual(episodeRef(FEED, LONG));
		expect(after.seconds).toBeGreaterThanOrEqual(started.seconds);
		await expectAdvancing("after Open player");
	});

	test("the same view switches to the rail at 560 px and back as its sidebar is resized", async () => {
		const context = getContext();
		const { obsidian } = context;
		await seedLibrary(context, await serve(), { subscriptions: [FEED] });
		await showPodNotes(obsidian);
		await showLibrary(obsidian);
		await obsidian.dev.evalJson(`(() => {
			const view = app.workspace.getLeavesOfType(${jsLiteral(VIEW_TYPE)})[0].view;
			view.__journeyShell = view.containerEl.querySelector(".podcast-view");
			return true;
		})()`);
		const sameView = () =>
			obsidian.dev.evalJson<{ width: number; layout: string; same: boolean }>(`(() => {
				const view = app.workspace.getLeavesOfType(${jsLiteral(VIEW_TYPE)})[0].view;
				const shell = view.containerEl.querySelector(".podcast-view");
				return {
					width: shell.clientWidth,
					layout: shell.classList.contains("is-wide") ? "wide" : "compact",
					same: view.__journeyShell === shell,
				};
			})()`);
		const resizeSidebar = (width: number) =>
			obsidian.dev.evalJson(`app.workspace.rightSplit.setSize(${width}), true`);
		const widthOf = async () => (await sameView()).width;

		await resizeSidebar(600);
		await obsidian.waitFor(async () => (await widthOf()) >= 560, {
			timeoutMs: 5_000,
			message: "the sidebar at least 560 px wide",
		});
		await waitUntilShown(obsidian, ui.rail);
		expect(await sameView()).toMatchObject({ layout: "wide", same: true });
		expect(await isShown(obsidian, ui.libraryHead)).toBe(false);
		await click(obsidian, ui.railItem("Queue"));
		await waitUntilShown(obsidian, ui.pageTitle("Queue"));

		await resizeSidebar(320);
		await obsidian.waitFor(async () => (await widthOf()) < 560, {
			timeoutMs: 5_000,
			message: "the sidebar narrower than 560 px",
		});
		await obsidian.waitFor(async () => !(await isShown(obsidian, ui.rail)), {
			timeoutMs: 5_000,
			message: "the rail gone",
		});
		expect(await sameView()).toMatchObject({ layout: "compact", same: true });
		await waitUntilShown(obsidian, ui.pageTitle("Queue"));
		await click(obsidian, ui.backTo("Library"));
		await waitUntilShown(obsidian, ui.libraryHead);
	});
});
