import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness, type PodNotesData } from "./harness";
import { closeSettings, openPodNotesSettings } from "./journey/actions";
import { typeInto } from "./journey/input";
import { ui } from "./journey/targets";
import { jsLiteral, RELOAD_OPTIONS, WAIT_OPTS } from "./runtime";

const getContext = createPodNotesE2EHarness("sync-save-readback");

test("merges a sync replacement during a settings save without a failure Notice", async () => {
	const { obsidian, plugin } = getContext();
	await plugin.updateDataAndReload<PodNotesData>((data) => {
		data.skipForwardLength = 15;
		data.savedFeeds = {};
	}, RELOAD_OPTIONS);
	await openPodNotesSettings(obsidian);
	const external = await plugin.data<PodNotesData>().read();
	external.savedFeeds = {
		Synced: { title: "Synced", url: "https://example.com/synced.xml", artworkUrl: "" },
	};
	const dataPath = await plugin.dataPath();
	await obsidian.dev.evalJson(`(() => {
		const adapter = app.vault.adapter;
		const original = adapter.applyWriteOptions;
		const probe = { writes: 0, injected: false, notices: [] };
		const seen = new WeakSet(document.querySelectorAll(".notice"));
		const observer = new MutationObserver(() => {
			for (const el of document.querySelectorAll(".notice")) {
				if (!seen.has(el)) { seen.add(el); probe.notices.push(el.textContent); }
			}
		});
		observer.observe(document.body, { childList: true, subtree: true });
		adapter.applyWriteOptions = async function(file, options) {
			if (file === ${jsLiteral(dataPath)}) {
				probe.writes++;
				if (!probe.injected) {
					require("fs").writeFileSync(file, ${jsLiteral(JSON.stringify(external))});
					probe.injected = true;
				}
			}
			return original.call(this, file, options);
		};
		probe.restore = () => { adapter.applyWriteOptions = original; observer.disconnect(); };
		window.__syncSaveReadback = probe;
		return true;
	})()`);
	onTestFinished(async () => {
		await obsidian.dev.evalJson(
			"window.__syncSaveReadback?.restore(), delete window.__syncSaveReadback, true",
		);
	});
	await typeInto(obsidian, ui.settingControl("Skip forward (s)", "input"), "25", {
		replace: true,
	});
	const disk = await plugin.waitForData<PodNotesData>(
		(data) => data.skipForwardLength === 25 && Boolean(data.savedFeeds?.Synced),
		WAIT_OPTS,
	);
	await closeSettings(obsidian);
	await obsidian.dev.evalJsonAsync(
		"(async () => { await app.plugins.plugins.podnotes.flushSaves(); return true; })()",
	);
	const result = await obsidian.dev.evalJson<{
		injected: boolean;
		writes: number;
		notices: string[];
	}>(
		"({ injected: window.__syncSaveReadback.injected, writes: window.__syncSaveReadback.writes, notices: window.__syncSaveReadback.notices })",
	);
	console.info(JSON.stringify({ ...result, disk, version: await obsidian.exec("version") }));
	const directory = resolve(".obsidian-e2e-artifacts/sync-save-readback");
	await mkdir(directory, { recursive: true });
	await obsidian.dev.screenshot(resolve(directory, "after-save.png"));
	expect(result.injected).toBe(true);
	expect(disk.savedFeeds?.Synced).toEqual(external.savedFeeds.Synced);
	expect(
		await obsidian.dev.evalJson("app.plugins.plugins.podnotes.settings.skipForwardLength"),
	).toBe(25);
	expect(result.writes).toBe(2);
	expect(result.notices).not.toContain("PodNotes could not save your changes.");
});
