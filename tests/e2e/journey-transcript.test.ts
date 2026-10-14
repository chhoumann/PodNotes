import { describe, expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness } from "./harness";
import { dismissNotices, runCommand, setOffline, showPodNotes } from "./journey/actions";
import { click, pressKey, typeText } from "./journey/input";
import { PLAYER_VIEW, ui, type UiTarget } from "./journey/targets";
import { eventually, isDisabled, isShown, notices, waitUntilShown } from "./journey/wait";
import {
	type FixtureEpisode,
	type FixtureFeed,
	type FixtureServer,
	pubDate,
	startFixtureServer,
} from "./journey/fixtures";
import { readVaultText, seedLibrary, storedEpisode, waitForPlayback } from "./journey/library";
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

const TRANSCRIPT = `${PLAYER_VIEW} section.pn-player ol[aria-label="Transcript"]`;
const panelButton = (label: string): UiTarget => ({
	name: `transcript panel's ${label}`,
	elements: `[...document.querySelectorAll(${jsLiteral(`${PLAYER_VIEW} section.pn-player .pn-panel button`)})].filter((el) => el.getAttribute("aria-label") === ${jsLiteral(label)} || el.textContent.trim().startsWith(${jsLiteral(label)}))`,
});
const line = (text: string): UiTarget => ({
	name: `transcript line ${text}`,
	elements: `[...document.querySelectorAll(${jsLiteral(`${TRANSCRIPT} button`)})].filter((el) => el.lastElementChild?.textContent.trim() === ${jsLiteral(text)})`,
});
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

/** The panel's lines by their text, the current one, the Find hit, and the marked matches. */
async function shownTranscript(): Promise<ShownTranscript> {
	return await getContext().obsidian.dev.evalJson<ShownTranscript>(`(() => {
		const list = document.querySelector(${jsLiteral(TRANSCRIPT)});
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

/** Restores `episode` paused at its start, opens the full player, and chooses Transcript. */
async function openTranscript(episode: FixtureEpisode): Promise<FixtureServer> {
	const context = getContext();
	const server = await serve();
	await seedLibrary(context, server, {
		subscriptions: [FEED],
		current: storedEpisode(server, FEED, episode),
	});
	await showPodNotes(context.obsidian);
	if (!(await isShown(context.obsidian, ui.fullPlayer)))
		await click(context.obsidian, ui.openPlayer);
	await waitUntilShown(context.obsidian, ui.fullPlayer);
	await click(context.obsidian, ui.playerPanel("Transcript"));
	return server;
}

/**
 * Waits for the transcript note and the notice that its transcription finished, reads the
 * note with its date normalized, and deletes it, so the next transcription writes it again.
 */
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

describe("transcript journeys", () => {
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
});
