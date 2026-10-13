import { describe, expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness } from "./harness";
import {
	click,
	clickInEditor,
	closePopoutTab,
	closeSettings,
	dismissNotices,
	isShown,
	openInEditor,
	openInReadingView,
	openPodNotesSettings,
	reloadObsidian,
	runFromPalette,
	showPodNotes,
	ui,
	waitUntilShown,
} from "./journey/actions";
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
import { PLUGIN_ID } from "./runtime";

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
async function setUp(title: string): Promise<Journey> {
	const context = getContext();
	const show: FixtureFeed = {
		title,
		slug: "identity",
		artwork: true,
		episodes: [ORIGINAL, STEADY],
	};
	const server = await startFixtureServer([show]);
	onTestFinished(() => server.stop());
	await seedLibrary(context, server, { subscriptions: [show] });
	await context.obsidian.plugin("command-palette").enable({ filter: "core" });
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

/** The default "Capture timestamp format", `- {{linktime}} `, for `episode` at `seconds`. */
function capture({ server, show }: Journey, episode: FixtureEpisode, seconds: number): string {
	const query = [
		`episodeName=${encodeURIComponent(episode.title)}`,
		`url=${encodeURIComponent(server.feedUrl(show))}`,
		`guid=${encodeURIComponent(episode.guid ?? "")}`,
		`time=${seconds}`,
	].join("&");
	return `- [${hms(seconds)}](obsidian://podnotes?${query}) `;
}

function frontmatter(note: string): string[] {
	const [, block] = /^---\n([\s\S]*?)\n---\n/.exec(note) ?? [];
	if (block === undefined) throw new Error(`The note has no frontmatter: ${note}`);
	return block.split("\n");
}

async function playFromList(show: FixtureFeed, title: string): Promise<void> {
	const { obsidian } = getContext();
	await showPodNotes(obsidian);
	await click(obsidian, ui.podcastGridTab);
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
		`Boolean(app.vault.getAbstractFileByPath(${JSON.stringify(path)}))`,
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
				`app.workspace.getActiveFile()?.path === ${JSON.stringify(path)}`,
			),
		{ timeoutMs: 10_000, intervalMs: 100, message },
	);
}

async function waitForPrompt(placeholder: string): Promise<void> {
	await getContext().obsidian.waitFor(
		() =>
			getContext().obsidian.dev.evalJson<boolean>(
				`document.querySelector(".prompt .prompt-input")?.placeholder === ${JSON.stringify(placeholder)}`,
			),
		{ timeoutMs: 10_000, intervalMs: 100, message: `the "${placeholder}" picker` },
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
		await click(obsidian, ui.podcastGridTab);
		await click(obsidian, ui.podcastCard(show.title));
		await waitUntilShown(obsidian, ui.episode(RETITLED));

		await click(obsidian, ui.episodeMenu(RETITLED));
		await waitUntilShown(obsidian, ui.menuItem("Open Note"));
		expect(await isShown(obsidian, ui.menuItem("Create Note")), "no Create Note offered").toBe(
			false,
		);
		await click(obsidian, ui.menuItem("Open Note"));
		await waitForActiveFile(original, "Open Note opening the original note");
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
					await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(draft)}), { state: { mode: "source" } });
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
			// Obsidian can keep a ResizeObserver loop running in the main window after a popout
			// closes, with PodNotes disabled too, until the window reloads.
			await reloadObsidian(
				obsidian,
				"ResizeObserver loop completed with undelivered notifications.",
			);
		}
	});
});
