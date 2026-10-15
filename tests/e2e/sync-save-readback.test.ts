import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { ObsidianClient } from "obsidian-e2e";
import { expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness, type PodNotesData } from "./harness";
import { closeSettings, openPodNotesSettings } from "./journey/actions";
import { typeInto } from "./journey/input";
import { ui } from "./journey/targets";
import { jsLiteral, RELOAD_OPTIONS, WAIT_OPTS } from "./runtime";

const getContext = createPodNotesE2EHarness("sync-save-readback");

const FAILURE = "PodNotes could not save your changes.";

/** Replaces data.json with `external` between the next save's write and its readback. */
async function replaceNextWrite(obsidian: ObsidianClient, external: unknown): Promise<void> {
	const { plugin } = getContext();
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
			if (file === ${jsLiteral(await plugin.dataPath())}) {
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
}

async function saveSkipForward(obsidian: ObsidianClient) {
	await typeInto(obsidian, ui.settingControl("Skip forward (s)", "input"), "25", {
		replace: true,
	});
}

async function settledProbe(obsidian: ObsidianClient) {
	await closeSettings(obsidian);
	await obsidian.dev.evalJsonAsync(
		"(async () => { await app.plugins.plugins.podnotes.flushSaves(); return true; })()",
	);
	return obsidian.dev.evalJson<{ injected: boolean; writes: number; notices: string[] }>(
		"({ injected: window.__syncSaveReadback.injected, writes: window.__syncSaveReadback.writes, notices: window.__syncSaveReadback.notices })",
	);
}

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
	await replaceNextWrite(obsidian, external);
	await saveSkipForward(obsidian);
	const disk = await plugin.waitForData<PodNotesData>(
		(data) => data.skipForwardLength === 25 && Boolean(data.savedFeeds?.Synced),
		WAIT_OPTS,
	);
	const result = await settledProbe(obsidian);
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
	expect(result.notices).not.toContain(FAILURE);
});

test("protects a private feed address that a sync copies back during a settings save", async () => {
	const { obsidian, plugin } = getContext();
	const secret = "SYNC_SAVE_READBACK_SENTINEL";
	const address = `https://private.example/feed.xml?auth=${secret}`;
	const copied = (url: string) => `copied from ${url} on another device`;
	await plugin.updateDataAndReload<Record<string, unknown>>((data) => {
		data.skipForwardLength = 15;
		data.savedFeeds = { Private: { title: "Private", url: address, artworkUrl: "" } };
		data.copiedNote = copied(address);
	}, RELOAD_OPTIONS);
	const earlier = await plugin.waitForData<Record<string, unknown>>(
		(data) => !JSON.stringify(data).includes(secret),
		WAIT_OPTS,
	);
	expect(earlier.copiedNote).toBe(copied("podnotes-private-feed:Private"));
	await openPodNotesSettings(obsidian);
	await replaceNextWrite(obsidian, { ...earlier, copiedNote: copied(address) });
	await saveSkipForward(obsidian);
	const disk = await plugin.waitForData<Record<string, unknown>>(
		(data) => data.skipForwardLength === 25,
		WAIT_OPTS,
	);
	const result = await settledProbe(obsidian);
	console.info(JSON.stringify({ ...result, disk, version: await obsidian.exec("version") }));
	expect(result.injected).toBe(true);
	expect(result.notices).not.toContain(FAILURE);
	expect(JSON.stringify(disk)).not.toContain(secret);
	expect(disk).toMatchObject({
		copiedNote: copied("podnotes-private-feed:Private"),
		savedFeeds: { Private: { url: "podnotes-private-feed:Private" } },
	});
	expect(result.writes).toBe(2);
});
