import { describe, expect, onTestFinished, test } from "vitest";
import { FIXTURE_HOST, SUPERCAST_FIXTURE_HOST } from "../../scripts/e2e-instance.mjs";
import { createPodNotesE2EHarness } from "./harness";
import {
	asPhone,
	closePopoutAndReload,
	dismissNotices,
	moveViewToPopout,
	runCommand,
	placePodNotes,
	setOffline,
	showAddPodcast,
	showLibrary,
	showPodNotes,
} from "./journey/actions";
import { accessibleName, click, pressKey, typeInto, typeText } from "./journey/input";
import { PLAYER_VIEW, ui, type UiTarget } from "./journey/targets";
import { eventually, isDisabled, isShown, notices, waitUntilShown } from "./journey/wait";
import {
	type FixtureEpisode,
	type FixtureFeed,
	type FixtureServer,
	pubDate,
	startFixtureServer,
} from "./journey/fixtures";
import {
	readVaultText,
	seedLibrary,
	storedEpisode,
	waitForLibrary,
	waitForPlayback,
	writeVaultFile,
} from "./journey/library";
import { jsLiteral, PLUGIN_ID, VIEW_TYPE } from "./runtime";

const getContext = createPodNotesE2EHarness("journey-transcript");

const CUES: ReadonlyArray<readonly [string, string]> = [
	["Maya Lind", "Welcome back to Field Notes."],
	["Maya Lind", "Today we build a memory palace together."],
	["Ana Ilic", "Where does the palace start?"],
	["Ana Ilic", "At your own front door."],
	["Maya Lind", "Then every room holds one idea."],
	["Maya Lind", "The stranger the image, the longer it stays."],
	["Ana Ilic", "And spaced repetition does the rest."],
	["Ana Ilic", "Walk the Palace again a day later."],
	["Maya Lind", "Then a week later, then a month later."],
	["Maya Lind", "That is the whole method."],
];
const LINES = CUES.map(([, text]) => text);
const clock = (seconds: number) => `00:00:${String(seconds).padStart(2, "0")}.000`;
const VTT = `WEBVTT\n\n${CUES.map(
	([speaker, text], index) =>
		`${clock(index * 6)} --> ${clock(index * 6 + 6)}\n<v ${speaker}>${text}`,
).join("\n\n")}\n`;

const CAPTIONED: FixtureEpisode = {
	title: "Memory Palaces",
	seconds: 60,
	pubDate: pubDate(0),
	transcripts: [{ path: "1.vtt", type: "text/vtt", body: VTT }],
};
const PLAIN: FixtureEpisode = { title: "No Captions", seconds: 60, pubDate: pubDate(1) };
const FEED: FixtureFeed = {
	title: "Journey Transcript",
	slug: "transcript",
	artwork: true,
	episodes: [CAPTIONED, PLAIN],
};
const NOTE_PATH = `Transcripts/${FEED.title}/${CAPTIONED.title}.md`;

const TRANSCRIPT_LIST = `[...document.querySelectorAll(${jsLiteral(`${PLAYER_VIEW} section.pn-player ol[aria-labelledby]`)})].find((ol) => document.getElementById(ol.getAttribute("aria-labelledby"))?.textContent === "Transcript")`;
const panelButton = (label: string): UiTarget => ({
	name: `transcript panel's ${label}`,
	elements: `[...document.querySelectorAll(${jsLiteral(`${PLAYER_VIEW} section.pn-player .pn-panel button`)})].filter((el) => el.getAttribute("aria-label") === ${jsLiteral(label)} || el.textContent.trim().startsWith(${jsLiteral(label)}))`,
});
const line = (text: string): UiTarget => ({
	name: `transcript line ${text}`,
	elements: `[...(${TRANSCRIPT_LIST})?.querySelectorAll("button") ?? []].filter((el) => el.lastElementChild?.textContent.trim() === ${jsLiteral(text)})`,
});
const followChip: UiTarget = {
	name: "Follow chip",
	elements: `[...document.querySelectorAll(${jsLiteral(`${PLAYER_VIEW} section.pn-player .pn-tx-follow`)})]`,
};
const findField: UiTarget = {
	name: "Find in transcript field",
	elements: `[...document.querySelectorAll(${jsLiteral(`${PLAYER_VIEW} section.pn-player input[aria-label="Find in transcript"]`)})]`,
};

type ShownTranscript = Readonly<{
	lines: string[];
	current: string | null;
	hit: string | null;
	marks: string[];
}>;

async function shownTranscript(): Promise<ShownTranscript> {
	return await getContext().obsidian.dev.evalJson<ShownTranscript>(`(() => {
		const list = ${TRANSCRIPT_LIST};
		const text = (row) => row?.lastElementChild?.textContent.trim() ?? null;
		const rows = list ? [...list.querySelectorAll("li > :last-child")] : [];
		return {
			lines: rows.map(text),
			current: text(list?.querySelector("[aria-current='true']")),
			hit: text(list?.querySelector(".is-hit")),
			marks: list ? [...list.querySelectorAll("mark")].map((mark) => mark.textContent) : [],
		};
	})()`);
}

async function serve(): Promise<FixtureServer> {
	const server = await startFixtureServer([FEED]);
	onTestFinished(() => server.stop());
	return server;
}

type Placement = Readonly<{
	view: boolean;
	notes: ReadonlyArray<Readonly<{ path: string; where: string; shown: boolean }>>;
}>;

/**
 * Whether the view is in sight, and each leaf that shows one of `paths`: in the view's own tab
 * group, beside the view in its window or sidebar, else in the main area, another popout or a
 * sidebar. In sight means shown, and inside its window: a stacked tab group shows every tab,
 * scrolled out of the window or not.
 */
async function placement(paths: readonly string[]): Promise<Placement> {
	return await getContext().obsidian.dev.evalJson<Placement>(`(() => {
		const { workspace } = app;
		const view = workspace.getLeavesOfType(${jsLiteral(VIEW_TYPE)})[0];
		const where = (leaf) =>
			leaf.getContainer() === view.getContainer() && leaf.getRoot() === view.getRoot()
				? leaf.parent === view.parent
					? "the view's tabs"
					: "beside the view"
				: leaf.getRoot() === workspace.rootSplit
					? "main area"
					: leaf.getRoot() === workspace.floatingSplit
						? "another popout"
						: "sidebar";
		const inSight = (leaf) => {
			const el = leaf.view.containerEl;
			const box = el.getBoundingClientRect();
			return el.isShown() && box.width > 0 && box.left >= 0 && box.right <= el.win.innerWidth + 1;
		};
		const notes = [];
		workspace.iterateAllLeaves((leaf) => {
			const path = leaf.view.file?.path;
			if (${jsLiteral(paths)}.includes(path))
				notes.push({ path, where: where(leaf), shown: inSight(leaf) });
		});
		return { view: inSight(view), notes };
	})()`);
}

/** Deletes the notes at `paths` once the test ends. */
function deleteWhenDone(paths: readonly string[]): void {
	onTestFinished(() =>
		getContext().obsidian.dev.evalJsonAsync(`(async () => {
			for (const path of ${jsLiteral(paths)}) {
				const file = app.vault.getFileByPath(path);
				if (file) await app.vault.delete(file);
			}
			return true;
		})()`),
	);
}

/** Waits until the leaf in focus shows `path`, as once a note opens. */
async function waitForOpened(path: string): Promise<void> {
	const { obsidian } = getContext();
	await obsidian.waitFor(
		() =>
			obsidian.dev.evalJson<boolean>(
				`app.workspace.activeLeaf?.view.file?.path === ${jsLiteral(path)}`,
			),
		{ timeoutMs: 30_000, intervalMs: 100, message: `${path} opened` },
	);
}

/** Presses what `selector` matches in the PodNotes view's popout window, with real input. */
async function pressInPopout(selector: string, text = ""): Promise<void> {
	const pressed = await getContext().obsidian.dev.evalJsonAsync<boolean>(`(async () => {
		const remote = require("@electron/remote");
		const view = app.workspace.getLeavesOfType(${jsLiteral(VIEW_TYPE)})[0];
		const doc = view.view.containerEl.ownerDocument;
		let win;
		for (const each of remote.BrowserWindow.getAllWindows())
			if (await each.webContents.executeJavaScript(${jsLiteral(`Boolean(document.querySelector(${jsLiteral(PLAYER_VIEW)}))`)})) win = each;
		for (let i = 0; i < 50; i++) {
			const target = [...doc.querySelectorAll(${jsLiteral(selector)})].find(
				(each) => each.offsetParent && (!${jsLiteral(text)} || each.textContent.trim() === ${jsLiteral(text)}),
			);
			if (target) {
				const box = target.getBoundingClientRect();
				const point = { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
				win.webContents.sendInputEvent({ type: "mouseMove", ...point });
				for (const type of ["mouseDown", "mouseUp"])
					win.webContents.sendInputEvent({ type, ...point, button: "left", clickCount: 1 });
				return true;
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		return false;
	})()`);
	if (!pressed) throw new Error(`Nothing to press at ${selector} ${text} in the popout.`);
}

/** Closes every leaf that shows `path`, as a user closes its tab. */
async function closeNote(path: string): Promise<void> {
	await getContext().obsidian.dev.evalJson(`(() => {
		const leaves = [];
		app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view.file?.path === ${jsLiteral(path)}) leaves.push(leaf);
		});
		for (const leaf of leaves) leaf.detach();
		return true;
	})()`);
}

/** The full player wide, so every line shows and none needs a scroll that stops following. */
async function openTranscript(episode: FixtureEpisode): Promise<FixtureServer> {
	const context = getContext();
	const server = await serve();
	await seedLibrary(context, server, {
		subscriptions: [FEED],
		current: storedEpisode(server, FEED, episode),
	});
	await placePodNotes(context.obsidian, { sidebar: 820 });
	if (!(await isShown(context.obsidian, ui.fullPlayer)))
		await click(context.obsidian, ui.openPlayer);
	await waitUntilShown(context.obsidian, ui.fullPlayer);
	await click(context.obsidian, ui.playerPanel("Transcript"));
	return server;
}

async function takeNote(): Promise<string> {
	const { obsidian, sandbox } = getContext();
	await sandbox.waitForExists(NOTE_PATH, { timeoutMs: 30_000 });
	await obsidian.waitFor(
		async () =>
			(await notices(obsidian)).some((notice) =>
				notice.endsWith("Saved the transcript the feed publishes."),
			),
		{ timeoutMs: 10_000, intervalMs: 100, message: "the transcription finished" },
	);
	const text = await readVaultText(obsidian, sandbox.path(NOTE_PATH));
	await obsidian.dev.evalJsonAsync(`(async () => {
		await app.vault.delete(app.vault.getAbstractFileByPath(${jsLiteral(sandbox.path(NOTE_PATH))}));
		return true;
	})()`);
	await dismissNotices(obsidian);
	return text.replace(/^Date: .+$/m, "Date: <date>");
}

type Box = Readonly<{ top: number; bottom: number; width: number; height: number }>;
type PhoneGeometry = Readonly<{
	stage: Box;
	art: Box | null;
	panel: Box | null;
	list: Box | null;
	controls: number;
	navbar: number;
}>;

/** Where the full player lays out its stage and deck on the phone, against Obsidian's navbar. */
function phoneGeometry(): Promise<PhoneGeometry> {
	return getContext().obsidian.dev.evalJson<PhoneGeometry>(`(() => {
		const player = document.querySelector(${jsLiteral(`${PLAYER_VIEW} section.pn-player`)});
		const box = (el) => {
			if (!el) return null;
			const { top, bottom, width, height } = el.getBoundingClientRect();
			return { top, bottom, width, height };
		};
		return {
			stage: box(player.querySelector(".pn-stage")),
			art: box(player.querySelector(".pn-stage > .pn-cover")),
			panel: box(player.querySelector(".pn-stage .pn-panel")),
			list: box(player.querySelector(".pn-stage .pn-panel-scroll")),
			controls: Math.max(...[...player.querySelectorAll(".pn-deck button")].map((button) => button.getBoundingClientRect().bottom)),
			navbar: document.querySelector(".mobile-navbar").getBoundingClientRect().top,
		};
	})()`);
}

type TranscriptHead = Readonly<{
	panel: number;
	saveInside: boolean;
	label: boolean;
	headFits: boolean;
	name?: string;
	ariaLabel: boolean;
}>;

const SAVE = `document.querySelector(${jsLiteral(`${PLAYER_VIEW} section.pn-player .pn-panel-head .pn-tx-save`)})`;

/**
 * How the transcript panel's head fits the panel: Save inside it, with its label in sight or
 * not, the name Chromium gives Save, and whether it has an aria-label, which Obsidian shows as a tooltip.
 */
async function transcriptHead(): Promise<TranscriptHead> {
	const { obsidian } = getContext();
	const head = await obsidian.dev.evalJson<TranscriptHead>(`(() => {
		const save = ${SAVE};
		const panel = save.closest(".pn-panel");
		const head = save.parentElement;
		const label = save.lastElementChild.getBoundingClientRect();
		const shown = label.width > 1;
		const box = panel.getBoundingClientRect();
		const right = Math.max(save.getBoundingClientRect().right, shown ? label.right : 0);
		return {
			panel: Math.round(box.width),
			saveInside: right <= box.right + 0.5,
			label: shown,
			headFits: head.scrollWidth <= head.clientWidth,
			ariaLabel: save.hasAttribute("aria-label"),
		};
	})()`);
	return { ...head, name: (await accessibleName(obsidian, SAVE))?.name };
}

type Followed = Readonly<{ line: string; clear: boolean; cut: boolean; rows: number[] }>;

/**
 * The line playing now, whether it and the line before it show whole, below the list's faded
 * top 12 px and above its faded bottom 20 px, and whether a line shows cut where the top fade
 * ends.
 */
function followed(): Promise<Followed> {
	return getContext().obsidian.dev.evalJson<Followed>(`(() => {
		const list = ${TRANSCRIPT_LIST};
		const top = list.getBoundingClientRect().top;
		const now = list.querySelector("[aria-current='true']").closest("li");
		const [before, after] = [now.previousElementSibling, now].map((row) => row.getBoundingClientRect());
		return {
			line: now.lastElementChild.lastElementChild.textContent.trim(),
			clear: before.top - top > 11.5 && after.bottom - top < list.clientHeight - 19.5,
			cut: [...list.children].some((row) => {
				const box = row.getBoundingClientRect();
				return box.top - top < 11.5 && box.bottom - top > 12.5;
			}),
			rows: [before.top - top, after.top - top, after.bottom - top, list.clientHeight].map(Math.round),
		};
	})()`);
}

/** The full player's Transcript panel, once it lists every line. */
async function openTranscriptPanel(): Promise<void> {
	const { obsidian } = getContext();
	if (!(await isShown(obsidian, ui.fullPlayer))) await click(obsidian, ui.openPlayer);
	await waitUntilShown(obsidian, ui.fullPlayer);
	await click(obsidian, ui.playerPanel("Transcript"));
	await eventually(obsidian, async () => (await shownTranscript()).lines, LINES, 15_000);
}

describe("transcript journeys", () => {
	test("switching episodes clears Find and shows every line of the incoming transcript", async () => {
		const context = getContext();
		const { obsidian } = context;
		const incoming: FixtureEpisode = {
			title: "Second Transcript",
			seconds: 60,
			pubDate: pubDate(2),
			transcripts: [{ path: "2.vtt", type: "text/vtt", body: VTT }],
		};
		const feed = { ...FEED, episodes: [...FEED.episodes, incoming] };
		const server = await startFixtureServer([feed]);
		onTestFinished(() => server.stop());
		await seedLibrary(context, server, {
			subscriptions: [feed],
			current: storedEpisode(server, feed, CAPTIONED),
			queue: [storedEpisode(server, feed, incoming)],
		});
		await placePodNotes(obsidian, { sidebar: 820 });
		if (!(await isShown(obsidian, ui.fullPlayer))) await click(obsidian, ui.openPlayer);
		await click(obsidian, ui.playerPanel("Transcript"));
		expect(
			await eventually(obsidian, async () => (await shownTranscript()).lines, LINES),
		).toEqual(LINES);
		await click(obsidian, panelButton("Find in transcript"));
		await typeText(obsidian, "palace");
		expect(
			await eventually(obsidian, async () => (await shownTranscript()).marks, [
				"palace",
				"palace",
				"Palace",
			]),
		).toEqual(["palace", "palace", "Palace"]);

		await obsidian.dev.evalJson(
			`app.plugins.plugins.podnotes.player.play(${jsLiteral(storedEpisode(server, feed, incoming))}), true`,
		);
		await waitForPlayback(
			obsidian,
			(state) => state.episode?.title === incoming.title && state.playing,
			"incoming episode playing",
		);
		expect(
			await eventually(obsidian, shownTranscript, {
				lines: LINES,
				current: LINES[0],
				hit: null,
				marks: [],
			}),
		).toEqual({ lines: LINES, current: LINES[0], hit: null, marks: [] });
		expect(await isShown(obsidian, findField)).toBe(false);
		await click(obsidian, panelButton("Find in transcript"));
		expect(await obsidian.dev.evalJson(`(${findField.elements})[0].value`)).toBe("");
	});

	test("the feed's transcript follows playback, seeks where tapped, finds a word, and saves the command's note", async () => {
		const { obsidian } = getContext();
		await openTranscript(CAPTIONED);
		const all = { lines: LINES, current: LINES[0], hit: null, marks: [] };
		expect(await eventually(obsidian, shownTranscript, all, 15_000)).toEqual(all);

		await click(obsidian, ui.playbackToggle);
		await waitForPlayback(obsidian, (playback) => playback.playing, "playing from the start");
		const second = { ...all, current: LINES[1] };
		expect(
			await eventually(obsidian, shownTranscript, second, 15_000),
			"the current line follows playback",
		).toEqual(second);

		await click(obsidian, line(LINES[6]));
		const landed = await waitForPlayback(
			obsidian,
			(playback) => playback.playing && playback.seconds >= 36 && playback.seconds < 40,
			"playing from the tapped line",
		);
		await waitForPlayback(
			obsidian,
			(playback) => playback.playing && playback.seconds > landed.seconds + 0.5,
			"playback continues past the tapped line",
		);
		expect((await shownTranscript()).current).toBe(LINES[6]);
		await click(obsidian, ui.playbackToggle);
		await waitForPlayback(obsidian, (playback) => !playback.playing, "paused");

		await click(obsidian, panelButton("Find in transcript"));
		await waitUntilShown(obsidian, findField);
		await typeText(obsidian, "PALACE");
		const found = {
			lines: [LINES[1], LINES[2], LINES[7]],
			current: null,
			hit: LINES[1],
			marks: ["palace", "palace", "Palace"],
		};
		expect(await eventually(obsidian, shownTranscript, found), "Find").toEqual(found);
		await pressKey(obsidian, "Enter");
		expect((await eventually(obsidian, shownTranscript, { ...found, hit: LINES[2] })).hit).toBe(
			LINES[2],
		);
		await pressKey(obsidian, "Escape");
		expect(await eventually(obsidian, () => isShown(obsidian, findField), false)).toBe(false);
		expect(await isShown(obsidian, ui.fullPlayer), "Escape closes Find, not the player").toBe(
			true,
		);
		expect((await shownTranscript()).lines).toEqual(LINES);

		await dismissNotices(obsidian);
		await click(obsidian, panelButton("Save as note"));
		const fromPanel = await takeNote();
		await runCommand(obsidian, `${PLUGIN_ID}:podnotes-transcribe`);
		const fromCommand = await takeNote();
		expect(fromPanel).toMatch(
			/^# Memory Palaces\n\nPodcast: Journey Transcript\nDate: <date>\n/,
		);
		expect(fromPanel).toContain("Today we build a memory palace together.");
		expect(fromPanel).toBe(fromCommand);
	}, 120_000);

	test("J-TR-04 a transcript saved before opens from the panel, offline too, unchanged and with no download", async () => {
		const { obsidian, sandbox } = getContext();
		const server = await openTranscript(CAPTIONED);
		await eventually(obsidian, async () => (await shownTranscript()).lines, LINES, 15_000);
		const saved = "# Memory Palaces\n\nSaved before, by hand.\n";
		await writeVaultFile(obsidian, sandbox.path(NOTE_PATH), saved);
		onTestFinished(() =>
			obsidian.dev.evalJsonAsync(`(async () => {
				await app.vault.delete(app.vault.getFileByPath(${jsLiteral(sandbox.path(NOTE_PATH))}));
				return true;
			})()`),
		);
		await waitUntilShown(obsidian, panelButton("Open note"));
		const requests = server.requests().length;
		await setOffline(obsidian, true);
		onTestFinished(() => setOffline(obsidian, false));

		await click(obsidian, panelButton("Open note"));

		expect(
			await eventually(
				obsidian,
				() =>
					obsidian.dev.evalJson<string | null>(
						"app.workspace.getActiveFile()?.path ?? null",
					),
				sandbox.path(NOTE_PATH),
			),
		).toBe(sandbox.path(NOTE_PATH));
		expect(await readVaultText(obsidian, sandbox.path(NOTE_PATH))).toBe(saved);
		expect(server.requests().length, "no request").toBe(requests);
	});

	test("in the main area, a note PodNotes opens goes beside the view, which stays in sight, and in a sidebar to the main area", async () => {
		const context = getContext();
		const { obsidian, sandbox } = context;
		const server = await serve();
		await seedLibrary(context, server, {
			subscriptions: [FEED],
			current: storedEpisode(server, FEED, CAPTIONED),
		});
		const transcript = sandbox.path(NOTE_PATH);
		const episodeNote = sandbox.path(`PodNotes/${FEED.title}/${CAPTIONED.title}.md`);
		const podcastNote = sandbox.path(`PodNotes/Podcasts/${FEED.title}.md`);
		const behind = sandbox.path("Behind the view.md");
		deleteWhenDone([transcript, episodeNote, podcastNote, behind]);
		await writeVaultFile(obsidian, behind, "A note in a tab behind the view.\n");
		await placePodNotes(obsidian, "main area");
		await obsidian.dev.evalJsonAsync(`(async () => {
			const { workspace } = app;
			const view = workspace.getLeavesOfType(${jsLiteral(VIEW_TYPE)})[0];
			const others = [];
			workspace.iterateRootLeaves((leaf) => {
				if (leaf !== view) others.push(leaf);
			});
			for (const leaf of others) leaf.detach();
			const tab = workspace.createLeafInParent(view.parent, 0);
			await tab.openFile(app.vault.getFileByPath(${jsLiteral(behind)}), { active: false });
			workspace.setActiveLeaf(view, { focus: true });
			return true;
		})()`);
		if (!(await isShown(obsidian, ui.fullPlayer))) await click(obsidian, ui.openPlayer);
		await waitUntilShown(obsidian, ui.fullPlayer);
		await click(obsidian, ui.playerPanel("Transcript"));
		await eventually(obsidian, async () => (await shownTranscript()).lines, LINES, 15_000);
		const notes = [transcript, episodeNote, podcastNote];
		const beside = (path: string) => ({
			view: true,
			notes: [{ path, where: "beside the view", shown: true }],
		});

		await dismissNotices(obsidian);
		await click(obsidian, panelButton("Save as note"));
		await waitForOpened(transcript);
		expect(await placement(notes), "Save as note").toEqual(beside(transcript));
		await dismissNotices(obsidian);
		await click(obsidian, panelButton("Open note"));
		await waitForOpened(transcript);
		expect(await placement(notes), "Open note reuses the split").toEqual(beside(transcript));

		await closeNote(transcript);
		await click(obsidian, panelButton("Open note"));
		await waitForOpened(transcript);
		expect(await placement(notes), "Open note").toEqual(beside(transcript));

		await closeNote(transcript);
		await click(obsidian, ui.playerControl("Episode options"));
		await click(obsidian, ui.menuItem("Create note"));
		await waitForOpened(episodeNote);
		expect(await placement(notes), "Create note").toEqual(beside(episodeNote));

		await closeNote(episodeNote);
		await click(obsidian, ui.collapsePlayer);
		await click(obsidian, ui.podcastCard(FEED.title));
		await click(obsidian, ui.podcastOptions);
		await click(obsidian, ui.menuItem("Create podcast note"));
		await waitForOpened(podcastNote);
		expect(await placement(notes), "Create podcast note").toEqual(beside(podcastNote));

		await closeNote(podcastNote);
		await placePodNotes(obsidian, { sidebar: 320 });
		if (!(await isShown(obsidian, ui.fullPlayer))) await click(obsidian, ui.openPlayer);
		await click(obsidian, ui.playerControl("Episode options"));
		await click(obsidian, ui.menuItem("Open note"));
		await waitForOpened(episodeNote);
		expect(await placement(notes), "Open note in a sidebar").toEqual({
			view: true,
			notes: [{ path: episodeNote, where: "main area", shown: true }],
		});
	}, 120_000);

	test("with the view stacked with a note, a note PodNotes opens goes beside the view and keeps it in sight, also when the stacked note was active last", async () => {
		const context = getContext();
		const { obsidian, sandbox } = context;
		const server = await serve();
		await seedLibrary(context, server, {
			subscriptions: [FEED],
			current: storedEpisode(server, FEED, CAPTIONED),
		});
		const transcript = sandbox.path(NOTE_PATH);
		const stacked = sandbox.path("Stacked with the view.md");
		deleteWhenDone([transcript, stacked]);
		await writeVaultFile(obsidian, stacked, "A note stacked with the view.\n");
		await placePodNotes(obsidian, "main area");
		const viewTabs = `app.workspace.getLeavesOfType(${jsLiteral(VIEW_TYPE)})[0].parent`;
		await obsidian.dev.evalJsonAsync(`(async () => {
			const { workspace } = app;
			const view = workspace.getLeavesOfType(${jsLiteral(VIEW_TYPE)})[0];
			const others = [];
			workspace.iterateRootLeaves((leaf) => {
				if (leaf !== view) others.push(leaf);
			});
			for (const leaf of others) leaf.detach();
			const tab = workspace.createLeafInParent(view.parent, 0);
			await tab.openFile(app.vault.getFileByPath(${jsLiteral(stacked)}));
			view.parent.setStacked(true);
			workspace.setActiveLeaf(view, { focus: true });
			return true;
		})()`);
		if (!(await isShown(obsidian, ui.fullPlayer))) await click(obsidian, ui.openPlayer);
		await waitUntilShown(obsidian, ui.fullPlayer);
		await click(obsidian, ui.playerPanel("Transcript"));
		await eventually(obsidian, async () => (await shownTranscript()).lines, LINES, 15_000);
		const beside = {
			view: true,
			notes: [{ path: transcript, where: "beside the view", shown: true }],
		};

		await dismissNotices(obsidian);
		await click(obsidian, panelButton("Save as note"));
		await waitForOpened(transcript);
		expect(await placement([transcript]), "Save as note").toEqual(beside);

		await obsidian.dev.evalJson(`(() => {
			const stack = ${viewTabs};
			app.workspace.setActiveLeaf(stack.children.find((leaf) => leaf.view.file?.path === ${jsLiteral(stacked)}));
			return true;
		})()`);
		await dismissNotices(obsidian);
		await click(obsidian, panelButton("Open note"));
		await waitForOpened(transcript);
		expect(await placement([transcript]), "Open note after the stacked note").toEqual(beside);
	});

	test("with a pinned note beside the view, Save as note and Open note leave it and open beside the view", async () => {
		const context = getContext();
		const { obsidian, sandbox } = context;
		const server = await serve();
		await seedLibrary(context, server, {
			subscriptions: [FEED],
			current: storedEpisode(server, FEED, CAPTIONED),
		});
		const transcript = sandbox.path(NOTE_PATH);
		const pinned = sandbox.path("Pinned beside the view.md");
		deleteWhenDone([transcript, pinned]);
		await writeVaultFile(obsidian, pinned, "A pinned note beside the view.\n");
		await placePodNotes(obsidian, "main area");
		await obsidian.dev.evalJsonAsync(`(async () => {
			const { workspace } = app;
			const view = workspace.getLeavesOfType(${jsLiteral(VIEW_TYPE)})[0];
			const others = [];
			workspace.iterateRootLeaves((leaf) => {
				if (leaf !== view) others.push(leaf);
			});
			for (const leaf of others) leaf.detach();
			const beside = workspace.createLeafBySplit(view);
			await beside.openFile(app.vault.getFileByPath(${jsLiteral(pinned)}));
			beside.setPinned(true);
			workspace.setActiveLeaf(view, { focus: true });
			return true;
		})()`);
		if (!(await isShown(obsidian, ui.fullPlayer))) await click(obsidian, ui.openPlayer);
		await waitUntilShown(obsidian, ui.fullPlayer);
		await click(obsidian, ui.playerPanel("Transcript"));
		await eventually(obsidian, async () => (await shownTranscript()).lines, LINES, 15_000);
		const beside = {
			view: true,
			notes: [
				{ path: transcript, where: "beside the view", shown: true },
				{ path: pinned, where: "beside the view", shown: true },
			],
		};

		await dismissNotices(obsidian);
		await click(obsidian, panelButton("Save as note"));
		await waitForOpened(transcript);
		expect(await placement([transcript, pinned]), "Save as note").toEqual(beside);
		await dismissNotices(obsidian);
		await click(obsidian, panelButton("Open note"));
		await waitForOpened(transcript);
		expect(await placement([transcript, pinned]), "Open note").toEqual(beside);
	});

	test("in a popout, a note PodNotes opens goes beside the view, not to a note in another popout, and a later one reuses that split", async () => {
		const context = getContext();
		const { obsidian, sandbox } = context;
		const server = await serve();
		await seedLibrary(context, server, { subscriptions: [FEED] });
		const podcastNote = sandbox.path(`PodNotes/Podcasts/${FEED.title}.md`);
		const elsewhere = sandbox.path("In another popout.md");
		deleteWhenDone([podcastNote, elsewhere]);
		await writeVaultFile(obsidian, podcastNote, `# ${FEED.title}\n`);
		await writeVaultFile(obsidian, elsewhere, "A note in another popout.\n");
		await placePodNotes(obsidian, "main area");
		await click(obsidian, ui.podcastCard(FEED.title));
		await waitUntilShown(obsidian, ui.podcastOptions);
		await obsidian.dev.evalJsonAsync(`(async () => {
			await app.workspace.openPopoutLeaf().openFile(app.vault.getFileByPath(${jsLiteral(elsewhere)}));
			return true;
		})()`);
		await moveViewToPopout(obsidian);
		const beside = {
			view: true,
			notes: [
				{ path: elsewhere, where: "another popout", shown: true },
				{ path: podcastNote, where: "beside the view", shown: true },
			],
		};

		try {
			for (const time of ["first", "again"]) {
				await pressInPopout('button[aria-label="Podcast options"]');
				await pressInPopout(".menu .menu-item", "Open podcast note");
				await waitForOpened(podcastNote);
				expect(
					await placement([podcastNote, elsewhere]),
					`Open podcast note ${time}`,
				).toEqual(beside);
			}
		} finally {
			// A note left in a popout keeps it open after the view leaves.
			await closeNote(elsewhere);
			await closeNote(podcastNote);
			await closePopoutAndReload(obsidian);
		}
	});

	test("on a phone, Save as note and Open note show the transcript note in a tab, as Obsidian opens a link", async () => {
		const context = getContext();
		const { obsidian, sandbox } = context;
		await asPhone(obsidian);
		const server = await serve();
		await seedLibrary(context, server, {
			subscriptions: [FEED],
			current: storedEpisode(server, FEED, CAPTIONED),
		});
		await placePodNotes(obsidian, "main area");
		if (!(await isShown(obsidian, ui.fullPlayer))) await click(obsidian, ui.openPlayer);
		await waitUntilShown(obsidian, ui.fullPlayer);
		await click(obsidian, ui.playerPanel("Transcript"));
		await eventually(obsidian, async () => (await shownTranscript()).lines, LINES, 15_000);
		const transcript = sandbox.path(NOTE_PATH);
		deleteWhenDone([transcript]);

		await dismissNotices(obsidian);
		await click(obsidian, panelButton("Save as note"));
		await waitForOpened(transcript);
		expect(await placement([transcript]), "Save as note").toEqual({
			view: false,
			notes: [{ path: transcript, where: "the view's tabs", shown: true }],
		});

		await obsidian.dev.evalJson(
			`app.workspace.setActiveLeaf(app.workspace.getLeavesOfType(${jsLiteral(VIEW_TYPE)})[0], { focus: true }), true`,
		);
		await dismissNotices(obsidian);
		await click(obsidian, panelButton("Open note"));
		await waitForOpened(transcript);
		expect(await placement([transcript]), "Open note opens a tab of its own").toEqual({
			view: false,
			notes: [
				{ path: transcript, where: "the view's tabs", shown: false },
				{ path: transcript, where: "the view's tabs", shown: true },
			],
		});
	});

	test("an episode whose feed publishes no transcript offers the paid transcription", async () => {
		const { obsidian } = getContext();
		await openTranscript(PLAIN);
		const transcribe = panelButton("Transcribe with OpenAI");
		await waitUntilShown(obsidian, transcribe);

		expect(
			await obsidian.dev.evalJson<string>(
				`(${transcribe.elements})[0].closest(".pn-panel").textContent.replace(/\\s+/g, " ").trim()`,
			),
		).toBe("No transcript in this feed Transcribe with OpenAI Paid");
		expect(await isDisabled(obsidian, transcribe)).toBe(false);
	}, 60_000);

	test("offline, the paid transcription is disabled", async () => {
		const { obsidian } = getContext();
		await openTranscript(PLAIN);
		const transcribe = panelButton("Transcribe with OpenAI");
		await waitUntilShown(obsidian, transcribe);

		await setOffline(obsidian, true);
		onTestFinished(() => setOffline(obsidian, false));

		expect(await eventually(obsidian, () => isDisabled(obsidian, transcribe), true)).toBe(true);
		await setOffline(obsidian, false);
		expect(await eventually(obsidian, () => isDisabled(obsidian, transcribe), false)).toBe(
			false,
		);
	}, 60_000);
	test("a private feed's transcript that quotes its own token and the feed's address shows and saves neither", async () => {
		const context = getContext();
		const { obsidian, plugin, sandbox } = context;
		const captions = "caption.vtt?token=E2E_TX_SENTINEL";
		const quoting: FixtureEpisode = {
			title: "Quoting Episode",
			seconds: 60,
			pubDate: pubDate(0),
			guid: "quoting",
			transcripts: [
				{
					path: captions,
					type: "text/vtt",
					absolute: true,
					body: (port) =>
						`WEBVTT\n\n00:00:00.000 --> 00:00:05.000\n<v Host>Your feed is http://${SUPERCAST_FIXTURE_HOST}:${port}/feeds/E2E_FEED_SENTINEL/feed.xml and these captions are http://${FIXTURE_HOST}:${port}/quoting-private/${captions}\n`,
				},
			],
		};
		const show: FixtureFeed = {
			title: "Quoting Private",
			slug: "quoting-private",
			host: SUPERCAST_FIXTURE_HOST,
			path: "/feeds/E2E_FEED_SENTINEL/feed.xml",
			artwork: false,
			episodes: [quoting],
		};
		const server = await startFixtureServer([show]);
		onTestFinished(() => server.stop());
		await seedLibrary(context, server);
		await showPodNotes(obsidian);
		await showAddPodcast(obsidian);
		await typeInto(obsidian, ui.podcastSearch, server.feedUrl(show));
		await click(obsidian, ui.addPodcast(show.title));
		await waitForLibrary(plugin, (library) => library.subscriptions.length === 1, "subscribed");
		const secretId = await obsidian.dev.evalJson<string>(
			`app.plugins.plugins.${PLUGIN_ID}.settings.savedFeeds[${jsLiteral(show.title)}].urlSecretId`,
		);
		onTestFinished(() =>
			obsidian.dev.evalJson(`app.secretStorage.setSecret(${jsLiteral(secretId)}, ""), true`),
		);
		await showLibrary(obsidian);
		await click(obsidian, ui.podcastCard(show.title));
		await click(obsidian, ui.episode(quoting.title));
		await waitForPlayback(obsidian, (playback) => playback.playing, "playing");
		await click(obsidian, ui.playbackToggle);
		if (!(await isShown(obsidian, ui.fullPlayer))) await click(obsidian, ui.openPlayer);
		await click(obsidian, ui.playerPanel("Transcript"));

		const hidden = "podnotes-private-feed:Quoting%20Private";
		const line = `Your feed is ${hidden} and these captions are ${hidden}`;
		expect(
			await eventually(obsidian, async () => (await shownTranscript()).lines, [line]),
			"the panel's line",
		).toEqual([line]);
		expect(server.requests()).toContain(`/quoting-private/${captions}`);
		const view = await obsidian.dev.evalJson<string>(
			`document.querySelector(${jsLiteral(PLAYER_VIEW)}).innerHTML`,
		);
		expect(view).not.toMatch(/E2E_TX_SENTINEL|E2E_FEED_SENTINEL/);

		await dismissNotices(obsidian);
		await click(obsidian, panelButton("Save as note"));
		const notePath = `Transcripts/${show.title}/${quoting.title}.md`;
		await sandbox.waitForExists(notePath, { timeoutMs: 30_000 });
		const note = await obsidian.waitFor(
			async () => {
				const text = await readVaultText(obsidian, sandbox.path(notePath));
				return text.includes("Your feed is") && text;
			},
			{ timeoutMs: 10_000, intervalMs: 100, message: "the saved note's text" },
		);
		expect(note).not.toMatch(/E2E_TX_SENTINEL|E2E_FEED_SENTINEL/);
		expect(note).toContain(
			"Your feed is podnotes-private-feed:Quoting\\%20Private and these captions are podnotes-private-feed:Quoting\\%20Private",
		);
	}, 120_000);

	test("on a phone, the stage gets the room the deck can spare, and Save, the Find field, Follow and Edit are 44 px", async () => {
		const context = getContext();
		const { obsidian } = context;
		await asPhone(obsidian);
		expect(
			await obsidian.dev.evalJson<boolean>('document.body.classList.contains("is-phone")'),
			"a phone",
		).toBe(true);
		const server = await serve();
		await seedLibrary(context, server, {
			subscriptions: [FEED],
			current: storedEpisode(server, FEED, CAPTIONED),
			queue: [storedEpisode(server, FEED, PLAIN)],
		});
		await placePodNotes(obsidian, "main area");
		if (!(await isShown(obsidian, ui.fullPlayer))) await click(obsidian, ui.openPlayer);
		await waitUntilShown(obsidian, ui.fullPlayer);
		const geometry = await phoneGeometry();
		await click(obsidian, ui.playerPanel("Transcript"));
		await eventually(
			obsidian,
			async () => (await shownTranscript()).lines.length,
			LINES.length,
		);
		const transcriptPanel = await phoneGeometry();
		const height = (target: UiTarget) =>
			obsidian.dev.evalJson<number>(
				`Math.round((${target.elements})[0]?.getBoundingClientRect().height ?? 0)`,
			);

		const heights: Record<string, number> = { save: await height(panelButton("Save as note")) };
		await obsidian.dev.evalJson(
			`((list) => ((list.scrollTop = list.scrollHeight), true))(${TRANSCRIPT_LIST})`,
		);
		await waitUntilShown(obsidian, followChip);
		heights.follow = await height(followChip);
		await click(obsidian, panelButton("Find in transcript"));
		await waitUntilShown(obsidian, findField);
		heights.find = await height(findField);
		await pressKey(obsidian, "Escape");
		await click(obsidian, ui.playerPanel("Up next"));
		await waitUntilShown(obsidian, panelButton("Edit"));
		heights.edit = await height(panelButton("Edit"));
		const upNextPanel = await phoneGeometry();
		const editWidth = await obsidian.dev.evalJson<number>(
			`(${panelButton("Edit").elements})[0].getBoundingClientRect().width`,
		);

		expect(heights).toEqual({ save: 44, follow: 44, find: 44, edit: 44 });
		expect(editWidth).toBeGreaterThanOrEqual(44);
		expect(geometry.stage.height, "the stage under Obsidian's header").toBeGreaterThanOrEqual(
			275,
		);
		expect(geometry.art, "square artwork that fills the stage's height").toEqual({
			top: geometry.stage.top + 4,
			bottom: geometry.stage.bottom - 4,
			width: geometry.stage.height - 8,
			height: geometry.stage.height - 8,
		});
		for (const { controls, navbar } of [geometry, transcriptPanel, upNextPanel])
			expect(controls, "the deck above Obsidian's navbar").toBeLessThanOrEqual(navbar);
		for (const { stage, panel, list } of [transcriptPanel, upNextPanel]) {
			expect([panel?.top, panel?.bottom], "a panel fills the stage").toEqual([
				stage.top,
				stage.bottom,
			]);
			expect(list?.bottom, "its list fills the stage under its head").toBe(stage.bottom);
		}
	}, 120_000);

	test("the panel's head fits Save, its label out of sight but naming it in a 320 px sidebar and a phone's drawer, in sight in a phone's main area", async () => {
		const context = getContext();
		const { obsidian } = context;
		const server = await serve();
		await seedLibrary(context, server, {
			subscriptions: [FEED],
			current: storedEpisode(server, FEED, CAPTIONED),
		});
		await placePodNotes(obsidian, { sidebar: 320 });
		await openTranscriptPanel();
		const sidebar = await transcriptHead();
		await asPhone(obsidian);
		await placePodNotes(obsidian, "right drawer");
		await openTranscriptPanel();
		const drawer = await transcriptHead();
		await placePodNotes(obsidian, "main area");
		await openTranscriptPanel();
		const mainArea = await transcriptHead();

		const fits = { saveInside: true, headFits: true, name: "Save as note", ariaLabel: false };
		expect({ sidebar, drawer, mainArea }).toMatchObject({
			sidebar: { ...fits, label: false },
			drawer: { ...fits, label: false },
			mainArea: { ...fits, label: true },
		});
	}, 120_000);

	test("following shows the line playing now and the line before it whole, and no line cut under the top fade, in a 320 px sidebar and a phone's drawer", async () => {
		const context = getContext();
		const { obsidian } = context;
		const server = await serve();
		await seedLibrary(context, server, {
			subscriptions: [FEED],
			current: storedEpisode(server, FEED, CAPTIONED),
			progress: [
				{
					episode: { podcastName: FEED.title, title: CAPTIONED.title },
					seconds: 19,
					duration: 60,
					finished: false,
				},
			],
		});
		await placePodNotes(obsidian, { sidebar: 320 });
		await openTranscriptPanel();
		const sidebar = await followed();
		await asPhone(obsidian);
		await placePodNotes(obsidian, "right drawer");
		await openTranscriptPanel();
		await obsidian.dev.evalJson(`app.plugins.plugins.${PLUGIN_ID}.api.currentTime = 33, true`);
		await eventually(obsidian, async () => (await followed()).line, LINES[5]);
		const drawer = await followed();

		expect([sidebar.line, drawer.line]).toEqual([LINES[3], LINES[5]]);
		expect(sidebar, `sidebar rows ${sidebar.rows.join(", ")}`).toMatchObject({
			clear: true,
			cut: false,
		});
		expect(drawer, `drawer rows ${drawer.rows.join(", ")}`).toMatchObject({
			clear: true,
			cut: false,
		});
	}, 120_000);
});
