import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness } from "./harness";
import { assertSingleWindow, restartObsidian } from "./journey/actions";

import {
	restoreJourneyCache,
	restoreJourneyWorkspace,
	snapshotJourneyState,
} from "./journey/library";
import { waitForPodNotesReady } from "./runtime";

const getContext = createPodNotesE2EHarness("harness-isolation");

test("refuses a restart with an extra window before closing the test vault", async () => {
	const { obsidian } = getContext();
	const before = await obsidian.dev.evalJson<number>('require("@electron/remote").process.pid');
	const extra = await obsidian.dev.evalJson<number>(
		'new (require("@electron/remote").BrowserWindow)({ show: false }).id',
	);
	try {
		await expect(restartObsidian(obsidian)).rejects.toThrow("Expected one Obsidian window");
		expect(await obsidian.dev.evalJson<number>('require("@electron/remote").process.pid')).toBe(
			before,
		);
	} finally {
		await obsidian.dev.evalJson(
			`require("@electron/remote").BrowserWindow.fromId(${extra}).destroy(), true`,
		);
		await assertSingleWindow(obsidian);
	}
});

test("restores the explorer runtime state and exact persisted core-plugin config", async () => {
	const { obsidian, plugin } = getContext();
	const corePath = path.join(await obsidian.vaultPath(), ".obsidian", "core-plugins.json");
	const originalBytes = await readFile(corePath);
	// Appending valid JSON whitespace always differs, even after an interrupted seed.
	const seeded = Buffer.concat([originalBytes, Buffer.from("\n")]);
	onTestFinished(() => writeFile(corePath, originalBytes));
	await restoreJourneyWorkspace(obsidian);
	await writeFile(corePath, seeded);
	await snapshotJourneyState(obsidian);
	const enabled = await obsidian.dev.evalJson<boolean>(
		'app.internalPlugins.getPluginById("file-explorer").enabled',
	);
	await obsidian.dev.evalJsonAsync(`(async () => {
		const manager = app.internalPlugins;
		const explorer = manager.getPluginById("file-explorer");
		if (${enabled}) explorer.disable(true);
		else await explorer.enable(true);
		manager.requestSaveConfig.cancel();
		await manager.saveConfig();
		manager.requestSaveConfig.cancel();
		await app.vault.adapter.promise;
		return true;
	})()`);
	expect(
		await obsidian.dev.evalJson<boolean>(
			'app.internalPlugins.getPluginById("file-explorer").enabled',
		),
	).toBe(!enabled);
	expect(await readFile(corePath)).not.toEqual(seeded);

	await restoreJourneyCache(obsidian);
	await plugin.enable();
	await waitForPodNotesReady(obsidian);
	// The runtime save must not stand in for the exact-byte rollback.
	expect(await readFile(corePath)).not.toEqual(seeded);
	await obsidian.dev.evalJson(
		"app.internalPlugins.requestSaveConfig.cancel(), app.internalPlugins.requestSaveConfig(), true",
	);
	await restoreJourneyWorkspace(obsidian);
	const deadline = Date.now() + 2500;
	const restored = await obsidian.waitFor(
		async () => {
			const bytes = await readFile(corePath);
			return !bytes.equals(seeded) || Date.now() >= deadline ? { bytes } : false;
		},
		{
			timeoutMs: 10_000,
			intervalMs: 100,
			message: "exact bytes to survive pending core persistence",
		},
	);
	expect(restored.bytes).toEqual(seeded);

	expect(
		await obsidian.dev.evalJson<boolean>(
			'app.internalPlugins.getPluginById("file-explorer").enabled',
		),
	).toBe(enabled);
	expect(await readFile(corePath)).toEqual(seeded);
});

test("closes a leaked window and reports it during workspace rollback", async () => {
	const { obsidian } = getContext();
	const extra = await obsidian.dev.evalJson<number>(
		'new (require("@electron/remote").BrowserWindow)({ show: false }).id',
	);
	try {
		await expect(restoreJourneyWorkspace(obsidian)).rejects.toThrow(
			"The test leaked Obsidian windows",
		);
		expect(
			await obsidian.dev.evalJson<boolean>(
				`require("@electron/remote").BrowserWindow.fromId(${extra}) === null`,
			),
		).toBe(true);
		await assertSingleWindow(obsidian);
	} finally {
		await obsidian.dev.evalJson(
			`require("@electron/remote").BrowserWindow.fromId(${extra})?.destroy(), true`,
		);
	}
});
