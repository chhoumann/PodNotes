import { readlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	acquireVaultRunLock,
	captureFailureArtifacts,
	clearVaultRunLockMarker,
	createObsidianClient,
	createSandboxApi,
	type ObsidianClient,
	type PluginHandle,
	type PluginReloadOptions,
	type SandboxApi,
	type VaultRunLock,
} from "obsidian-e2e";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";

export const PLUGIN_ID = "podnotes";
export const VIEW_TYPE = "podcast_player_view";
export const E2E_VAULT = process.env.PODNOTES_E2E_VAULT ?? "dev";
export const E2E_BIN = process.env.OBSIDIAN_BIN ?? "obsidian";
export const WAIT_OPTS = { timeoutMs: 15_000, intervalMs: 200 };
export const RELOAD_OPTIONS: PluginReloadOptions = {
	waitUntilReady: true,
	timeoutMs: 30_000,
	readyOptions: {
		commandId: `${PLUGIN_ID}:hrpn`,
		...WAIT_OPTS,
	},
};

type HarnessState = {
	lock?: VaultRunLock;
	obsidian?: ObsidianClient;
	plugin?: PluginHandle;
	sandbox?: SandboxApi;
};

export type PodNotesE2EContext = {
	obsidian: ObsidianClient;
	plugin: PluginHandle;
	sandbox: SandboxApi;
};

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
);

export function createPodNotesE2EHarness(testName: string) {
	const state: HarnessState = {};

	beforeAll(async () => {
		state.obsidian = createObsidianClient({
			vault: E2E_VAULT,
			bin: E2E_BIN,
			timeoutMs: 20_000,
			intervalMs: 200,
		});
		await state.obsidian.verify();

		state.lock = await acquireVaultRunLock({
			vaultName: E2E_VAULT,
			vaultPath: await state.obsidian.vaultPath(),
			onBusy: "wait",
			timeoutMs: 60_000,
		});
		await state.lock.publishMarker(state.obsidian);

		await assertDevVaultSymlinks(await state.obsidian.vaultPath());

		state.plugin = state.obsidian.plugin(PLUGIN_ID);
		state.sandbox = await createSandboxApi({
			obsidian: state.obsidian,
			sandboxRoot: "__obsidian_e2e__",
			testName,
		});

		await state.obsidian.dev.resetDiagnostics().catch(() => undefined);
		await reloadPodNotes(state.plugin, state.obsidian);
	}, 90_000);

	beforeEach((ctx) => {
		ctx.onTestFailed(async () => {
			if (!state.obsidian) return;

			await captureFailureArtifacts(
				{ id: ctx.task.id, name: ctx.task.name },
				state.obsidian,
				{
					captureOnFailure: true,
					plugin: state.plugin,
				},
			).catch((error) => {
				console.warn("PodNotes E2E artifact capture failed", error);
			});
		});
	});

	beforeEach(async () => {
		await state.obsidian?.dev.resetDiagnostics().catch(() => undefined);
	});

	afterEach(async () => {
		if (!state.plugin || !state.obsidian) return;

		await restorePodNotesData(state.plugin, state.obsidian);
	});

	afterAll(async () => {
		const errors: unknown[] = [];

		await runTeardown("restore plugin data", errors, () => {
			if (!state.plugin || !state.obsidian) return undefined;
			return restorePodNotesData(state.plugin, state.obsidian);
		});
		await runTeardown("clean sandbox", errors, () => state.sandbox?.cleanup());
		await runTeardown("clear vault lock marker", errors, () => {
			if (!state.obsidian) return undefined;
			return clearVaultRunLockMarker(state.obsidian);
		});
		await runTeardown("release vault lock", errors, () =>
			state.lock?.release(),
		);

		if (errors.length > 0) {
			throw errors[0];
		}
	}, 30_000);

	return (): PodNotesE2EContext => {
		if (!state.obsidian || !state.plugin || !state.sandbox) {
			throw new Error("PodNotes E2E harness is not initialized.");
		}

		return {
			obsidian: state.obsidian,
			plugin: state.plugin,
			sandbox: state.sandbox,
		};
	};
}

export async function reloadPodNotes(
	plugin: PluginHandle,
	obsidian: ObsidianClient,
): Promise<void> {
	await plugin.reload(RELOAD_OPTIONS);
	await waitForPodNotesReady(obsidian);
}

export async function restorePodNotesData(
	plugin: PluginHandle,
	obsidian: ObsidianClient,
): Promise<void> {
	await detachPodNotesViews(obsidian);
	await flushPodNotesSaves(obsidian);
	await plugin.disable();
	await plugin.restoreData();
	await plugin.enable();
	await waitForPodNotesReady(obsidian);
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

export async function waitForPodNotesReady(
	obsidian: ObsidianClient,
): Promise<void> {
	await obsidian.waitFor(
		async () => {
			return await obsidian.dev.evalJson<boolean>(`
			Boolean(
				app.plugins.plugins.${PLUGIN_ID}?.api &&
				app.workspace.protocolHandlers?.has(${JSON.stringify(PLUGIN_ID)})
			)
		`);
		},
		{
			...WAIT_OPTS,
			message: "PodNotes plugin did not become ready.",
		},
	);
}

type AsyncEvalEnvelope<T> =
	| { ok: true; value: T }
	| { error: { message: string; stack?: string }; ok: false };

export async function evalJsonAsync<T>(
	obsidian: ObsidianClient,
	code: string,
): Promise<T> {
	const envelope = await obsidian.dev.eval<AsyncEvalEnvelope<T>>(`
		(async () => {
			const code = ${JSON.stringify(code)};
			try {
				const value = await (0, eval)(code);
				return JSON.stringify({ ok: true, value });
			} catch (error) {
				return JSON.stringify({
					ok: false,
					error: {
						message: error instanceof Error ? error.message : String(error),
						stack: error instanceof Error ? error.stack : undefined,
					},
				});
			}
		})()
	`);

	if (!envelope.ok) {
		throw new Error(
			[
				`Failed to evaluate async Obsidian code: ${envelope.error.message}`,
				envelope.error.stack ?? "",
			]
				.filter(Boolean)
				.join("\n"),
		);
	}

	return envelope.value;
}

export async function openPodNotesView(
	obsidian: ObsidianClient,
): Promise<void> {
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

async function assertDevVaultSymlinks(vaultPath: string): Promise<void> {
	const pluginDir = path.join(vaultPath, ".obsidian", "plugins", PLUGIN_ID);

	await assertSymlinkTarget(pluginDir, "main.js");
	await assertSymlinkTarget(pluginDir, "manifest.json");
}

async function assertSymlinkTarget(
	pluginDir: string,
	fileName: string,
): Promise<void> {
	const linkPath = path.join(pluginDir, fileName);
	const expected = path.join(repoRoot, fileName);
	let target: string;

	try {
		target = await readlink(linkPath);
	} catch (error) {
		throw new Error(
			[
				"PodNotes E2E preflight failed.",
				`Expected ${linkPath} to be a symlink to ${expected}.`,
				`Could not read symlink: ${error instanceof Error ? error.message : String(error)}`,
			].join(" "),
		);
	}

	const resolvedTarget = path.resolve(path.dirname(linkPath), target);
	if (resolvedTarget !== expected) {
		throw new Error(
			[
				"PodNotes E2E preflight failed.",
				`Expected ${linkPath} to point at ${expected}.`,
				`It currently points at ${resolvedTarget}.`,
				"Repoint the dev vault plugin symlink intentionally before running npm run test:e2e.",
			].join(" "),
		);
	}
}

async function runTeardown(
	label: string,
	errors: unknown[],
	step: () => Promise<unknown> | unknown,
): Promise<void> {
	try {
		await step();
	} catch (error) {
		errors.push(error);
		console.warn(`PodNotes E2E teardown failed during ${label}`, error);
	}
}
