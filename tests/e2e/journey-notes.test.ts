import { describe, expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness } from "./harness";
import {
	clickInEditor,
	closePopoutTab,
	closeSettings,
	dismissNotices,
	openInEditor,
	openInReadingView,
	openPodNotesSettings,
	reloadAfterPopout,
	runFromPalette,
	showLibrary,
	showPodNotes,
} from "./journey/actions";
import { click } from "./journey/input";
import { ui, type UiTarget } from "./journey/targets";
import { eventually, isShown, notices, waitUntilShown } from "./journey/wait";
import {
	type FixtureEpisode,
	type FixtureFeed,
	type FixtureServer,
	pubDate,
	startFixtureServer,
} from "./journey/fixtures";
import {
	type PlaybackObservation,
	playbackOver,
	readLibrary,
	readVaultText,
	seedLibrary,
	waitForPlayback,
	writeVaultFile,
} from "./journey/library";
import { jsLiteral, PLUGIN_ID } from "./runtime";

const getContext = createPodNotesE2EHarness("journey-notes");

const ORIGINAL: FixtureEpisode = {
	title: "Original Title",
	seconds: 60,
	pubDate: pubDate(0),
	guid: "identity-original",
};
const STEADY: FixtureEpisode = {
	title: "Steady Episode",
	seconds: 60,
	pubDate: pubDate(1),
	guid: "identity-steady",
};
const RETITLED = "Completely Different Name";

type Journey = Readonly<{ server: FixtureServer; show: FixtureFeed }>;

/** Subscribes to a podcast named `title`, so each journey writes its notes to its own folder. */
async function setUp(
	title: string,
	{
		episodes = [ORIGINAL, STEADY],
		noteTemplate,
	}: { episodes?: readonly FixtureEpisode[]; noteTemplate?: string } = {},
): Promise<Journey> {
	const context = getContext();
	const show: FixtureFeed = { title, slug: "identity", artwork: true, episodes };
	const server = await startFixtureServer([show]);
	onTestFinished(() => server.stop());
	await seedLibrary(context, server, { subscriptions: [show], noteTemplate });
	return { server, show };
}

function notePath(show: FixtureFeed, title: string): string {
	return getContext().sandbox.path(`PodNotes/${show.title}/${title}.md`);
}

function hms(seconds: number): string {
	const whole = Math.floor(seconds);
	return [whole / 3600, (whole % 3600) / 60, whole % 60]
		.map((part) => String(Math.floor(part)).padStart(2, "0"))
		.join(":");
}

/**
 * The default "Capture timestamp format", `- {{linktime}} `, for `episode` at `seconds`,
 * or the segment from `seconds` to `end` that it captures as `- {{linksegment}} `.
 */
function capture(
	{ server, show }: Journey,
	episode: FixtureEpisode,
	seconds: number,
	end?: number,
): string {
	const query = [
		`episodeName=${encodeURIComponent(episode.title)}`,
		`url=${encodeURIComponent(server.feedUrl(show))}`,
		`guid=${encodeURIComponent(episode.guid ?? "")}`,
		`time=${seconds}`,
		...(end === undefined ? [] : [`endTime=${end}`]),
	].join("&");
	const shown = end === undefined ? hms(seconds) : `${hms(seconds)}-${hms(end)}`;
	return `- [${shown}](obsidian://podnotes?${query}) `;
}

function frontmatter(note: string): string[] {
	const [, block] = /^---\n([\s\S]*?)\n---\n/.exec(note) ?? [];
	if (block === undefined) throw new Error(`The note has no frontmatter: ${note}`);
	return block.split("\n");
}

async function playFromList(show: FixtureFeed, title: string): Promise<void> {
	const { obsidian } = getContext();
	await showPodNotes(obsidian);
	await showLibrary(obsidian);
	await click(obsidian, ui.podcastCard(show.title));
	await click(obsidian, ui.episode(title));
	await waitForPlayback(
		obsidian,
		(playback) => playback.episode?.title === title && (playback.media?.seconds ?? 0) > 0,
		`${title} playing from the episode list`,
	);
}

async function pauseInView(): Promise<PlaybackObservation> {
	const { obsidian } = getContext();
	await click(obsidian, ui.playbackToggle);
	await waitForPlayback(obsidian, (playback) => !playback.playing, "paused in the PodNotes view");
	const [, paused] = await playbackOver(obsidian, 500);
	return paused;
}

async function activeEditorPath(): Promise<string | null> {
	return await getContext().obsidian.dev.evalJson<string | null>(
		"app.workspace.activeEditor?.editor ? (app.workspace.activeEditor.file?.path ?? '') : null",
	);
}

async function loadedEpisode(): Promise<unknown> {
	return await getContext().obsidian.dev.evalJson<unknown>(
		`app.plugins.plugins.${PLUGIN_ID}.api.podcast ?? null`,
	);
}

async function exists(path: string): Promise<boolean> {
	return await getContext().obsidian.dev.evalJson<boolean>(
		`Boolean(app.vault.getAbstractFileByPath(${jsLiteral(path)}))`,
	);
}

async function waitForText(
	path: string,
	predicate: (text: string) => boolean,
	message: string,
): Promise<string> {
	const { obsidian } = getContext();
	let last = "";
	await obsidian
		.waitFor(
			async () => {
				last = (await exists(path)) ? await readVaultText(obsidian, path) : "";
				return predicate(last);
			},
			{ timeoutMs: 10_000, intervalMs: 200, message },
		)
		.catch((error: Error) => {
			error.message += ` Last text: ${JSON.stringify(last)}`;
			throw error;
		});
	return last;
}

async function waitForActiveFile(path: string, message: string): Promise<void> {
	await getContext().obsidian.waitFor(
		() =>
			getContext().obsidian.dev.evalJson<boolean>(
				`app.workspace.getActiveFile()?.path === ${jsLiteral(path)}`,
			),
		{ timeoutMs: 10_000, intervalMs: 100, message },
	);
}

async function waitForPrompt(placeholder: string): Promise<void> {
	await getContext().obsidian.waitFor(
		() =>
			getContext().obsidian.dev.evalJson<boolean>(
				`document.querySelector(".prompt .prompt-input")?.placeholder === ${jsLiteral(placeholder)}`,
			),
		{ timeoutMs: 10_000, intervalMs: 100, message: `the "${placeholder}" picker` },
	);
}

/** The titles in the open menu, once it shows. */
async function menuTitles(): Promise<string[]> {
	const { obsidian } = getContext();
	return await obsidian.waitFor(
		async () => {
			const titles = await obsidian.dev.evalJson<string[]>(
				'[...document.querySelectorAll(".menu .menu-item-title")].map((el) => el.textContent.trim())',
			);
			return titles.length > 0 ? titles : false;
		},
		{ timeoutMs: 10_000, intervalMs: 100, message: "the menu open" },
	);
}

/** The properties Obsidian reads from the note at `path`, once it reads any. */
async function properties(path: string): Promise<Record<string, unknown>> {
	const { obsidian } = getContext();
	return await obsidian.waitFor(
		async () =>
			(await obsidian.dev.evalJson<Record<string, unknown> | null>(
				`app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(${jsLiteral(path)}))?.frontmatter ?? null`,
			)) ?? false,
		{
			timeoutMs: 10_000,
			intervalMs: 200,
			message: `Obsidian reading the properties of ${path}`,
		},
	);
}

/** The text in the open editor of `path`, which runs ahead of the file it saves. */
async function editorText(path: string): Promise<string | null> {
	return await getContext().obsidian.dev.evalJson<string | null>(
		`app.workspace.getLeavesOfType("markdown").find((leaf) => leaf.view.file?.path === ${jsLiteral(path)})?.view.editor.getValue() ?? null`,
	);
}

/** Opens `path` in Live Preview with the caret at `line` and `ch`, both zero-based. */
async function writeIn(path: string, line: number, ch: number): Promise<void> {
	const { obsidian } = getContext();
	await openInEditor(obsidian, path);
	expect(
		await obsidian.dev.evalJson<unknown>(
			`app.workspace.getLeavesOfType("markdown").find((leaf) => leaf.view.file?.path === ${jsLiteral(path)}).view.getState()`,
		),
		"Live Preview",
	).toMatchObject({ mode: "source", source: false });
	expect(await clickInEditor(obsidian, path, line, ch)).toEqual({ line, ch });
}

/**
 * Clicks `timestamp`, waits until `read` shows `captured`, then clicks Undo on the Notice
 * that says `message` and waits until `read` shows `before` again.
 */
async function captureThenUndo(
	timestamp: UiTarget,
	message: string,
	read: () => Promise<string | null>,
	{ before, captured }: { before: string; captured: string },
): Promise<void> {
	const { obsidian } = getContext();
	await click(obsidian, timestamp);
	expect(await eventually(obsidian, read, captured, 10_000), "captured").toBe(captured);
	await click(obsidian, ui.undo(message));
	expect(await eventually(obsidian, read, before, 10_000), "after Undo").toBe(before);
	expect(await notices(obsidian), "Undo left nothing behind to say").not.toContainEqual(
		expect.stringContaining("The note changed since"),
	);
}

async function detachMarkdownTabs(): Promise<void> {
	await getContext().obsidian.dev.evalJson('app.workspace.detachLeavesOfType("markdown"), true');
}

describe("episode note and capture journeys", () => {
	test("J-NOTE-09 a retitled episode keeps its note, its timestamp links, and its Resume link", async () => {
		const { obsidian, sandbox } = getContext();
		const journey = await setUp("Journey Retitle");
		const { server, show } = journey;
		const feedParam = encodeURIComponent(server.feedUrl(show));
		const original = notePath(show, ORIGINAL.title);
		const log = sandbox.path("Listening log.md");

		await playFromList(show, ORIGINAL.title);
		await waitForPlayback(
			obsidian,
			(playback) => playback.seconds >= 3,
			"three seconds played",
		);
		await runFromPalette(obsidian, "Create episode note");
		const note = await waitForText(
			original,
			(text) => text.includes("\n# Original Title\n"),
			"the episode note created",
		);
		expect(frontmatter(note), "the note records the episode's GUID and feed").toEqual(
			expect.arrayContaining([
				`guid: "${ORIGINAL.guid}"`,
				`feedUrl: "${server.feedUrl(show)}"`,
			]),
		);
		expect(note).toContain(
			`\n[Resume in PodNotes](obsidian://podnotes?episodeName=Original%20Title&url=${feedParam}&guid=${ORIGINAL.guid})\n`,
		);

		const paused = await pauseInView();
		await writeVaultFile(
			obsidian,
			log,
			`[Old Steady link](obsidian://podnotes?episodeName=Steady%20Episode&url=${feedParam}&time=20)\n\n`,
		);
		await openInEditor(obsidian, log);
		expect(await clickInEditor(obsidian, log, 1, 0), "caret on the log's empty line").toEqual({
			line: 1,
			ch: 0,
		});
		await runFromPalette(obsidian, "Capture Timestamp");
		const captured = capture(journey, ORIGINAL, paused.seconds);
		await waitForText(
			log,
			(text) => text.endsWith(`\n${captured}\n`),
			"the timestamp captured into the log",
		);

		server.retitle(show, ORIGINAL, RETITLED);
		await openPodNotesSettings(obsidian);
		await click(obsidian, ui.settingControl("Clear cached feeds", "button"));
		await closeSettings(obsidian);
		await dismissNotices(obsidian);
		await showLibrary(obsidian);
		await click(obsidian, ui.podcastCard(show.title));
		await waitUntilShown(obsidian, ui.episode(RETITLED));

		await click(obsidian, ui.episodeMenu(RETITLED));
		await waitUntilShown(obsidian, ui.menuItem("Open note"));
		expect(await isShown(obsidian, ui.menuItem("Create note")), "no Create note offered").toBe(
			false,
		);
		await click(obsidian, ui.menuItem("Open note"));
		await waitForActiveFile(original, "Open note opening the original note");
		expect(await exists(notePath(show, RETITLED)), "no note made for the new title").toBe(
			false,
		);

		await click(obsidian, ui.episode(STEADY.title));
		await waitForPlayback(
			obsidian,
			(playback) =>
				playback.episode?.title === STEADY.title && (playback.media?.seconds ?? 0) > 0,
			"Steady Episode loaded",
		);
		await openInReadingView(obsidian, log);
		await click(obsidian, ui.readingLink(hms(paused.seconds)));
		const linked = await waitForPlayback(
			obsidian,
			(playback) =>
				playback.episode?.title === RETITLED && (playback.media?.seconds ?? 0) > 0,
			"the GUID link playing the retitled episode",
		);
		expect(linked.media?.src).toBe(server.mediaUrl(show, ORIGINAL));
		expect(linked.seconds).toBeGreaterThanOrEqual(paused.seconds);
		expect(linked.seconds).toBeLessThan(paused.seconds + 3);

		await playFromList(show, STEADY.title);
		await openInReadingView(obsidian, original);
		await click(obsidian, ui.readingLink("Resume in PodNotes"));
		const resumed = await waitForPlayback(
			obsidian,
			(playback) =>
				playback.episode?.title === RETITLED &&
				playback.playing &&
				(playback.media?.seconds ?? 0) > 0,
			"the note's Resume link playing the retitled episode",
		);
		expect(resumed.media?.src).toBe(server.mediaUrl(show, ORIGINAL));

		await openInReadingView(obsidian, log);
		await click(obsidian, ui.readingLink("Old Steady link"));
		const steady = await waitForPlayback(
			obsidian,
			(playback) =>
				playback.episode?.title === STEADY.title && (playback.media?.seconds ?? 0) > 0,
			"the old link without a GUID playing Steady Episode",
		);
		expect(steady.media?.src).toBe(server.mediaUrl(show, STEADY));
		expect(steady.seconds).toBeGreaterThanOrEqual(20);
		expect(steady.seconds).toBeLessThan(23);
		expect((await obsidian.dev.notices()).map(({ message }) => message)).not.toContain(
			"Episode not found",
		);
	}, 120_000);

	test("J-NOTE-10 Create episode note with nothing playing picks a podcast, then an episode", async () => {
		const { obsidian, plugin } = getContext();
		const { server, show } = await setUp("Journey Picker");
		expect(await loadedEpisode(), "nothing loaded").toBeNull();

		await runFromPalette(obsidian, "Create episode note");
		await waitForPrompt("Select a podcast");
		await click(obsidian, ui.suggestion(show.title));
		await waitForPrompt("Select an episode");
		await click(obsidian, ui.suggestion(STEADY.title));

		const created = notePath(show, STEADY.title);
		const note = await waitForText(
			created,
			(text) => text.includes("\n# Steady Episode\n"),
			"the picked episode's note created",
		);
		expect(frontmatter(note)).toEqual(expect.arrayContaining([`guid: "${STEADY.guid}"`]));
		await waitForActiveFile(created, "the created note opened");
		expect(await exists(notePath(show, ORIGINAL.title)), "no note for the other episode").toBe(
			false,
		);
		expect(await loadedEpisode(), "the player stays empty").toBeNull();
		expect((await readLibrary(plugin)).currentEpisode).toBeNull();
		expect(server.requests().filter((path) => path.endsWith(".wav"))).toEqual([]);
	});

	test("J-NOTE-11 two episodes that share a GUID each get their own note", async () => {
		const { obsidian } = getContext();
		const alpha: FixtureEpisode = {
			title: "Alpha Original",
			seconds: 60,
			pubDate: pubDate(0),
			guid: "shared-guid",
		};
		const beta: FixtureEpisode = { ...alpha, title: "Beta Different", pubDate: pubDate(1) };
		const { show } = await setUp("Journey Shared GUID", { episodes: [alpha, beta] });
		const alphaNote = notePath(show, alpha.title);
		const betaNote = notePath(show, beta.title);

		await showPodNotes(obsidian);
		await showLibrary(obsidian);
		await click(obsidian, ui.podcastCard(show.title));
		await click(obsidian, ui.episodeMenu(alpha.title));
		await click(obsidian, ui.menuItem("Create note"));
		const alphaText = await waitForText(
			alphaNote,
			(text) => text.includes("\n# Alpha Original\n"),
			"Alpha's note created",
		);

		await click(obsidian, ui.episodeMenu(beta.title));
		const titles = await menuTitles();
		expect(titles, "Beta's menu offers a note of its own").toContain("Create note");
		expect(titles).not.toContain("Open note");
		await click(obsidian, ui.menuItem("Create note"));
		const betaText = await waitForText(
			betaNote,
			(text) => text.includes("\n# Beta Different\n"),
			"Beta's own note created",
		);
		await waitForActiveFile(betaNote, "Beta's note opened");

		expect(await readVaultText(obsidian, alphaNote), "Alpha's note untouched").toBe(alphaText);
		for (const text of [alphaText, betaText])
			expect(
				frontmatter(text).filter((line) => line.startsWith("guid:")),
				"a GUID two episodes share identifies neither",
			).toEqual([]);
	});

	test("J-NOTE-12 a note template with indented frontmatter keys gets the GUID in the same mapping", async () => {
		const { obsidian } = getContext();
		const { server, show } = await setUp("Journey Indented", {
			noteTemplate:
				'---\n  type: podcastEpisode\n  feedUrl: "{{feedurl}}"\n---\n# {{title}}\n',
		});
		const note = notePath(show, ORIGINAL.title);
		const feedUrl = server.feedUrl(show);

		await showPodNotes(obsidian);
		await showLibrary(obsidian);
		await click(obsidian, ui.podcastCard(show.title));
		await click(obsidian, ui.episodeMenu(ORIGINAL.title));
		await click(obsidian, ui.menuItem("Create note"));
		const text = await waitForText(
			note,
			(value) => value.includes("\n# Original Title\n"),
			"the episode note created",
		);

		expect(frontmatter(text)).toEqual([
			"  type: podcastEpisode",
			`  feedUrl: "${feedUrl}"`,
			`  guid: "${ORIGINAL.guid}"`,
		]);
		expect(await properties(note)).toEqual({
			type: "podcastEpisode",
			feedUrl,
			guid: ORIGINAL.guid,
		});
	});

	test("J-TS-08 Capture Timestamp from the palette lands at the caret of the editor used last", async () => {
		const { obsidian, sandbox } = getContext();
		const journey = await setUp("Journey Caret");
		const draft = sandbox.path("Draft.md");
		await writeVaultFile(obsidian, draft, "Before the cut after the cut\nSecond line\n");

		await playFromList(journey.show, ORIGINAL.title);
		await openInEditor(obsidian, draft);
		expect(await clickInEditor(obsidian, draft, 0, 14), "caret mid-line").toEqual({
			line: 0,
			ch: 14,
		});
		const paused = await pauseInView();
		expect(await activeEditorPath(), "the PodNotes view has focus").toBeNull();

		await runFromPalette(obsidian, "Capture Timestamp");
		const text = await waitForText(
			draft,
			(value) => value.includes("obsidian://podnotes"),
			"the capture saved into the draft",
		);
		expect(text).toBe(
			`Before the cut${capture(journey, ORIGINAL, paused.seconds)} after the cut\nSecond line\n`,
		);
		expect(
			await exists(notePath(journey.show, ORIGINAL.title)),
			"no episode note created",
		).toBe(false);
	});

	test("J-TS-11 captures land in the editor used last, not in a note opened since in Reading view", async () => {
		const { obsidian, sandbox } = getContext();
		const journey = await setUp("Journey Reading Tab");
		const remembered = sandbox.path("Remembered.md");
		const reading = sandbox.path("Reading other.md");
		await writeVaultFile(obsidian, remembered, "Before the cut after the cut\n");
		await writeVaultFile(obsidian, reading, "Read only\n");

		await playFromList(journey.show, ORIGINAL.title);
		await openInEditor(obsidian, remembered);
		expect(await clickInEditor(obsidian, remembered, 0, 14), "caret mid-line").toEqual({
			line: 0,
			ch: 14,
		});
		await openInReadingView(obsidian, reading);
		expect(
			await obsidian.dev.evalJson<Record<string, string>>(
				'Object.fromEntries(app.workspace.getLeavesOfType("markdown").map((leaf) => [leaf.view.file?.path, leaf.view.getMode()]))',
			),
			"the editor and the Reading view both open",
		).toMatchObject({ [remembered]: "source", [reading]: "preview" });
		const paused = await pauseInView();
		expect(await activeEditorPath(), "the PodNotes view has focus").toBeNull();

		await runFromPalette(obsidian, "Capture Timestamp");
		await runFromPalette(obsidian, "Capture Last 10 Seconds");
		const timestamp = capture(journey, ORIGINAL, paused.seconds);
		const segment = capture(
			journey,
			ORIGINAL,
			Math.max(0, paused.seconds - 10),
			paused.seconds,
		);
		const text = await waitForText(
			remembered,
			(value) => value.includes("endTime="),
			"both captures saved into the editor used last",
		);
		expect(text).toBe(`Before the cut${timestamp}${segment} after the cut\n`);
		expect(await readVaultText(obsidian, reading), "the Reading view note untouched").toBe(
			"Read only\n",
		);
		expect(
			await exists(notePath(journey.show, ORIGINAL.title)),
			"no episode note created",
		).toBe(false);
	});

	test("J-TS-10 Capture Timestamp with no editor open fills the episode note, one capture per line", async () => {
		const { obsidian } = getContext();
		const journey = await setUp("Journey No Editor");
		const episodeNote = notePath(journey.show, ORIGINAL.title);
		await detachMarkdownTabs();

		await playFromList(journey.show, ORIGINAL.title);
		const first = await pauseInView();
		expect(
			await obsidian.dev.evalJson<number>('app.workspace.getLeavesOfType("markdown").length'),
			"no markdown tab open",
		).toBe(0);
		await runFromPalette(obsidian, "Capture Timestamp");
		const firstLine = capture(journey, ORIGINAL, first.seconds);
		await waitForText(
			episodeNote,
			(text) => text.endsWith(`\n${firstLine}\n`),
			"the first capture in a new episode note",
		);

		await click(obsidian, ui.playbackToggle);
		await waitForPlayback(
			obsidian,
			(playback) => playback.playing && playback.seconds > first.seconds + 1,
			"playing on",
		);
		const second = await pauseInView();
		await runFromPalette(obsidian, "Capture Timestamp");
		const secondLine = capture(journey, ORIGINAL, second.seconds);
		const note = await waitForText(
			episodeNote,
			(text) => text.includes(secondLine),
			"the second capture appended",
		);

		expect(note).toMatch(/^---\ntype: podcastEpisode\n/);
		expect(note).toContain("\n# Original Title\n");
		expect(frontmatter(note)).toEqual(
			expect.arrayContaining([
				`guid: "${ORIGINAL.guid}"`,
				`feedUrl: "${journey.server.feedUrl(journey.show)}"`,
			]),
		);
		expect(note.endsWith(`\n${firstLine}\n${secondLine}\n`), note).toBe(true);
	});

	test("J-TS-12 the player's Timestamp goes into the note being written and into the episode note, and Undo leaves each as it was", async () => {
		const { obsidian, sandbox } = getContext();
		const journey = await setUp("Journey Player Capture");
		const draft = sandbox.path("Player draft.md");
		const episodeNote = notePath(journey.show, ORIGINAL.title);
		const original = "Before the cut after the cut\nSecond line\n";
		await writeVaultFile(obsidian, draft, original);
		const timestamp = ui.playerControl("Capture timestamp");
		const label = () =>
			obsidian.dev.evalJson<string>(`(${timestamp.elements})[0]?.textContent.trim() ?? ""`);

		await playFromList(journey.show, ORIGINAL.title);
		await writeIn(draft, 0, 14);
		const paused = await pauseInView();
		const line = capture(journey, ORIGINAL, paused.seconds);

		await click(obsidian, timestamp);
		expect(await eventually(obsidian, label, "Added", 1_000), "the button confirms").toBe(
			"Added",
		);
		expect(await eventually(obsidian, label, "Timestamp", 3_000)).toBe("Timestamp");
		const captured = `Before the cut${line} after the cut\nSecond line\n`;
		expect(await eventually(obsidian, () => editorText(draft), captured)).toBe(captured);
		await click(obsidian, ui.undo("Timestamp added to Player draft"));
		expect(await eventually(obsidian, () => editorText(draft), original)).toBe(original);
		await waitForText(draft, (text) => text === original, "the draft saved as it was");

		await detachMarkdownTabs();
		await click(obsidian, timestamp);
		const created = await waitForText(
			episodeNote,
			(text) => text.endsWith(`\n${line}\n`),
			"the capture in a new episode note",
		);
		await click(obsidian, ui.undo("Created Original Title"));
		const kept = created.slice(0, -`${line}\n`.length);
		await waitForText(
			episodeNote,
			(text) => text === kept,
			"the created note kept, without the line",
		);

		const read = async () =>
			(await exists(episodeNote)) ? await readVaultText(obsidian, episodeNote) : null;
		await captureThenUndo(timestamp, "Timestamp added to Original Title", read, {
			before: kept,
			captured: `${kept}${line}\n`,
		});
		expect(await editorText(draft), "the draft is closed").toBeNull();
		expect(await readVaultText(obsidian, draft)).toBe(original);
	});

	test("J-TS-13 the mini player's Timestamp goes into the note being written and into the episode note, and Undo leaves each as it was", async () => {
		const { obsidian, sandbox } = getContext();
		const journey = await setUp("Journey Mini Capture");
		const draft = sandbox.path("Mini draft.md");
		const episodeNote = notePath(journey.show, ORIGINAL.title);
		const original = "First line\nSecond line\n";
		const mine = "# My notes\nNo newline at the end";
		await writeVaultFile(obsidian, draft, original);
		await writeVaultFile(obsidian, episodeNote, mine);

		await playFromList(journey.show, ORIGINAL.title);
		await writeIn(draft, 1, 6);
		await click(obsidian, ui.collapsePlayer);
		await waitUntilShown(obsidian, ui.miniPlayer);
		await click(obsidian, ui.miniPlayback);
		const paused = await waitForPlayback(obsidian, (playback) => !playback.playing, "paused");
		const line = capture(journey, ORIGINAL, paused.seconds);

		await captureThenUndo(
			ui.miniCapture,
			"Timestamp added to Mini draft",
			() => editorText(draft),
			{
				before: original,
				captured: `First line\nSecond${line} line\n`,
			},
		);
		await waitForText(draft, (text) => text === original, "the draft saved as it was");

		await detachMarkdownTabs();
		await captureThenUndo(
			ui.miniCapture,
			"Timestamp added to Original Title",
			() => readVaultText(obsidian, episodeNote),
			{ before: mine, captured: `${mine}\n${line}\n` },
		);
	});

	test("J-TS-14 Capture Timestamp with nothing loaded says to play an episode, and writes nothing", async () => {
		const { obsidian, sandbox } = getContext();
		const journey = await setUp("Journey Nothing Loaded");
		const draft = sandbox.path("Nothing loaded.md");
		await writeVaultFile(obsidian, draft, "Notes\n");
		await showPodNotes(obsidian);
		expect(await loadedEpisode()).toBeNull();
		expect(await isShown(obsidian, ui.miniPlayer), "no mini player").toBe(false);
		await writeIn(draft, 0, 5);

		await runFromPalette(obsidian, "Capture Timestamp");

		await obsidian.waitFor(
			async () => (await notices(obsidian)).includes("Play an episode to capture"),
			{ timeoutMs: 5_000, intervalMs: 100, message: "the Play an episode to capture Notice" },
		);
		expect(await editorText(draft)).toBe("Notes\n");
		expect(await exists(notePath(journey.show, ORIGINAL.title))).toBe(false);
	});

	test("J-TS-09 Capture Timestamp lands in a popout editor, then in the episode note once the popout closes", async () => {
		const { obsidian, sandbox } = getContext();
		const journey = await setUp("Journey Popout");
		const draft = sandbox.path("Popout draft.md");
		const episodeNote = notePath(journey.show, ORIGINAL.title);
		await writeVaultFile(obsidian, draft, "Popout notes\n");
		await detachMarkdownTabs();

		await playFromList(journey.show, ORIGINAL.title);
		try {
			expect(
				await obsidian.dev.evalJsonAsync<boolean>(`(async () => {
					const leaf = app.workspace.openPopoutLeaf();
					await leaf.openFile(app.vault.getAbstractFileByPath(${jsLiteral(draft)}), { state: { mode: "source" } });
					return leaf.view.containerEl.ownerDocument !== document;
				})()`),
				"the draft open in a popout window",
			).toBe(true);
			expect(
				await clickInEditor(obsidian, draft, 0, 12),
				"caret at the popout line's end",
			).toEqual({ line: 0, ch: 12 });
			expect(await activeEditorPath()).toBe(draft);
			// A real click in the main window gives it the OS focus, which CDP input does not.
			await obsidian.dev.evalJson(
				'require("@electron/remote").getCurrentWindow().focus(), true',
			);
			const paused = await pauseInView();
			expect(
				await activeEditorPath(),
				"the main window's PodNotes view has focus",
			).toBeNull();

			await runFromPalette(obsidian, "Capture Timestamp");
			const captured = capture(journey, ORIGINAL, paused.seconds);
			const text = await waitForText(
				draft,
				(value) => value.includes("obsidian://podnotes"),
				"the capture saved into the popout draft",
			);
			expect(text).toBe(`Popout notes${captured}\n`);
			expect(await exists(episodeNote), "no episode note yet").toBe(false);

			await closePopoutTab(obsidian, draft);
			await runFromPalette(obsidian, "Capture Timestamp");
			const note = await waitForText(
				episodeNote,
				(value) => value.endsWith(`\n${captured}\n`),
				"the next capture in the episode note",
			);
			expect(frontmatter(note)).toEqual(expect.arrayContaining([`guid: "${ORIGINAL.guid}"`]));
			expect(await readVaultText(obsidian, draft), "the closed draft untouched").toBe(
				`Popout notes${captured}\n`,
			);
		} finally {
			const popouts = await obsidian.dev.evalJson<number>(
				"app.workspace.floatingSplit.children.length",
			);
			if (popouts > 0) await closePopoutTab(obsidian, draft);
			await obsidian.dev.evalJsonAsync(`(async () => {
				app.workspace.requestSaveLayout.cancel();
				await app.workspace.saveLayout();
				return true;
			})()`);
			await reloadAfterPopout(obsidian);
		}
	});
});
