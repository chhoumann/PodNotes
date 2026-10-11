import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	type ObsidianClient,
	type PluginReloadOptions,
	createObsidianClient,
	resolveObsidianEnvOptions,
} from "obsidian-e2e";
import {
	type VaultRunLock,
	acquireVaultRunLock,
	clearVaultRunLockMarker,
	createPluginHarness,
} from "obsidian-e2e/vitest";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";

export const PLUGIN_ID = "podnotes";
export const VIEW_TYPE = "podcast_player_view";
// Reused by tests for sandbox content polling and the plugin-ready poll.
export const WAIT_OPTS = { timeoutMs: 15_000, intervalMs: 200 };
export const RELOAD_OPTIONS: PluginReloadOptions = {
	waitUntilReady: true,
	timeoutMs: 30_000,
	readyOptions: {
		// Plugin-ready sentinel: an always-registered command (plain unconditional
		// callback). The old "hrpn"/Reload command was removed (it disabled and
		// re-enabled the plugin, which Obsidian policy disallows).
		commandId: `${PLUGIN_ID}:podnotes-show-leaf`,
		...WAIT_OPTS,
	},
};

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
 * Canonical `OBSIDIAN_E2E_*` env is emitted by the shared runner; the legacy
 * `PODNOTES_E2E_*` aliases remain a fallback during the migration.
 */
export function createPodNotesE2EHarness(testName: string) {
	const suiteClient = createObsidianClient(
		resolveObsidianEnvOptions({ legacyPrefix: "PODNOTES" }),
	);
	let lock: VaultRunLock | undefined;
	let wasEnabled = false;
	let runtimeFailure: unknown;
	// Own the lock before shared setup reloads the plugin and can open a player leaf.
	beforeAll(async () => {
		lock = await acquireVaultRunLock({
			vaultName: suiteClient.vaultName,
			vaultPath: await suiteClient.vaultPath(),
			timeoutMs: 60_000,
		});
		await lock.publishMarker(suiteClient);
		wasEnabled = await suiteClient.plugin(PLUGIN_ID).isEnabled();
		await (await import("./journey/library")).snapshotJourneyState(suiteClient);
		await (await import("./journey/library")).installJourneyErrorRecorder(suiteClient);
	}, 90_000);
	afterAll(async () => {
		try {
			const library = await import("./journey/library");
			if (library.hasJourneySnapshot(suiteClient)) {
				await library.restoreJourneyCache(suiteClient);
				await suiteClient.plugin(PLUGIN_ID).enable();
				await waitForPodNotesReady(suiteClient);
				await suiteClient.dev.evalJsonAsync(
					"(async () => { await app.plugins.saveConfig(); return true; })()",
				);
				await library.restoreJourneyWorkspace(suiteClient);
				if (!wasEnabled) {
					await suiteClient.dev.evalJsonAsync(
						`(async () => { await app.plugins.disablePluginAndSave(${JSON.stringify(PLUGIN_ID)}); await app.plugins.saveConfig(); return true; })()`,
					);
				}
			}
			await (await import("./journey/actions")).assertNoRuntimeErrors(suiteClient);
		} finally {
			if (lock) {
				try {
					await (
						await import("./journey/library")
					).removeJourneyErrorRecorder(suiteClient);
				} finally {
					try {
						await clearVaultRunLockMarker(suiteClient);
					} finally {
						await lock.release();
					}
				}
			}
		}
	}, 60_000);
	afterEach(async () => {
		try {
			if ((await import("./journey/library")).hasJourneySnapshot(getContext().obsidian)) {
				await getContext().obsidian.dev.evalJsonAsync(
					"(async () => { await app.plugins.saveConfig(); return true; })()",
				);
			}
			await (
				await import("./journey/library")
			).restoreJourneyWorkspace(getContext().obsidian);
			await (await import("./journey/actions")).assertNoRuntimeErrors(getContext().obsidian);
		} catch (error) {
			if (runtimeFailure)
				throw new AggregateError(
					[runtimeFailure, error],
					"Runtime and workspace restoration failed.",
				);
			throw error;
		}
		if (runtimeFailure) throw runtimeFailure;
	});
	const getContext = createSharedHarness(testName);
	beforeAll(async () =>
		(await import("./journey/actions")).assertNoRuntimeErrors(getContext().obsidian),
	);
	afterEach(async () => {
		const { obsidian } = getContext();
		if ((await import("./journey/library")).hasJourneySnapshot(obsidian)) {
			try {
				await (await import("./journey/actions")).assertNoRuntimeErrors(obsidian);
			} catch (error) {
				runtimeFailure = error;
			}
		}
	});
	// The shared harness rolls back only files a test wrote through the client, so
	// data.json is snapshotted up front for tests that change settings through the UI.
	beforeEach(async () => {
		await (await import("./journey/actions")).assertNoRuntimeErrors(getContext().obsidian);
		runtimeFailure = undefined;
		await getContext().obsidian.dev.evalJson("window.__podnotesJourneyEarlyErrors = [], true");
		await getContext().obsidian.exec("dev:errors", { clear: true });
		await getContext()
			.plugin.data()
			.patch(() => undefined);
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
	// PodNotes persists asynchronously and keeps live player views; both must
	// settle before the settings file is rolled back, so they run while the
	// plugin is still enabled.
	beforeDataRestore: async (obsidian) => {
		await detachPodNotesViews(obsidian);
		await flushPodNotesSaves(obsidian);
		const library = await import("./journey/library");
		if (library.hasJourneySnapshot(obsidian)) {
			// Reload while disabled so old feed requests cannot write over the restored cache.
			await library.restoreJourneyCache(obsidian);
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

export async function waitForPodNotesReady(obsidian: ObsidianClient): Promise<void> {
	await obsidian.waitFor(() => podNotesReady(obsidian), {
		...WAIT_OPTS,
		message: "PodNotes plugin did not become ready.",
	});
}

function podNotesReady(obsidian: ObsidianClient): Promise<boolean> {
	return obsidian.dev.evalJson<boolean>(`
		Boolean(
			app.plugins.plugins.${PLUGIN_ID}?.api &&
			(app.workspace.protocolHandlers ?? app.workspace.protocolHandler?.handlers)?.has(${JSON.stringify(PLUGIN_ID)})
		)
	`);
}

async function detachPodNotesViews(obsidian: ObsidianClient): Promise<void> {
	await evalJsonAsync<boolean>(
		obsidian,
		`
		(async () => {
			await app.workspace.detachLeavesOfType(${JSON.stringify(VIEW_TYPE)});
			return true;
		})()
	`,
	);
}

async function flushPodNotesSaves(obsidian: ObsidianClient): Promise<void> {
	await evalJsonAsync<boolean>(
		obsidian,
		`
		(async () => {
			const podnotes = app.plugins.plugins.${PLUGIN_ID};
			if (!podnotes) return true;

			if (podnotes.saveChain) {
				await podnotes.saveChain;
			}

			if (podnotes.pendingSave) {
				await podnotes.saveSettings();
			}

			if (podnotes.saveChain) {
				await podnotes.saveChain;
			}

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
			const leaves = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)});
			const leaf = leaves[0] ?? app.workspace.getRightLeaf(false);

			if (!leaf) {
				return { ok: false, count: 0, activeViewType: null };
			}

			await leaf.setViewState({ type: ${JSON.stringify(VIEW_TYPE)} });
			await app.workspace.revealLeaf(leaf);
			app.workspace.setActiveLeaf(leaf, { focus: true });

			return {
				ok: true,
				count: app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)}).length,
				activeViewType: app.workspace.activeLeaf?.view?.getViewType?.() ?? leaf.view?.getViewType?.() ?? null,
			};
		})()
	`,
	);

	if (!result.ok || result.count < 1 || result.activeViewType !== VIEW_TYPE) {
		throw new Error(`Failed to open PodNotes view: ${JSON.stringify(result)}`);
	}
}
