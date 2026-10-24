import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness } from "./harness";
import {
	assertSingleWindow,
	closeSettings,
	dismissNotices,
	openPodNotesSettings,
	restartObsidian,
	showPodNotes,
} from "./journey/actions";
import { click } from "./journey/input";
import { ui, type UiTarget } from "./journey/targets";

import {
	restoreJourneyCache,
	restoreJourneyWorkspace,
	snapshotJourneyState,
} from "./journey/library";
import { jsLiteral, waitForPodNotesReady } from "./runtime";

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

describe("a restart that finds app.json broken", () => {
	let appPath = "";
	let originalBytes = Buffer.alloc(0);
	let original: Record<string, unknown> = {};
	let seeded = Buffer.alloc(0);
	let seededConfig: Record<string, unknown> = {};
	beforeAll(async () => {
		const { obsidian } = getContext();
		appPath = path.join(await obsidian.vaultPath(), ".obsidian", "app.json");
		originalBytes = await readFile(appPath);
		original = await obsidian.dev.evalJson<Record<string, unknown>>("app.vault.config");
		seededConfig = { ...original, podnotesE2eUnrelated: "kept" };
		// Tabs and a final newline, which Obsidian's own saves never write.
		seeded = Buffer.from(
			`${JSON.stringify({ ...JSON.parse(originalBytes.toString("utf8")), podnotesE2eUnrelated: "kept" }, null, "\t")}\n`,
		);
		await writeFile(appPath, seeded);
		await obsidian.dev.evalJson(`app.vault.config = ${jsLiteral(seededConfig)}, true`);
	});
	afterAll(async () => {
		await getContext().obsidian.dev.evalJson(
			`app.vault.requestSaveConfig.cancel(), app.vault.config = ${jsLiteral(original)}, true`,
		);
		await writeFile(appPath, originalBytes);
	});

	test.for([
		["emptied", "", {}],
		[
			"without the runner's settings",
			'{"podnotesE2eUnrelated":"kept"}',
			{ podnotesE2eUnrelated: "kept" },
		],
	] as const)(
		"opens Settings in the main window when app.json is %s, and restores its exact bytes",
		async ([, broken, kept]) => {
			const { obsidian } = getContext();
			await restartObsidian(obsidian, () => writeFile(appPath, broken));
			expect(await obsidian.dev.evalJson("app.vault.config")).toMatchObject({
				settingsPopoutWindow: false,
				spellcheck: false,
				trashOption: "local",
				...kept,
			});
			await openPodNotesSettings(obsidian);
			await closeSettings(obsidian);

			await obsidian.dev.evalJson(
				'app.vault.setConfig("podnotesE2eUnrelated", "changed"), true',
			);
			await restoreJourneyWorkspace(obsidian);
			expect(await obsidian.dev.evalJson("app.vault.config")).toEqual(seededConfig);
			// Obsidian saves a changed config 1 s after the change.
			await obsidian.sleep(2_500);
			expect(await readFile(appPath)).toEqual(seeded);
		},
	);
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

describe("each test's sandbox", () => {
	test.each(["first", "second"])(
		"lets the %s test create the same folder inside the file's sandbox",
		async () => {
			const { obsidian, sandbox } = getContext();
			expect(path.posix.dirname(sandbox.root)).toMatch(/(^|\/)harness-isolation-[^/]+$/);
			await obsidian.dev.evalJsonAsync(
				`(async () => { await app.vault.createFolder(${jsLiteral(sandbox.path("Moved"))}); return true; })()`,
			);
		},
	);
});

const TRICKY = `say "hi" \\ to\n</script> \u2028\u2029 end`;

test("evaluates quoted values as the same values, and matches attributes holding them", async () => {
	const { obsidian } = getContext();
	const values = [TRICKY, { nested: [TRICKY, 1, null, true], "key with </script>": TRICKY }];
	for (const value of values) {
		expect(jsLiteral(value)).not.toMatch(/[<>\u2028\u2029]/);
		expect(await obsidian.dev.evalJson(`(${jsLiteral(value)})`)).toEqual(value);
	}
	expect(await obsidian.dev.evalJson<string>(`typeof ${jsLiteral(undefined)}`)).toBe("undefined");
	expect(() => jsLiteral(() => undefined)).toThrow("has no JavaScript literal");
	for (const [value, number] of [
		[Number.NaN, "NaN"],
		[Number.NEGATIVE_INFINITY, "-Infinity"],
		[-0, "-0"],
		[{ nested: [1, Number.POSITIVE_INFINITY] }, "Infinity"],
		[{ seconds: -0 }, "-0"],
	] as const)
		expect(() => jsLiteral(value)).toThrow(`${number} has no JSON literal`);
	expect(jsLiteral([0, -1.5])).toBe("[0,-1.5]");

	await showPodNotes(obsidian);
	const count = (target: UiTarget) =>
		obsidian.dev.evalJson<number>(`(${target.elements}).length`);
	await obsidian.dev.evalJson(`(() => {
		const button = document.createElement("button");
		button.className = "pn-back podnotes-e2e-probe";
		button.setAttribute("aria-label", ${jsLiteral(`Back to ${TRICKY}`)});
		document.querySelector(".podcast-view").append(button);
		return true;
	})()`);
	try {
		expect(await count(ui.backTo(TRICKY))).toBe(1);
		expect(await count(ui.backTo(`${TRICKY} `))).toBe(0);
	} finally {
		await obsidian.dev.evalJson(
			'document.querySelector(".podnotes-e2e-probe")?.remove(), true',
		);
	}
});

test("names the popout config when Settings would open outside the main window", async () => {
	const { obsidian } = getContext();
	// The config object, not setConfig, so app.json is never written.
	await obsidian.dev.evalJson("delete app.vault.config.settingsPopoutWindow, true");
	try {
		await expect(openPodNotesSettings(obsidian)).rejects.toThrow(
			"settingsPopoutWindow config is true, so Settings opens in a popout window",
		);
	} finally {
		await obsidian.dev.evalJson("app.vault.config.settingsPopoutWindow = false, true");
	}
	await assertSingleWindow(obsidian);
});

test("reports persistent Notices and waits for expiring Notices", async () => {
	const { obsidian } = getContext();
	const probe: UiTarget = {
		name: "covered probe",
		elements: '[...document.querySelectorAll(".podnotes-e2e-probe")]',
	};
	const coverWith = async (notice: string) => {
		await obsidian.dev.evalJson(`${notice}, true`);
		await obsidian.waitFor(
			() =>
				obsidian.dev.evalJson<boolean>(`(() => {
				const notice = document.querySelector(".notice");
				const rect = notice.getBoundingClientRect();
				return rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight
					&& notice.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
			})()`),
			{ timeoutMs: 5_000, message: "the fixture Notice inside the viewport" },
		);
		await obsidian.dev.evalJson(`(() => {
			const rect = document.querySelector(".notice").getBoundingClientRect();
			const button = document.createElement("button");
			button.className = "podnotes-e2e-probe";
			button.onclick = () => { button.dataset.clicked = "true"; };
			button.style.cssText = \`position: fixed; left: \${rect.x}px; top: \${rect.y}px; width: \${rect.width}px; height: \${rect.height}px\`;
			document.body.append(button);
			return true;
		})()`);
	};
	const uncover = async () => {
		await dismissNotices(obsidian);
		await obsidian.dev.evalJson(
			'document.querySelector(".podnotes-e2e-probe")?.remove(), true',
		);
	};
	try {
		await coverWith('new Notice("Probe needs a decision", 0).addButton("Dismiss", () => {})');
		await expect(click(obsidian, probe, { timeoutMs: 300 })).rejects.toThrow(
			'covered probe is covered by a Notice: "Probe needs a decision"',
		);
		await uncover();

		await coverWith('new Notice("Persistent without buttons", 0)');
		await expect(click(obsidian, probe, { timeoutMs: 300 })).rejects.toThrow(
			'is covered by a Notice: "Persistent without buttons"',
		);
		await uncover();
		await coverWith(
			'new Notice("Expires despite its button", 1_000).addButton("Dismiss", () => {})',
		);
		await click(obsidian, probe);
		expect(
			await obsidian.dev.evalJson<string>(
				'document.querySelector(".podnotes-e2e-probe").dataset.clicked',
			),
		).toBe("true");
		await uncover();
		await coverWith('window.__podnotesProbeNotice = new Notice("Progress until hidden", 0)');
		await obsidian.dev.evalJson(`(() => {
			setTimeout(() => {
				window.__podnotesProbeNotice.hide();
				delete window.__podnotesProbeNotice;
			}, 500);
			return true;
		})()`);
		await click(obsidian, probe);
		expect(
			await obsidian.dev.evalJson<string>(
				'document.querySelector(".podnotes-e2e-probe").dataset.clicked',
			),
		).toBe("true");
	} finally {
		await uncover();
	}
});
