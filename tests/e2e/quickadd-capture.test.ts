import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness } from "./harness";
import {
	closeSettings,
	openPodNotesSettings,
	runCommand,
	showLibrary,
	showPodNotes,
} from "./journey/actions";
import { startFixtureServer, type FixtureFeed, type FixtureServer } from "./journey/fixtures";
import { cdp, click, pressKey, typeText } from "./journey/input";
import { readVaultText, seedLibrary, waitForPlayback } from "./journey/library";
import { ui, type UiTarget } from "./journey/targets";
import { eventually, notices, waitUntilShown } from "./journey/wait";
import { jsLiteral, PLUGIN_ID } from "./runtime";
import type { IPodNotesSettings } from "../../src/types/IPodNotesSettings";

const getContext = createPodNotesE2EHarness("quickadd-capture");

/** The last QuickAdd release before choice picking. */
const OLD_QUICKADD_VERSION = "2.32.1";
const OLD_QUICKADD_SHA256: Record<string, string> = {
	"main.js": "6423b2d14b60bc51fc6b6f61f835e08c5842d28e5a1a43ab5601ccd37b4e44c5",
	"manifest.json": "b7610b4c1d37c2c73f781c294c1a380e731e797f9858d2d825e7facc1ac3add1",
};
const OLD_QUICKADD_CACHE = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	`../../.obsidian-e2e-artifacts/releases/quickadd-${OLD_QUICKADD_VERSION}`,
);
/** A QuickAdd build with choice picking, until a QuickAdd release has it. */
const QUICKADD_DIR = process.env.OBSIDIAN_E2E_QUICKADD_DIR;
const QUICKADD_FILES = ["main.js", "manifest.json", "styles.css"];
const EVIDENCE = path.resolve(".obsidian-e2e-artifacts/quickadd-capture");

const FEED: FixtureFeed = {
	title: "QuickAdd podcast",
	slug: "quickadd",
	artwork: false,
	episodes: [{ title: "Captured episode", seconds: 60, guid: "captured-episode" }],
};
const NOTE_TEMPLATE = "# {{title}}\n\n## Notes\n- Earlier thought\n\n## Later\n";
const NOTE = "PodNotes/QuickAdd podcast/Captured episode.md";
const LOG_ID = "podnotes-e2e-capture";

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

type QuickAddFiles = Map<string, Buffer>;

/** QuickAdd 2.32.1's released files, cached in the git-ignored artifacts folder. */
async function oldQuickAdd(): Promise<QuickAddFiles> {
	const files = new Map<string, Buffer>();
	await fs.mkdir(OLD_QUICKADD_CACHE, { recursive: true });
	for (const [name, digest] of Object.entries(OLD_QUICKADD_SHA256)) {
		const cached = path.join(OLD_QUICKADD_CACHE, name);
		let bytes = await fs.readFile(cached).catch(() => null);
		if (!bytes || sha256(bytes) !== digest) {
			const url = `https://github.com/chhoumann/quickadd/releases/download/${OLD_QUICKADD_VERSION}/${name}`;
			const response = await fetch(url);
			if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
			bytes = Buffer.from(await response.arrayBuffer());
			expect(sha256(bytes), `the QuickAdd ${OLD_QUICKADD_VERSION} ${name} digest`).toBe(
				digest,
			);
			await fs.writeFile(cached, bytes);
		}
		files.set(name, bytes);
	}
	return files;
}

/** The QuickAdd build in OBSIDIAN_E2E_QUICKADD_DIR, each file checked against its build.json. */
async function quickAddBuild(): Promise<QuickAddFiles> {
	if (!QUICKADD_DIR)
		throw new Error(
			"Set OBSIDIAN_E2E_QUICKADD_DIR to a QuickAdd build with choice picking: main.js, manifest.json, styles.css and build.json.",
		);
	const build = JSON.parse(await fs.readFile(path.join(QUICKADD_DIR, "build.json"), "utf8")) as {
		files: Record<string, string>;
	};
	const files = new Map<string, Buffer>();
	for (const name of QUICKADD_FILES) {
		const bytes = await fs.readFile(path.join(QUICKADD_DIR, name));
		expect(sha256(bytes), `${name} as build.json records it`).toBe(build.files[name]);
		files.set(name, bytes);
	}
	return files;
}

/** A Capture choice that adds a bullet with the timestamp right after the Notes heading. */
const logChoice = (name: string) => ({
	id: LOG_ID,
	name,
	type: "Capture",
	command: false,
	captureTo: "{{VALUE:episodeNote}}",
	captureToActiveFile: false,
	captureToCanvasNodeId: "",
	activeFileWritePosition: "cursor",
	createFileIfItDoesntExist: { enabled: false, createWithTemplate: false, template: "" },
	format: { enabled: true, format: "- {{VALUE:timestamp}}" },
	prepend: false,
	appendLink: false,
	copyLinkToClipboard: false,
	task: false,
	insertAfter: {
		enabled: true,
		after: "## Notes",
		insertAtEnd: false,
		considerSubsections: false,
		createIfNotFound: false,
		createIfNotFoundLocation: "top",
		inline: false,
		replaceExisting: false,
		blankLineAfterMatchMode: "auto",
		promptHeading: false,
	},
	insertBefore: {
		enabled: false,
		before: "",
		createIfNotFound: false,
		createIfNotFoundLocation: "top",
	},
	newLineCapture: { enabled: false, direction: "below" },
	openFile: false,
	fileOpening: { location: "tab", direction: "vertical", mode: "default", focus: true },
	templater: { afterCapture: "none" },
});
const LOG = logChoice("Log timestamp");
/** A choice to pick past in QuickAdd's picker. */
const MEETING = { ...logChoice("Meeting note"), id: "podnotes-e2e-meeting" };

/** QuickAdd's data.json with `choices`, already migrated and announced. */
const quickAddData = (version: string, choices: object[]) => ({
	version,
	announceUpdates: "none",
	migrations: Object.fromEntries(
		[
			"useQuickAddTemplateFolder",
			"incrementFileNameSettingMoveToDefaultBehavior",
			"consolidateFileExistsBehavior",
			"repairTemplateFileExistsBehavior",
			"mutualExclusionInsertAfterAndWriteToBottomOfFile",
			"setVersionAfterUpdateModalRelease",
			"addDefaultAIProviders",
			"removeMacroIndirection",
			"migrateFileOpeningSettings",
			"backfillFileOpeningDefaults",
			"setProviderModelDiscoveryMode",
			"migrateProviderApiKeysToSecretStorage",
			"migrateToMultipleTemplateFolders",
			"refreshStaleDefaultModelSeeds",
			"pinAiModelRefs",
		].map((migration) => [migration, true]),
	),
	choices,
});

/** Installs QuickAdd from `files` with `choices` for this test only, enabled in memory unless told not to. */
async function installQuickAdd(
	files: QuickAddFiles,
	choices: object[],
	{ enable = true } = {},
): Promise<void> {
	const { obsidian } = getContext();
	const configDir = await obsidian.dev.evalJson<string>("app.vault.configDir");
	const directory = path.join(await obsidian.vaultPath(), configDir, "plugins", "quickadd");
	const { version } = JSON.parse(files.get("manifest.json")!.toString()) as { version: string };
	onTestFinished(async () => {
		await obsidian.dev.evalJsonAsync(`(async () => {
			const quickAdd = app.plugins.plugins.quickadd;
			await app.plugins.disablePlugin("quickadd");
			await quickAdd?.persistChain;
			return true;
		})()`);
		await fs.rm(directory, { recursive: true, force: true });
		await obsidian.dev.evalJsonAsync(
			"(async () => { await app.plugins.loadManifests(); return true; })()",
		);
	});
	await fs.mkdir(directory, { recursive: true });
	await fs.writeFile(
		path.join(directory, "data.json"),
		JSON.stringify(quickAddData(version, choices)),
	);
	for (const [name, bytes] of files) await fs.writeFile(path.join(directory, name), bytes);
	expect(
		await obsidian.dev.evalJsonAsync(`(async () => {
			await app.plugins.loadManifests();
			if (${enable}) await app.plugins.enablePlugin("quickadd");
			const quickAdd = app.plugins.plugins.quickadd;
			return {
				installed: app.plugins.manifests.quickadd?.version,
				choices: quickAdd?.settings.choices.map(({ name }) => name) ?? null,
				saved: app.plugins.enabledPlugins.has("quickadd"),
			};
		})()`),
		"QuickAdd loads in memory only, with the seeded choices",
	).toEqual({
		installed: version,
		choices: enable ? choices.map((choice) => (choice as { name: string }).name) : null,
		saved: false,
	});
}

/** Gives QuickAdd these choices as a sync from another device does: in data.json, then reloaded. */
async function syncQuickAddChoices(choices: object[]): Promise<void> {
	expect(
		await getContext().obsidian.dev.evalJsonAsync(`(async () => {
			const quickAdd = app.plugins.plugins.quickadd;
			const file = app.vault.configDir + "/plugins/quickadd/data.json";
			const data = JSON.parse(await app.vault.adapter.read(file));
			data.choices = ${JSON.stringify(choices)};
			await app.vault.adapter.write(file, JSON.stringify(data));
			await quickAdd.onExternalSettingsChange();
			return quickAdd.settings.choices.map(({ name }) => name);
		})()`),
		"QuickAdd's choices after the sync",
	).toEqual(choices.map((choice) => (choice as { name: string }).name));
}

/** Plays the fixture episode, paused at `seconds`, with these timestamp settings. */
async function playAt(
	seconds: number,
	timestamp: Partial<IPodNotesSettings["timestamp"]>,
): Promise<{ server: FixtureServer; notePath: string }> {
	const context = getContext();
	const { obsidian, plugin, sandbox } = context;
	const server = await startFixtureServer([FEED]);
	onTestFinished(() => server.stop());
	await seedLibrary(context, server, { subscriptions: [FEED], noteTemplate: NOTE_TEMPLATE });
	await plugin.updateDataAndReload<IPodNotesSettings>((data) => {
		Object.assign(data.timestamp, timestamp);
	});
	await showPodNotes(obsidian);
	await showLibrary(obsidian);
	await click(obsidian, ui.podcastCard(FEED.title));
	await click(obsidian, ui.episode("Captured episode"));
	await waitForPlayback(obsidian, (state) => (state.media?.seconds ?? 0) > 0, "episode loaded");
	await click(obsidian, ui.playbackToggle);
	await waitForPlayback(obsidian, (state) => !state.playing, "episode paused");
	await seek(seconds);
	const notePath = sandbox.path(NOTE);
	onTestFinished(() =>
		obsidian.dev.evalJsonAsync(`(async () => {
			const file = app.vault.getFileByPath(${jsLiteral(notePath)});
			if (file) await app.vault.delete(file);
			return true;
		})()`),
	);
	return { server, notePath };
}

/** Plays the fixture episode at `seconds` with this choice set, and creates its episode note. */
async function noteAt(
	seconds: number,
	quickAddChoiceId = LOG_ID,
): Promise<{ server: FixtureServer; notePath: string }> {
	const { obsidian, sandbox } = getContext();
	const played = await playAt(seconds, { template: "{{linktime}}", quickAddChoiceId });
	await runCommand(obsidian, `${PLUGIN_ID}:create-podcast-note`);
	await sandbox.waitForExists(NOTE, { timeoutMs: 10_000 });
	return played;
}

async function seek(seconds: number): Promise<void> {
	await getContext().obsidian.dev.evalJson(
		`app.plugins.plugins.${PLUGIN_ID}.api.currentTime = ${jsLiteral(seconds)}`,
	);
}

const link = (server: FixtureServer, seconds: number) =>
	`[00:00:${seconds}](obsidian://podnotes?episodeName=Captured%20episode&url=${encodeURIComponent(server.feedUrl(FEED))}&guid=captured-episode&time=${seconds})`;

function episodeNote(server: FixtureServer, captured: number[]): string {
	return [
		"---\n",
		'guid: "captured-episode"\n',
		`feedUrl: "${server.feedUrl(FEED)}"\n`,
		"---\n",
		"# Captured episode\n\n## Notes\n",
		...captured.map((seconds) => `- ${link(server, seconds)}\n`),
		"- Earlier thought\n\n## Later\n",
	].join("");
}

const QUICKADD_ROW = `[...document.querySelectorAll(".modal.mod-settings .setting-item")].filter((row) => row.querySelector(".setting-item-name")?.textContent === "QuickAdd choice")`;

/** The QuickAdd choice row's control a user sees as `label`: its text, or an icon's tooltip. */
const rowControl = (label: string): UiTarget => ({
	name: `QuickAdd choice control ${label}`,
	elements: `${QUICKADD_ROW}.flatMap((row) => [...row.querySelector(".setting-item-control").children]).filter((control) => (control.textContent || control.getAttribute("aria-label")) === ${jsLiteral(label)})`,
});

/** The QuickAdd choice row's controls a user sees, by their text or an icon's tooltip. */
async function quickAddRow(): Promise<string[]> {
	return await getContext().obsidian.dev.evalJson<string[]>(
		`${QUICKADD_ROW}.flatMap((row) => [...row.querySelector(".setting-item-control").children]).filter((control) => control.getClientRects().length > 0).map((control) => control.textContent || control.getAttribute("aria-label"))`,
	);
}

/** Opens PodNotes settings until the QuickAdd choice row shows `shown`, and saves the row as `name`. */
async function settingsShow(shown: string[], name: string): Promise<void> {
	const { obsidian } = getContext();
	await openPodNotesSettings(obsidian);
	onTestFinished(() => closeSettings(obsidian));
	expect(await eventually(obsidian, quickAddRow, shown), "the QuickAdd choice row").toEqual(
		shown,
	);
	await screenshot(name, QUICKADD_ROW);
}

/** Saves what the user sees of the first element `elements` evaluates to, at twice its size. */
async function screenshot(name: string, elements: string): Promise<void> {
	const { obsidian } = getContext();
	const clip = await obsidian.dev.evalJson<object>(`(() => {
		const element = (${elements})[0];
		element.scrollIntoView({ block: "center" });
		const { x, y, width, height } = element.getBoundingClientRect();
		return { x, y, width, height, scale: 2 };
	})()`);
	const { data } = (await cdp(obsidian, "Page.captureScreenshot", { format: "png", clip })) as {
		data: string;
	};
	await fs.mkdir(EVIDENCE, { recursive: true });
	await fs.writeFile(path.join(EVIDENCE, `${name}.png`), Buffer.from(data, "base64"));
}

async function savedChoiceId(): Promise<string | undefined> {
	const data = await getContext().plugin.data<IPodNotesSettings>().read();
	return data.timestamp.quickAddChoiceId;
}

/** Captures with the command, and checks that a notice says `notice` and no note changed. */
async function captureRefused(notePath: string, before: string, notice: string): Promise<void> {
	const { obsidian } = getContext();
	await runCommand(obsidian, `${PLUGIN_ID}:capture-timestamp`);
	expect(
		await eventually(obsidian, async () => (await notices(obsidian)).includes(notice), true),
		`the notice "${notice}"`,
	).toBe(true);
	expect(await readVaultText(obsidian, notePath), "the episode note").toBe(before);
	expect((await obsidian.exec("dev:errors")).stdout.trim()).toBe("No errors captured.");
}

describe("captures with a QuickAdd choice", () => {
	test("the command, the player and the headset run the choice, which writes after the heading", async () => {
		const { obsidian } = getContext();
		await obsidian.dev.evalJson(`(() => {
			const session = navigator.mediaSession;
			const original = session.setActionHandler;
			const handlers = new Map();
			session.setActionHandler = function(action, handler) {
				handlers.set(action, handler);
				return original.call(this, action, handler);
			};
			window.__quickAddMedia = { session, original, handlers };
			return true;
		})()`);
		onTestFinished(async () => {
			await obsidian.dev.evalJson(`(() => {
				const recorder = window.__quickAddMedia;
				if (recorder) recorder.session.setActionHandler = recorder.original;
				delete window.__quickAddMedia;
				return true;
			})()`);
		});
		await installQuickAdd(await quickAddBuild(), [LOG]);
		const { server, notePath } = await noteAt(30);
		expect(await readVaultText(obsidian, notePath), "the new episode note").toBe(
			episodeNote(server, []),
		);

		await runCommand(obsidian, `${PLUGIN_ID}:capture-timestamp`);
		expect(
			await eventually(
				obsidian,
				() => readVaultText(obsidian, notePath),
				episodeNote(server, [30]),
				10_000,
			),
			"the command's capture",
		).toBe(episodeNote(server, [30]));

		await seek(40);
		await click(obsidian, ui.playerTimestamp);
		expect(
			await eventually(
				obsidian,
				() => readVaultText(obsidian, notePath),
				episodeNote(server, [40, 30]),
				10_000,
			),
			"the player's capture",
		).toBe(episodeNote(server, [40, 30]));

		await seek(50);
		await obsidian.dev.evalJson(`(() => {
			const handler = window.__quickAddMedia.handlers.get("previoustrack");
			if (!handler) throw new Error("The headset capture handler is not installed");
			handler({ action: "previoustrack" });
			return true;
		})()`);
		expect(
			await eventually(
				obsidian,
				() => readVaultText(obsidian, notePath),
				episodeNote(server, [50, 40, 30]),
				10_000,
			),
			"the headset's capture",
		).toBe(episodeNote(server, [50, 40, 30]));
		expect(await notices(obsidian)).not.toContain("Timestamp added to Captured episode");
		expect((await obsidian.exec("dev:errors")).stdout.trim()).toBe("No errors captured.");
		await fs.mkdir(EVIDENCE, { recursive: true });
		await obsidian.dev.screenshot(path.join(EVIDENCE, "episode-note.png"));
	}, 90_000);

	test("Choose... picks a choice in QuickAdd's own picker, by typing and Enter", async () => {
		const { obsidian } = getContext();
		await installQuickAdd(await quickAddBuild(), [MEETING, LOG]);
		await settingsShow(["Choose...", "Create"], "row-unset");

		await click(obsidian, rowControl("Choose..."));
		const picker = '[...document.querySelectorAll(".qa-choice-suggester")]';
		await waitUntilShown(obsidian, { name: "QuickAdd's choice picker", elements: picker });
		await obsidian.dev.screenshot(path.join(EVIDENCE, "picker-open.png"));
		await typeText(obsidian, "Log");
		await screenshot("picker", picker);
		await pressKey(obsidian, "Enter");

		expect(await eventually(obsidian, quickAddRow, ["Log timestamp", "Clear"])).toEqual([
			"Log timestamp",
			"Clear",
		]);
		expect(await eventually(obsidian, savedChoiceId, LOG_ID), "the saved choice").toBe(LOG_ID);
		await screenshot("row-set", QUICKADD_ROW);
		expect((await obsidian.exec("dev:errors")).stdout.trim()).toBe("No errors captured.");
	}, 60_000);

	test("Create adds QuickAdd's ready-made choice, whose captures create the note and add one bullet each", async () => {
		const { obsidian } = getContext();
		await installQuickAdd(await quickAddBuild(), []);
		const { server, notePath } = await playAt(30, {});
		await settingsShow(["Choose...", "Create"], "row-before-create");

		await click(obsidian, rowControl("Create"));

		expect(await eventually(obsidian, quickAddRow, ["Podcast capture", "Clear"])).toEqual([
			"Podcast capture",
			"Clear",
		]);
		expect(await eventually(obsidian, savedChoiceId, "podnotes-capture")).toBe(
			"podnotes-capture",
		);
		await closeSettings(obsidian);
		expect(
			await obsidian.dev.evalJson("app.vault.getFileByPath(" + jsLiteral(notePath) + ")"),
			"no episode note before the capture",
		).toBeNull();

		await runCommand(obsidian, `${PLUGIN_ID}:capture-timestamp`);
		const first = `## Notes\n- ${link(server, 30)} `;
		expect(
			await eventually(
				obsidian,
				() => readVaultText(obsidian, notePath).catch(() => ""),
				first,
			),
			"the first capture",
		).toBe(first);
		await seek(40);
		await runCommand(obsidian, `${PLUGIN_ID}:capture-timestamp`);
		const second = `${first}\n- ${link(server, 40)} `;
		expect(
			await eventually(obsidian, () => readVaultText(obsidian, notePath), second),
			"the second capture, last in the section",
		).toBe(second);
		expect((await obsidian.exec("dev:errors")).stdout.trim()).toBe("No errors captured.");
	}, 90_000);

	test("a choice renamed in QuickAdd still runs and shows its new name; a deleted one writes nothing", async () => {
		const { obsidian } = getContext();
		await installQuickAdd(await quickAddBuild(), [LOG]);
		const { server, notePath } = await noteAt(30);

		await syncQuickAddChoices([logChoice("Podcast log")]);
		await settingsShow(["Podcast log", "Clear"], "row-renamed");
		await closeSettings(obsidian);
		await runCommand(obsidian, `${PLUGIN_ID}:capture-timestamp`);
		expect(
			await eventually(
				obsidian,
				() => readVaultText(obsidian, notePath),
				episodeNote(server, [30]),
				10_000,
			),
			"the renamed choice's capture",
		).toBe(episodeNote(server, [30]));

		await syncQuickAddChoices([MEETING]);
		await settingsShow(["Missing choice", "Clear"], "row-missing");
		await closeSettings(obsidian);
		await seek(40);
		await captureRefused(
			notePath,
			episodeNote(server, [30]),
			"The QuickAdd choice no longer exists. Choose another in PodNotes settings.",
		);
	}, 90_000);

	test("QuickAdd 2.32.1, from before choice picking, asks for an update and runs nothing", async () => {
		await installQuickAdd(await oldQuickAdd(), [LOG]);
		const { server, notePath } = await noteAt(30);
		await settingsShow(["Update QuickAdd", "Clear"], "row-update");
		await closeSettings(getContext().obsidian);

		await captureRefused(
			notePath,
			episodeNote(server, []),
			"Update QuickAdd to capture with a QuickAdd choice",
		);
	}, 60_000);

	test("without QuickAdd installed, or enabled, a capture says which and changes no note", async () => {
		const { obsidian } = getContext();
		const { server, notePath } = await noteAt(30);
		const editorText = () =>
			obsidian.dev.evalJson<string | null>(
				`app.workspace.getLeavesOfType("markdown").find((leaf) => leaf.view.file?.path === ${jsLiteral(notePath)})?.view.editor.getValue() ?? null`,
			);
		expect(
			await eventually(obsidian, editorText, episodeNote(server, [])),
			"the episode note open in its editor",
		).toBe(episodeNote(server, []));
		await settingsShow(["Install QuickAdd", "Clear"], "row-install");
		await closeSettings(obsidian);

		await captureRefused(
			notePath,
			episodeNote(server, []),
			"Install QuickAdd to capture with a QuickAdd choice",
		);
		expect(await editorText()).toBe(episodeNote(server, []));

		await installQuickAdd(await oldQuickAdd(), [LOG], { enable: false });
		await settingsShow(["Enable QuickAdd", "Clear"], "row-enable");
		await closeSettings(obsidian);
		await captureRefused(
			notePath,
			episodeNote(server, []),
			"Enable QuickAdd to capture with a QuickAdd choice",
		);
	}, 60_000);
});
