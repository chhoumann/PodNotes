import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	type ObsidianClient,
	createObsidianClient,
	createSandboxApi,
	resolveObsidianEnvOptions,
	type SandboxApi,
} from "obsidian-e2e";
import {
	type VaultRunLock,
	acquireVaultRunLock,
	clearVaultRunLockMarker,
	createPluginHarness,
} from "obsidian-e2e/vitest";
import { aroundAll, aroundEach } from "vitest";
import type { IPodNotesSettings } from "../../src/types/IPodNotesSettings";
import type { LocalEpisode } from "../../src/types/LocalEpisode";
import { FIXTURE_RESOLVER_RULES } from "../../scripts/e2e-instance.mjs";
import {
	assertSettingsOpenInMainWindow,
	assertSingleWindow,
	dismissNotices,
	setOffline,
} from "./journey/actions";
import {
	hasJourneySnapshot,
	normalizeJourneyLayout,
	restoreJourneyCache,
	restoreJourneyWorkspace,
	snapshotJourneyState,
} from "./journey/library";
import {
	runAllSteps,
	jsLiteral,
	PLUGIN_ID,
	podNotesReady,
	RELOAD_OPTIONS,
	VIEW_TYPE,
	WAIT_OPTS,
	waitForPodNotesReady,
} from "./runtime";
import {
	assertNoNewRuntimeErrors,
	closeRuntimeEvidence,
	installRuntimeEvidence,
} from "./runtime-evidence";

/**
 * Suite-scoped PodNotes E2E harness built on obsidian-e2e's shared
 * `createPluginHarness`: one vault lock + sandbox + reload per file, per-test
 * diagnostics reset and data restore, failure-artifact capture, and the dev
 * vault symlink preflight. Returns the `(testName) => () => context` getter the
 * test bodies already consume.
 *
 * PodNotes flushes pending saves and detaches its player views before every
 * `restoreData()` via `beforeDataRestore`, preserving the original
 * detach -> flush -> restore ordering.
 *
 * Its own setup and cleanup wrap the shared harness's hooks with `aroundAll`
 * and `aroundEach`. An `afterAll` would be skipped when an earlier one throws,
 * leaving the vault locked and unrestored.
 *
 * Canonical `OBSIDIAN_E2E_*` env is emitted by the shared runner; the legacy
 * `PODNOTES_E2E_*` aliases remain a fallback during the migration.
 */
export function createPodNotesE2EHarness(testName: string) {
	const suiteClient = createObsidianClient(
		resolveObsidianEnvOptions({ legacyPrefix: "PODNOTES" }),
	);
	aroundAll(async (runSuite) => {
		let lock: VaultRunLock | undefined;
		let snapshotted = false;
		let wasEnabled = false;
		await runAllSteps(
			async () => {
				lock = await acquireVaultRunLock({
					vaultName: suiteClient.vaultName,
					vaultPath: await suiteClient.vaultPath(),
					timeoutMs: 45_000,
				});
				await lock.publishMarker(suiteClient);
				await assertSingleWindow(suiteClient);
				// Without a keyring, Obsidian loads stored secrets with a Notice that stays
				// until dismissed, over the right sidebar's top. After a test stores a secret,
				// every reload would bring it back over the view's controls.
				await suiteClient.dev.evalJson(
					'app.saveLocalStorage("secrets-encryption-warning-dismissed", "1"), true',
				);
				await dismissNotices(suiteClient);
				// The verify skill's `screens.mjs offline on` leaves the renderer offline through
				// CDP, where no feed loads, and the instance stays up for the next run.
				await setOffline(suiteClient, false);
				const resolver = await suiteClient.dev.evalJson<string>(
					'require("@electron/remote").app.commandLine.getSwitchValue("host-resolver-rules")',
				);
				if (resolver !== FIXTURE_RESOLVER_RULES)
					throw new Error(
						"The fixture host resolver is missing. Stop this worktree's instance, then run npm run start:e2e-obsidian.",
					);
				wasEnabled = await suiteClient.plugin(PLUGIN_ID).isEnabled();
				await snapshotJourneyState(suiteClient);
				snapshotted = true;
				await normalizeJourneyLayout(suiteClient);
				await installRuntimeEvidence(suiteClient);
				await runSuite();
			},
			async () => {
				if (!snapshotted) return;
				await restoreJourneyCache(suiteClient);
				await suiteClient.plugin(PLUGIN_ID).enable();
				await waitForPodNotesReady(suiteClient);
				await suiteClient.dev.evalJsonAsync(
					"(async () => { await app.plugins.saveConfig(); return true; })()",
				);
			},
			async () => {
				if (!snapshotted || wasEnabled) return;
				await suiteClient.dev.evalJsonAsync(
					`(async () => { await app.plugins.disablePluginAndSave(${jsLiteral(PLUGIN_ID)}); await app.plugins.saveConfig(); return true; })()`,
				);
			},
			() => restoreJourneyWorkspace(suiteClient),
			() => closeRuntimeEvidence(suiteClient),
			async () => {
				if (lock) await clearVaultRunLockMarker(suiteClient);
			},
			async () => lock?.release(),
		);
	}, 60_000);
	const getFileContext = createSharedHarness(testName);
	let testSandbox: SandboxApi | undefined;
	const getContext = () => ({ ...getFileContext(), sandbox: testSandbox! });
	aroundEach(async (runTest, { task }) => {
		const { obsidian, plugin, sandbox } = getFileContext();
		// The file's sandbox is removed at teardown, and each test's folder with it.
		testSandbox = await createSandboxApi({
			obsidian,
			sandboxRoot: sandbox.root,
			testName: task.name,
		});
		await assertNoNewRuntimeErrors(obsidian, "before this test started");
		await assertSingleWindow(obsidian);
		await assertSettingsOpenInMainWindow(obsidian);
		await snapshotJourneyState(obsidian);
		await runAllSteps(
			async () => {
				// The shared harness tracks writes through its client; this snapshots data.json
				// for tests that change settings through Obsidian instead.
				await plugin.data().patch(() => undefined);
				await runTest();
			},
			async () => {
				if (!hasJourneySnapshot(obsidian)) return;
				await obsidian.dev.evalJsonAsync(
					"(async () => { await app.plugins.saveConfig(); return true; })()",
				);
			},
			() => restoreJourneyWorkspace(obsidian),
			() => assertNoNewRuntimeErrors(obsidian, "during this test or its cleanup"),
		);
	});
	return getContext;
}

const createSharedHarness = createPluginHarness({
	...resolveObsidianEnvOptions({ legacyPrefix: "PODNOTES" }),
	pluginId: PLUGIN_ID,
	sharedVaultLock: false,
	reload: {
		readyCommandId: RELOAD_OPTIONS.readyOptions?.commandId,
		timeoutMs: 30_000,
		intervalMs: WAIT_OPTS.intervalMs,
	},
	// Beyond plugin-loaded and the ready command, PodNotes is only usable once its
	// public API is attached and its protocol handler is registered.
	waitUntilReady: podNotesReady,
	// PodNotes persists asynchronously, keeps live player views, and plays on with
	// them closed; all must settle before the settings file is rolled back, so they
	// run while the plugin is still enabled.
	beforeDataRestore: async (obsidian) => {
		await detachPodNotesViews(obsidian);
		await stopPodNotesPlayback(obsidian);
		await flushPodNotesSaves(obsidian);
		if (hasJourneySnapshot(obsidian)) {
			// Reload while disabled so old feed requests cannot write over the restored cache.
			await restoreJourneyCache(obsidian);
		}
	},
	symlinkArtifacts: ["main.js", "manifest.json"],
	// Module-relative, not process.cwd(): the factory otherwise compares dev-vault
	// symlinks against <caller-cwd>/main.js, which breaks IDE-launched runs.
	symlinkRepoRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
	captureOnFailure: true,
});

/**
 * Evaluate an async body in the Obsidian runtime and decode the JSON result,
 * rethrowing remote failures (as `DevEvalError`) with their message and stack.
 * Thin adapter over the package's `obsidian.dev.evalJsonAsync` that keeps the
 * `(obsidian, code)` call shape the test bodies use.
 */
export function evalJsonAsync<T>(obsidian: ObsidianClient, code: string): Promise<T> {
	return obsidian.dev.evalJsonAsync<T>(code);
}

export async function writeSilentWav(
	obsidian: ObsidianClient,
	audioPath: string,
	seconds: number,
): Promise<void> {
	await evalJsonAsync<boolean>(
		obsidian,
		`(async () => {
			const sampleRate = 8_000;
			const sampleCount = sampleRate * ${seconds};
			const bytes = new Uint8Array(44 + sampleCount);
			const view = new DataView(bytes.buffer);
			const ascii = (offset, value) => {
				for (let index = 0; index < value.length; index++) {
					bytes[offset + index] = value.charCodeAt(index);
				}
			};

			ascii(0, "RIFF");
			view.setUint32(4, 36 + sampleCount, true);
			ascii(8, "WAVE");
			ascii(12, "fmt ");
			view.setUint32(16, 16, true);
			view.setUint16(20, 1, true);
			view.setUint16(22, 1, true);
			view.setUint32(24, sampleRate, true);
			view.setUint32(28, sampleRate, true);
			view.setUint16(32, 1, true);
			view.setUint16(34, 8, true);
			ascii(36, "data");
			view.setUint32(40, sampleCount, true);
			bytes.fill(128, 44);

			const existing = app.vault.getAbstractFileByPath(${jsLiteral(audioPath)});
			if (existing) {
				await app.vault.modifyBinary(existing, bytes.buffer);
			} else {
				await app.vault.createBinary(${jsLiteral(audioPath)}, bytes.buffer);
			}
			return true;
		})()`,
	);
}

async function detachPodNotesViews(obsidian: ObsidianClient): Promise<void> {
	await evalJsonAsync<boolean>(
		obsidian,
		`
		(async () => {
			await app.workspace.detachLeavesOfType(${jsLiteral(VIEW_TYPE)});
			return true;
		})()
	`,
	);
}

// Playing on would save a checkpoint over the rolled-back file.
async function stopPodNotesPlayback(obsidian: ObsidianClient): Promise<void> {
	await obsidian.dev.evalJson(
		`(() => { app.plugins.plugins.${PLUGIN_ID}?.api?.stop(); return true; })()`,
	);
}

async function flushPodNotesSaves(obsidian: ObsidianClient): Promise<void> {
	await evalJsonAsync<boolean>(
		obsidian,
		`
		(async () => {
			await app.plugins.plugins.${PLUGIN_ID}?.flushSaves();
			return true;
		})()
	`,
	);
}

export function expectKnownFailure<T>(
	issue: number,
	captured: T,
	known: { correct: (value: T) => void; reproduces: (value: T) => boolean },
): void {
	let failure: unknown;
	try {
		known.correct(captured);
	} catch (error) {
		failure = error;
	}
	if (failure === undefined) {
		throw new Error(
			`#${issue} no longer reproduces: remove its known-failure marker. Captured ${JSON.stringify(captured)}`,
		);
	}
	if (!known.reproduces(captured)) throw failure;
}

export async function openPodNotesView(obsidian: ObsidianClient): Promise<void> {
	const result = await evalJsonAsync<{
		activeViewType: string | null;
		count: number;
		ok: boolean;
	}>(
		obsidian,
		`
		(async () => {
			const leaves = app.workspace.getLeavesOfType(${jsLiteral(VIEW_TYPE)});
			const leaf = leaves[0] ?? app.workspace.getRightLeaf(false);

			if (!leaf) {
				return { ok: false, count: 0, activeViewType: null };
			}

			await leaf.setViewState({ type: ${jsLiteral(VIEW_TYPE)} });
			await app.workspace.revealLeaf(leaf);
			app.workspace.setActiveLeaf(leaf, { focus: true });

			return {
				ok: true,
				count: app.workspace.getLeavesOfType(${jsLiteral(VIEW_TYPE)}).length,
				activeViewType: app.workspace.activeLeaf?.view?.getViewType?.() ?? leaf.view?.getViewType?.() ?? null,
			};
		})()
	`,
	);

	if (!result.ok || result.count < 1 || result.activeViewType !== VIEW_TYPE) {
		throw new Error(`Failed to open PodNotes view: ${JSON.stringify(result)}`);
	}
}

export type PodNotesData = Partial<IPodNotesSettings> & {
	schemaVersion?: number;
	openAIApiKey?: string;
	diarizationApiKey?: string;
	legacyExtension?: { enabled: boolean };
};

export type PlaybackState = {
	currentTime: number | null;
	hasPlayer: boolean;
	isPlaying: boolean;
	title: string | null;
};

// Each sandbox writes the seeded file once.
const seededAudioPaths = new Set<string>();

export async function seedAudio(
	obsidian: Parameters<typeof evalJsonAsync>[0],
	sandbox: SandboxApi,
): Promise<string> {
	const fileName = "podnotes-e2e-silence.wav";
	const audioPath = sandbox.path(fileName);
	if (seededAudioPaths.has(audioPath)) return audioPath;

	await writeSilentWav(obsidian, audioPath, 600);
	await sandbox.waitForExists(fileName, WAIT_OPTS);
	seededAudioPaths.add(audioPath);

	return audioPath;
}

export function createLocalEpisode(title: string, audioPath: string): LocalEpisode {
	return {
		title,
		streamUrl: audioPath,
		url: audioPath,
		description: "",
		content: "",
		podcastName: "local file",
		filePath: audioPath,
	};
}

export async function invokePodNotesUri(
	obsidian: Parameters<typeof evalJsonAsync>[0],
	episode: LocalEpisode,
	time: number,
	endTime?: number,
): Promise<void> {
	const result = await evalJsonAsync<{ error?: string; ok: boolean }>(
		obsidian,
		`
		(async () => {
			const handler = (app.workspace.protocolHandlers ?? app.workspace.protocolHandler?.handlers).get(${jsLiteral(PLUGIN_ID)});
			if (!handler) {
				return { ok: false, error: "PodNotes protocol handler is not registered." };
			}

			await handler({
				action: ${jsLiteral(PLUGIN_ID)},
				url: ${jsLiteral(episode.filePath ?? episode.streamUrl)},
				episodeName: ${jsLiteral(episode.title)},
				time: ${jsLiteral(String(time))},
				endTime: ${jsLiteral(endTime === undefined ? undefined : String(endTime))},
			});

			return { ok: true };
		})()
	`,
	);

	if (!result.ok) {
		throw new Error(result.error ?? "PodNotes URI handler failed.");
	}
}

export async function waitForPlaybackState(
	obsidian: {
		dev: { evalJson: <T>(code: string) => Promise<T> };
		sleep: (ms: number) => Promise<void>;
	},
	predicate: (state: PlaybackState) => boolean,
): Promise<PlaybackState> {
	const startedAt = Date.now();
	let lastState: PlaybackState | null = null;

	while (Date.now() - startedAt < WAIT_OPTS.timeoutMs) {
		lastState = await getPlaybackState(obsidian);
		if (predicate(lastState)) return lastState;
		await obsidian.sleep(WAIT_OPTS.intervalMs);
	}

	throw new Error(
		`Timed out waiting for playback state. Last state: ${JSON.stringify(lastState)}`,
	);
}

export async function getPlaybackState(obsidian: {
	dev: { evalJson: <T>(code: string) => Promise<T> };
}): Promise<PlaybackState> {
	return await obsidian.dev.evalJson<PlaybackState>(`
		(() => {
			const plugin = app.plugins.plugins.${PLUGIN_ID};
			return {
				currentTime: plugin?.api?.currentTime ?? null,
				hasPlayer: Boolean(document.querySelector(".pn-player")),
				isPlaying: Boolean(plugin?.api?.isPlaying),
				title: plugin?.api?.podcast?.title ?? null,
			};
		})()
	`);
}
