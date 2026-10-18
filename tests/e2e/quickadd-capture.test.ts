import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness } from "./harness";
import { runCommand, showLibrary, showPodNotes } from "./journey/actions";
import { startFixtureServer, type FixtureFeed, type FixtureServer } from "./journey/fixtures";
import { click } from "./journey/input";
import { readVaultText, seedLibrary, waitForPlayback } from "./journey/library";
import { ui } from "./journey/targets";
import { eventually, notices } from "./journey/wait";
import { jsLiteral, PLUGIN_ID } from "./runtime";
import type { IPodNotesSettings } from "../../src/types/IPodNotesSettings";

const getContext = createPodNotesE2EHarness("quickadd-capture");

const QUICKADD_VERSION = "2.32.1";
const QUICKADD_SHA256: Record<string, string> = {
	"main.js": "6423b2d14b60bc51fc6b6f61f835e08c5842d28e5a1a43ab5601ccd37b4e44c5",
	"manifest.json": "b7610b4c1d37c2c73f781c294c1a380e731e797f9858d2d825e7facc1ac3add1",
};
const QUICKADD_CACHE = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	`../../.obsidian-e2e-artifacts/releases/quickadd-${QUICKADD_VERSION}`,
);
const CHOICE = "Log timestamp";
const EVIDENCE = path.resolve(".obsidian-e2e-artifacts/quickadd-capture");

const FEED: FixtureFeed = {
	title: "QuickAdd podcast",
	slug: "quickadd",
	artwork: false,
	episodes: [{ title: "Captured episode", seconds: 60, guid: "captured-episode" }],
};
const NOTE_TEMPLATE = "# {{title}}\n\n## Notes\n- Earlier thought\n\n## Later\n";

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** QuickAdd's released files, cached in the git-ignored artifacts folder. */
async function quickAddRelease(): Promise<Map<string, Buffer>> {
	const files = new Map<string, Buffer>();
	await fs.mkdir(QUICKADD_CACHE, { recursive: true });
	for (const [name, digest] of Object.entries(QUICKADD_SHA256)) {
		const cached = path.join(QUICKADD_CACHE, name);
		let bytes = await fs.readFile(cached).catch(() => null);
		if (!bytes || sha256(bytes) !== digest) {
			const url = `https://github.com/chhoumann/quickadd/releases/download/${QUICKADD_VERSION}/${name}`;
			const response = await fetch(url);
			if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
			bytes = Buffer.from(await response.arrayBuffer());
			expect(sha256(bytes), `the QuickAdd ${QUICKADD_VERSION} ${name} digest`).toBe(digest);
			await fs.writeFile(cached, bytes);
		}
		files.set(name, bytes);
	}
	return files;
}

/** QuickAdd's data.json with one Capture choice, already migrated and announced. */
const quickAddData = {
	version: QUICKADD_VERSION,
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
	choices: [
		{
			id: "podnotes-e2e-capture",
			name: CHOICE,
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
		},
	],
};

/** Installs and enables the real QuickAdd release for this test only. */
async function enableQuickAdd(): Promise<void> {
	const { obsidian } = getContext();
	const files = await quickAddRelease();
	const configDir = await obsidian.dev.evalJson<string>("app.vault.configDir");
	const directory = path.join(await obsidian.vaultPath(), configDir, "plugins", "quickadd");
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
	await fs.writeFile(path.join(directory, "data.json"), JSON.stringify(quickAddData));
	await fs.writeFile(path.join(directory, "main.js"), files.get("main.js")!);
	await fs.writeFile(path.join(directory, "manifest.json"), files.get("manifest.json")!);
	expect(
		await obsidian.dev.evalJsonAsync(`(async () => {
			await app.plugins.loadManifests();
			await app.plugins.enablePlugin("quickadd");
			const quickAdd = app.plugins.plugins.quickadd;
			return {
				version: quickAdd?.manifest.version,
				choices: quickAdd?.settings.choices.map(({ name }) => name),
				saved: app.plugins.enabledPlugins.has("quickadd"),
			};
		})()`),
		"QuickAdd loads in memory only, with the seeded choice",
	).toEqual({ version: QUICKADD_VERSION, choices: [CHOICE], saved: false });
}

/** Plays the fixture episode, pauses it at `seconds`, and opens its new episode note. */
async function noteAt(seconds: number): Promise<{ server: FixtureServer; notePath: string }> {
	const context = getContext();
	const { obsidian, plugin, sandbox } = context;
	const server = await startFixtureServer([FEED]);
	onTestFinished(() => server.stop());
	await seedLibrary(context, server, { subscriptions: [FEED], noteTemplate: NOTE_TEMPLATE });
	await plugin.updateDataAndReload<IPodNotesSettings>((data) => {
		data.timestamp.template = "{{linktime}}";
		data.timestamp.quickAddChoice = CHOICE;
	});
	await showPodNotes(obsidian);
	await showLibrary(obsidian);
	await click(obsidian, ui.podcastCard(FEED.title));
	await click(obsidian, ui.episode("Captured episode"));
	await waitForPlayback(obsidian, (state) => (state.media?.seconds ?? 0) > 0, "episode loaded");
	await click(obsidian, ui.playbackToggle);
	await waitForPlayback(obsidian, (state) => !state.playing, "episode paused");
	await seek(seconds);
	const notePath = sandbox.path("PodNotes/QuickAdd podcast/Captured episode.md");
	onTestFinished(() =>
		obsidian.dev.evalJsonAsync(`(async () => {
			const file = app.vault.getFileByPath(${jsLiteral(notePath)});
			if (file) await app.vault.delete(file);
			return true;
		})()`),
	);
	await runCommand(obsidian, `${PLUGIN_ID}:create-podcast-note`);
	await sandbox.waitForExists("PodNotes/QuickAdd podcast/Captured episode.md", {
		timeoutMs: 10_000,
	});
	return { server, notePath };
}

async function seek(seconds: number): Promise<void> {
	await getContext().obsidian.dev.evalJson(
		`app.plugins.plugins.${PLUGIN_ID}.api.currentTime = ${jsLiteral(seconds)}`,
	);
}

function episodeNote(server: FixtureServer, captured: number[]): string {
	const link = (seconds: number) =>
		`- [00:00:${seconds}](obsidian://podnotes?episodeName=Captured%20episode&url=${encodeURIComponent(server.feedUrl(FEED))}&guid=captured-episode&time=${seconds})\n`;
	return [
		"---\n",
		'guid: "captured-episode"\n',
		`feedUrl: "${server.feedUrl(FEED)}"\n`,
		"---\n",
		"# Captured episode\n\n## Notes\n",
		...captured.map(link),
		"- Earlier thought\n\n## Later\n",
	].join("");
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
		await enableQuickAdd();
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

	test("without QuickAdd enabled, a capture says so and changes no note", async () => {
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

		await runCommand(obsidian, `${PLUGIN_ID}:capture-timestamp`);

		expect(
			await eventually(
				obsidian,
				async () =>
					(await notices(obsidian)).includes(
						"Install and enable QuickAdd to capture with a QuickAdd choice",
					),
				true,
			),
		).toBe(true);
		expect(await editorText()).toBe(episodeNote(server, []));
		expect(await readVaultText(obsidian, notePath)).toBe(episodeNote(server, []));
		expect((await obsidian.exec("dev:errors")).stdout.trim()).toBe("No errors captured.");
	}, 60_000);
});
