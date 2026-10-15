import { describe, expect, onTestFinished, test } from "vitest";
import { FIXTURE_HOST, SUPERCAST_FIXTURE_HOST } from "../../scripts/e2e-instance.mjs";
import { createPodNotesE2EHarness } from "./harness";
import {
	dismissNotices,
	runCommand,
	placePodNotes,
	setMobileEmulation,
	setOffline,
	showAddPodcast,
	showLibrary,
	showPodNotes,
} from "./journey/actions";
import { cdp, click, pressKey, typeInto, typeText } from "./journey/input";
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
import { jsLiteral, PLUGIN_ID } from "./runtime";

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
}>;

/** How the transcript panel's head fits the panel: Save inside it, with its label or without. */
function transcriptHead(): Promise<TranscriptHead> {
	return getContext().obsidian.dev.evalJson<TranscriptHead>(`(() => {
		const panel = document.querySelector(${jsLiteral(`${PLAYER_VIEW} section.pn-player .pn-panel`)});
		const head = panel.querySelector(".pn-panel-head");
		const save = head.querySelector(".pn-tx-save");
		const label = save.lastElementChild;
		const shown = label.getClientRects().length > 0;
		const box = panel.getBoundingClientRect();
		const right = Math.max(save.getBoundingClientRect().right, shown ? label.getBoundingClientRect().right : 0);
		return {
			panel: Math.round(box.width),
			saveInside: right <= box.right + 0.5,
			label: shown,
			headFits: head.scrollWidth <= head.clientWidth,
		};
	})()`);
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
		const phone = { width: 390, height: 844 };
		await cdp(obsidian, "Emulation.setDeviceMetricsOverride", {
			...phone,
			deviceScaleFactor: 1,
			mobile: true,
			screenWidth: phone.width,
			screenHeight: phone.height,
		});
		onTestFinished(async () => {
			await cdp(obsidian, "Emulation.clearDeviceMetricsOverride", {});
		});
		await setMobileEmulation(obsidian, true);
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
	test("the panel's head fits Save, without its label in a 320 px sidebar and a phone's drawer, with it in a phone's main area", async () => {
		const context = getContext();
		const { obsidian } = context;
		const server = await serve();
		await seedLibrary(context, server, {
			subscriptions: [FEED],
			current: storedEpisode(server, FEED, CAPTIONED),
		});
		const openPanel = async () => {
			if (!(await isShown(obsidian, ui.fullPlayer))) await click(obsidian, ui.openPlayer);
			await waitUntilShown(obsidian, ui.fullPlayer);
			await click(obsidian, ui.playerPanel("Transcript"));
			await eventually(obsidian, async () => (await shownTranscript()).lines, LINES, 15_000);
			return await transcriptHead();
		};
		await placePodNotes(obsidian, { sidebar: 320 });
		const sidebar = await openPanel();

		const phone = { width: 390, height: 844 };
		await cdp(obsidian, "Emulation.setDeviceMetricsOverride", {
			...phone,
			deviceScaleFactor: 1,
			mobile: true,
			screenWidth: phone.width,
			screenHeight: phone.height,
		});
		onTestFinished(async () => {
			await cdp(obsidian, "Emulation.clearDeviceMetricsOverride", {});
		});
		await setMobileEmulation(obsidian, true);
		await obsidian.dev.evalJson(
			`app.workspace.detachLeavesOfType("podcast_player_view"), true`,
		);
		await showPodNotes(obsidian);
		const drawer = await openPanel();
		await placePodNotes(obsidian, "main area");
		const mainArea = await openPanel();

		const narrow = { saveInside: true, label: false, headFits: true };
		expect({ sidebar, drawer, mainArea }).toMatchObject({
			sidebar: narrow,
			drawer: narrow,
			mainArea: { saveInside: true, label: true, headFits: true },
		});
	}, 120_000);
});
