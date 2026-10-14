import { describe, expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness } from "./harness";
import {
	clickInEditor,
	closePodNotes,
	openInEditor,
	revealInFileExplorer,
	showPodNotes,
} from "./journey/actions";
import { cdp, click, pointOn, pressHotkey, pressKey, pressMouse, typeText } from "./journey/input";
import { PLAYER_VIEW, ui, type UiTarget } from "./journey/targets";
import { eventually, holdsFor, isShown, waitUntilFocused, waitUntilShown } from "./journey/wait";
import {
	type FixtureEpisode,
	type FixtureFeed,
	type FixtureServer,
	pubDate,
	startFixtureServer,
	wav,
} from "./journey/fixtures";
import {
	observePlayback,
	readLibrary,
	recordWrites,
	seedLibrary,
	storedEpisode,
	waitForPlayback,
	writeVaultFile,
} from "./journey/library";
import { jsLiteral, VIEW_TYPE } from "./runtime";

const getContext = createPodNotesE2EHarness("journey-player");

const NOW: FixtureEpisode = { title: "Player Now", seconds: 60, pubDate: pubDate(0), guid: "now" };
const QUEUED: FixtureEpisode[] = Array.from({ length: 30 }, (_, index) => ({
	title: `Up Next ${index + 1}`,
	seconds: 6,
	pubDate: pubDate(index + 1),
	guid: `up-next-${index + 1}`,
}));
const [ONE, TWO, THREE, FOUR] = QUEUED;
const FEED: FixtureFeed = {
	title: "Journey Player",
	slug: "player",
	artwork: true,
	episodes: [NOW, ...QUEUED],
};
const titles = (episodes: readonly FixtureEpisode[]) => episodes.map(({ title }) => title);

async function serve(): Promise<FixtureServer> {
	const server = await startFixtureServer([FEED]);
	onTestFinished(() => server.stop());
	return server;
}

/** Restores `NOW` paused with `queue` queued, and shows PodNotes with the full player open. */
async function openPlayer(
	queue: readonly FixtureEpisode[],
	current: (server: FixtureServer) => Record<string, unknown> = () => ({}),
): Promise<FixtureServer> {
	const context = getContext();
	const server = await serve();
	await seedLibrary(context, server, {
		subscriptions: [FEED],
		current: { ...storedEpisode(server, FEED, NOW), ...current(server) },
		queue: queue.map((episode) => storedEpisode(server, FEED, episode)),
	});
	await showPodNotes(context.obsidian);
	if (!(await isShown(context.obsidian, ui.fullPlayer)))
		await click(context.obsidian, ui.openPlayer);
	await waitUntilShown(context.obsidian, ui.fullPlayer);
	return server;
}

async function resizeView(width: number, layout: "compact" | "wide"): Promise<void> {
	const { obsidian } = getContext();
	await obsidian.dev.evalJson(`app.workspace.rightSplit.setSize(${width}), true`);
	await obsidian.waitFor(
		() =>
			obsidian.dev.evalJson<boolean>(
				`document.querySelector(${jsLiteral(PLAYER_VIEW)}).classList.contains(${jsLiteral(`is-${layout}`)})`,
			),
		{ timeoutMs: 5_000, intervalMs: 100, message: `the ${layout} layout` },
	);
}

type Box = Readonly<{ width: number; height: number }>;

/** The video stage and the media element in it, or null when the stage shows no video. */
async function videoStage(): Promise<{ frame: Box; video: Box } | null> {
	return await getContext().obsidian.dev.evalJson(`(() => {
		const frame = document.querySelector(${jsLiteral(`${PLAYER_VIEW} .pn-player .pn-video`)});
		const video = frame?.querySelector("video.podnotes-media");
		const box = (el) => {
			const { width, height } = el.getBoundingClientRect();
			return { width: Math.round(width), height: Math.round(height) };
		};
		return frame && video ? { frame: box(frame), video: box(video) } : null;
	})()`);
}

async function expectVideoFrame(when: string, minWidth: number): Promise<void> {
	const stage = await videoStage();
	expect(stage, `${when}: the video on the stage`).not.toBeNull();
	const { frame, video } = stage!;
	expect(frame.width, `${when}: frame width`).toBeGreaterThanOrEqual(minWidth);
	expect(
		Math.abs(frame.height - (frame.width * 9) / 16),
		`${when}: a 16:9 frame, ${frame.width} by ${frame.height}`,
	).toBeLessThanOrEqual(1);
	expect(video, `${when}: the video fills its frame`).toEqual(frame);
}

/** The titles in the player's Up next panel, in order. */
async function upNext(): Promise<string[]> {
	return await getContext().obsidian.dev.evalJson<string[]>(
		`[...document.querySelectorAll(${jsLiteral(`${PLAYER_VIEW} .pn-player [role="list"][aria-label="Queue"] .pn-ep-title`)})].map((el) => el.textContent.trim())`,
	);
}

async function expectQueue(expected: readonly string[]): Promise<void> {
	const { obsidian, plugin } = getContext();
	expect(await eventually(obsidian, upNext, expected), "in Up next").toEqual(expected);
	expect(
		await eventually(obsidian, async () => (await readLibrary(plugin)).queue, expected),
		"in data.json",
	).toEqual(expected);
}

const focused = (target: UiTarget) =>
	getContext().obsidian.dev.evalJson<boolean>(
		`(${target.elements}).includes(document.activeElement)`,
	);

describe("player journeys", () => {
	test("the fullscreen button belongs to the video stage and hides while that stage is fullscreen", async () => {
		const { obsidian } = getContext();
		await openPlayer([], () => ({ mediaType: "video" }));
		await click(obsidian, ui.playbackToggle);
		await waitForPlayback(obsidian, (state) => state.playing, "video loaded");
		const fullscreen: UiTarget = {
			name: "video fullscreen",
			elements: `[...document.querySelectorAll(${jsLiteral(`${PLAYER_VIEW} .pn-video button.pn-fs`)})]`,
		};
		expect(await isShown(obsidian, fullscreen)).toBe(true);
		onTestFinished(async () => {
			await obsidian.dev.evalJsonAsync(
				"(async () => { if (document.fullscreenElement) await document.exitFullscreen(); return true; })()",
			);
		});

		await click(obsidian, fullscreen);
		expect(
			await eventually(
				obsidian,
				() =>
					obsidian.dev.evalJson<boolean>(
						`document.fullscreenElement === document.querySelector(${jsLiteral(`${PLAYER_VIEW} .pn-video`)})`,
					),
				true,
			),
		).toBe(true);
		expect(
			await obsidian.dev.evalJson<string>(
				`getComputedStyle((${fullscreen.elements})[0]).display`,
			),
		).toBe("none");

		await pressKey(obsidian, "Escape");
		expect(
			await eventually(
				obsidian,
				() => obsidian.dev.evalJson<boolean>("document.fullscreenElement === null"),
				true,
			),
		).toBe(true);
	});

	test.each(["theme-light", "theme-dark"])(
		"mini-player component styles survive the shell stylesheet loading last in %s",
		async (theme) => {
			const { obsidian } = getContext();
			await openPlayer([]);
			await resizeView(320, "compact");
			await click(obsidian, ui.collapsePlayer);
			await waitUntilShown(obsidian, ui.miniPlayer);
			await cdp(obsidian, "Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
			const styles = await obsidian.dev.evalJson<{
				before: Record<string, string>[];
				after: Record<string, string>[];
			}>(`(() => {
				const root = document.querySelector(${jsLiteral(PLAYER_VIEW)});
				const sheet = [...document.head.querySelectorAll("style")].find(sheet => root.classList.contains(sheet.id));
				if (!sheet) throw new Error("The shell stylesheet is missing");
				const next = sheet.nextSibling;
				const originalTheme = document.body.className;
				const read = () => [...root.querySelectorAll(".pn-mini button.pn-iconbtn")].map(button => {
					const style = getComputedStyle(button);
					return Object.fromEntries(["color", "opacity", "height", "width", "background-color", "border-radius"].map(key => [key, style.getPropertyValue(key)]));
				});
				try {
					document.body.classList.remove("theme-light", "theme-dark");
					document.body.classList.add(${jsLiteral(theme)});
					document.head.prepend(sheet);
					const before = read();
					document.head.append(sheet);
					return { before, after: read() };
				} finally {
					document.head.insertBefore(sheet, next);
					document.body.className = originalTheme;
				}
			})()`);

			expect(styles.before).toHaveLength(2);
			expect(styles.before.map((style) => style.opacity)).toEqual(["1", "1"]);
			expect(styles.after).toEqual(styles.before);
		},
	);

	test("a video with a long queue keeps its 16:9 frame, compact and wide, and after a panel covered it", async () => {
		const { obsidian } = getContext();
		await openPlayer(QUEUED, () => ({ mediaType: "video" }));
		await click(obsidian, ui.playbackToggle);
		await waitForPlayback(
			obsidian,
			(playback) => playback.playing && playback.seconds > 0.5,
			"the video playing",
		);

		await resizeView(320, "compact");
		await expectVideoFrame("compact", 250);
		await click(obsidian, ui.playerPanel("Up next"));
		expect(await eventually(obsidian, upNext, titles(QUEUED))).toEqual(titles(QUEUED));
		expect(await videoStage(), "Up next covers the stage").toBeNull();
		await click(obsidian, ui.playerPanel("Up next"));
		await expectVideoFrame("compact, after Up next", 250);

		await resizeView(820, "wide");
		expect(await eventually(obsidian, upNext, titles(QUEUED)), "Up next beside it").toEqual(
			titles(QUEUED),
		);
		await expectVideoFrame("wide, beside 30 queued episodes", 300);
		await waitForPlayback(
			obsidian,
			(playback) => playback.playing && playback.media?.paused === false,
			"the video still playing",
		);
	});

	test("Up next reorders the queue in place, writing data.json once per completed move", async () => {
		const { obsidian } = getContext();
		await openPlayer([ONE, TWO, THREE, FOUR]);
		await click(obsidian, ui.playerPanel("Up next"));
		await waitUntilShown(obsidian, ui.queueGrip(ONE.title));
		const writes = await recordWrites(obsidian);

		const mouse = await pressMouse(obsidian, await pointOn(obsidian, ui.queueGrip(ONE.title)));
		for (const [row, shown] of [
			[TWO, [TWO, ONE, THREE, FOUR]],
			[THREE, [TWO, THREE, ONE, FOUR]],
		] as const) {
			await mouse.moveTo(await pointOn(obsidian, ui.queueRow(row.title), "bottom"), 4);
			// Long enough for a save the crossing started to finish.
			expect(await holdsFor(obsidian, upNext, titles(shown), 1000)).toEqual(titles(shown));
		}
		await mouse.release();
		await expectQueue(titles([TWO, THREE, ONE, FOUR]));

		await click(obsidian, ui.queueGrip(FOUR.title));
		await pressKey(obsidian, "ArrowUp");
		await expectQueue(titles([TWO, THREE, FOUR, ONE]));
		expect(await writes.stop()).toMatchObject({
			attempted: 2,
			completed: 2,
			failed: 0,
			intact: true,
		});
		expect(await isShown(obsidian, ui.fullPlayer), "the player stays open").toBe(true);
	});

	test("#394 a local file shows its file tile, not a broken image, in the player and the mini player", async () => {
		const context = getContext();
		const { obsidian, sandbox } = context;
		await seedLibrary(context, null);
		await obsidian.plugin("file-explorer").enable({ filter: "core" });
		const audioPath = sandbox.path("Tile Lecture.wav");
		await writeVaultFile(obsidian, audioPath, wav(30));
		await closePodNotes(obsidian);

		await revealInFileExplorer(obsidian, audioPath);
		await click(obsidian, ui.fileExplorerItem(audioPath), { button: "right" });
		await click(obsidian, ui.menuItem("Play with PodNotes"));
		await waitForPlayback(
			obsidian,
			(playback) => playback.episode?.title === "Tile Lecture" && playback.seconds > 0,
			"the local file playing",
		);
		if (!(await isShown(obsidian, ui.fullPlayer))) await click(obsidian, ui.openPlayer);
		await waitUntilShown(obsidian, ui.fullPlayer);

		const artwork = (where: string) =>
			obsidian.dev.evalJson<{
				images: number;
				broken: number;
				tile: { icon: string | null; width: number; height: number } | null;
			}>(`(() => {
				const root = document.querySelector(${jsLiteral(`.workspace-leaf-content[data-type="${VIEW_TYPE}"] ${where}`)});
				const images = [...root.querySelectorAll("img")];
				const tile = root.querySelector(".pn-filetile");
				const box = tile?.getBoundingClientRect();
				return {
					images: images.length,
					broken: images.filter((img) => img.complete && img.naturalWidth === 0).length,
					tile: tile && { icon: tile.querySelector("svg")?.getAttribute("class") ?? null, width: Math.round(box.width), height: Math.round(box.height) },
				};
			})()`);
		const player = await artwork(".pn-player .pn-stage");
		expect(player).toMatchObject({ images: 0, broken: 0 });
		expect(player.tile?.icon).toContain("lucide-music");
		expect(player.tile?.width, "the tile has the artwork's size").toBeGreaterThanOrEqual(200);
		expect(player.tile?.height).toBe(player.tile?.width);

		await click(obsidian, ui.collapsePlayer);
		await waitUntilShown(obsidian, ui.miniPlayer);
		const mini = await artwork(".pn-mini");
		expect(mini).toMatchObject({ images: 0, broken: 0 });
		expect(mini.tile?.icon).toContain("lucide-music");
		expect(mini.tile?.width).toBe(mini.tile?.height);
	});

	test("a media error offers Retry in place of the artwork and turns the transport off", async () => {
		const { obsidian } = getContext();
		await openPlayer([ONE], (server) => ({
			streamUrl: `${server.mediaUrl(FEED, NOW)}.missing`,
		}));
		const state = () =>
			obsidian.dev.evalJson<{
				alert: string;
				retry: boolean;
				transportOff: boolean[];
			}>(`(() => {
				const player = document.querySelector(${jsLiteral(`${PLAYER_VIEW} section.pn-player`)});
				return {
					alert: player.querySelector('[role="alert"] > span:not(:has(svg))')?.textContent.trim() ?? "",
					retry: [...player.querySelectorAll("button")].some((button) => button.textContent.trim() === "Retry" && !button.disabled),
					transportOff: [...player.querySelectorAll(".pn-transport button")].map((button) => button.disabled),
				};
			})()`);
		expect(await state(), "before the load").toEqual({
			alert: "",
			retry: false,
			transportOff: [false, false, false, false, false],
		});

		await click(obsidian, ui.playbackToggle);

		const failed = {
			alert: "Could not load this episode's media.",
			retry: true,
			transportOff: [true, true, true, true, true],
		};
		expect(await eventually(obsidian, state, failed, 10_000)).toEqual(failed);
	});

	test("Space pauses and plays with the focus on the player's text, and the podcast's name opens its page", async () => {
		const { obsidian } = getContext();
		await openPlayer([ONE]);
		await click(obsidian, ui.playbackToggle);
		await waitForPlayback(obsidian, (playback) => playback.seconds > 0.5, "playing");

		await click(obsidian, ui.playerTitle);
		expect(
			await obsidian.dev.evalJson<string>(
				'document.activeElement.closest("button, input, a, [role=slider]")?.outerHTML ?? "none"',
			),
			"the focused control",
		).toBe("none");
		await pressKey(obsidian, "Space");
		await waitForPlayback(obsidian, (playback) => !playback.playing, "paused by Space");
		await pressKey(obsidian, "Space");
		await waitForPlayback(obsidian, (playback) => playback.playing, "playing again by Space");

		await click(obsidian, ui.playerPodcast);
		await waitUntilShown(obsidian, ui.podcastPage(FEED.title));
		expect(await isShown(obsidian, ui.fullPlayer), "the player collapsed").toBe(false);
	});

	test("Escape closes the episode menu, then the volume slider, then the player, with a note open beside it", async () => {
		const { obsidian, sandbox } = getContext();
		const note = sandbox.path("Beside the player.md");
		await writeVaultFile(obsidian, note, "A note in the main area\n");
		await openInEditor(obsidian, note);
		await openPlayer([ONE]);
		await click(obsidian, ui.playerVolume);
		await waitUntilShown(obsidian, ui.volumeSlider);
		// Tab to the menu button, which leaves the slider open; a click outside would close it.
		await obsidian.dev.evalJson(
			`(${ui.playerControl("Episode options").elements})[0].focus(), true`,
		);
		// A key press activates a button only with the text it types.
		const enter = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 };
		await cdp(obsidian, "Input.dispatchKeyEvent", { type: "keyDown", text: "\r", ...enter });
		await cdp(obsidian, "Input.dispatchKeyEvent", { type: "keyUp", ...enter });
		await waitUntilShown(obsidian, ui.menuItem("Add to queue"));
		// Obsidian gives a menu the keys a timer tick after it shows; an Escape before then
		// goes to the view under it.
		await obsidian.waitFor(
			() =>
				obsidian.dev.evalJson<boolean>(
					'(app.keymap.getWindowStack(activeWindow).scope.keys ?? []).some((key) => key.key === "ArrowDown")',
				),
			{ timeoutMs: 5_000, intervalMs: 50, message: "the menu to take the keys" },
		);

		await pressKey(obsidian, "Escape");
		expect(
			await eventually(obsidian, () => isShown(obsidian, ui.menuItem("Add to queue")), false),
		).toBe(false);
		expect(
			await holdsFor(obsidian, () => isShown(obsidian, ui.fullPlayer), true, 1000),
			"the player stays open after the menu closes",
		).toBe(true);
		expect(await isShown(obsidian, ui.volumeSlider), "the slider stays open").toBe(true);
		expect(await focused(ui.playerControl("Episode options"))).toBe(true);

		await pressKey(obsidian, "Escape");
		expect(await eventually(obsidian, () => isShown(obsidian, ui.volumeSlider), false)).toBe(
			false,
		);
		expect(await holdsFor(obsidian, () => isShown(obsidian, ui.fullPlayer), true, 500)).toBe(
			true,
		);
		await waitUntilFocused(obsidian, ui.playerVolume);

		await pressKey(obsidian, "Escape");
		await waitUntilShown(obsidian, ui.miniPlayer);
		expect(await isShown(obsidian, ui.fullPlayer)).toBe(false);
		await waitUntilFocused(obsidian, ui.openPlayer);
	});

	test("#467 keys typed in a note reach it while the full player is open", async () => {
		const { obsidian, sandbox } = getContext();
		const note = sandbox.path("Find in note.md");
		await writeVaultFile(obsidian, note, "alpha one\nalpha two\nalpha three\n");
		await openInEditor(obsidian, note);
		await openPlayer([ONE]);
		await clickInEditor(obsidian, note, 0, 0);
		const search = () =>
			obsidian.dev.evalJson<{ open: boolean; count: string | null }>(`(() => {
				const leaf = app.workspace.getLeavesOfType("markdown").find((leaf) => leaf.view.file?.path === ${jsLiteral(note)});
				const bar = leaf.view.containerEl.querySelector(".document-search-container");
				return { open: Boolean(bar), count: bar?.querySelector(".document-search-count")?.textContent ?? null };
			})()`);
		await pressHotkey(obsidian, "f");
		await typeText(obsidian, "alpha");
		expect(await eventually(obsidian, search, { open: true, count: "1 / 3" })).toEqual({
			open: true,
			count: "1 / 3",
		});

		await pressKey(obsidian, "Enter");
		expect(await eventually(obsidian, search, { open: true, count: "2 / 3" }), "Enter").toEqual(
			{ open: true, count: "2 / 3" },
		);
		await pressKey(obsidian, "Escape");
		expect(await eventually(obsidian, search, { open: false, count: null }), "Escape").toEqual({
			open: false,
			count: null,
		});
		expect(await isShown(obsidian, ui.fullPlayer), "the player stays open").toBe(true);
	});

	test("#467 Space and Escape typed in a plain note or a new tab leave the full player open and paused", async () => {
		const { obsidian, sandbox } = getContext();
		const note = sandbox.path("Plain note.md");
		await writeVaultFile(obsidian, note, "A plain note\n");
		await openInEditor(obsidian, note);
		await openPlayer([ONE]);
		expect(await clickInEditor(obsidian, note, 0, 12)).toEqual({ line: 0, ch: 12 });
		const text = () =>
			obsidian.dev.evalJson<string>(
				`app.workspace.getLeavesOfType("markdown").find((leaf) => leaf.view.file?.path === ${jsLiteral(note)}).view.editor.getValue()`,
			);
		const activeView = () =>
			obsidian.dev.evalJson<string>("app.workspace.activeLeaf.view.getViewType()");
		const playerAsItWas = async (after: string) => {
			expect(
				await holdsFor(obsidian, () => isShown(obsidian, ui.fullPlayer), true, 1000),
				`${after}: the player stays open`,
			).toBe(true);
			expect(
				await holdsFor(
					obsidian,
					async () => (await observePlayback(obsidian)).playing,
					false,
					500,
				),
				`${after}: still paused`,
			).toBe(false);
		};

		await pressKey(obsidian, "Space");
		expect(await eventually(obsidian, text, "A plain note \n"), "Space types in the note").toBe(
			"A plain note \n",
		);
		await playerAsItWas("Space in the note");
		await pressKey(obsidian, "Escape");
		await playerAsItWas("Escape in the note");

		await pressHotkey(obsidian, "t");
		expect(await eventually(obsidian, activeView, "empty")).toBe("empty");
		await pressKey(obsidian, "Space");
		await playerAsItWas("Space in the new tab");
		await pressKey(obsidian, "Escape");
		await playerAsItWas("Escape in the new tab");
		expect(await activeView(), "the new tab stays active").toBe("empty");
		expect(await text(), "the note is as Space left it").toBe("A plain note \n");
	});
});
