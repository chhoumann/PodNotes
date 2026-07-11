import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	type ObsidianClient,
	type PluginReloadOptions,
	resolveObsidianEnvOptions,
} from "obsidian-e2e";
import { createPluginHarness } from "obsidian-e2e/vitest";

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
export const createPodNotesE2EHarness = createPluginHarness({
	...resolveObsidianEnvOptions({ legacyPrefix: "PODNOTES" }),
	pluginId: PLUGIN_ID,
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
