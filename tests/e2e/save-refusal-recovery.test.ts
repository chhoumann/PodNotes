import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ObsidianClient } from "obsidian-e2e";
import { describe, expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness, type PodNotesData } from "./harness";
import { closeSettings, openPodNotesSettings } from "./journey/actions";
import { chooseFile, click, typeInto } from "./journey/input";
import { ui } from "./journey/targets";
import { RELOAD_OPTIONS, waitForPodNotesReady } from "./runtime";

const getContext = createPodNotesE2EHarness("save-refusal-recovery");
const POLL = { timeout: 15_000, interval: 200 };
const progress = {
	title: "Saved episode",
	podcastName: "Recovery",
	time: 42,
	duration: 90,
	finished: false,
};

async function seed() {
	const context = getContext();
	await context.plugin.updateDataAndReload<PodNotesData>((data) => {
		data.currentEpisode = undefined;
		data.skipForwardLength = 15;
		data.savedFeeds = {
			Recovery: {
				title: "Recovery",
				url: "https://example.com/recovery.xml",
				artworkUrl: "",
			},
		};
		data.playedEpisodes = { "Recovery::Saved episode": progress };
	}, RELOAD_OPTIONS);
	await waitForPodNotesReady(context.obsidian);
	await context.obsidian.dev.evalJsonAsync(`(async () => {
		const p = app.plugins.plugins.podnotes;
		p.api.volume = 0.8;
		await p.flushSaves();
		return true;
	})()`);
	return context;
}

async function observe(obsidian: ObsidianClient) {
	await obsidian.dev.evalJson(`(() => {
		const adapter = app.vault.adapter;
		const path = app.plugins.plugins.podnotes.manifest.dir + "/data.json";
		const read = adapter.read;
		const write = adapter.write;
		const probe = { blocked: false, reads: 0, writes: 0, notices: [] };
		const seen = new WeakSet();
		const observer = new MutationObserver(() => {
			for (const el of document.querySelectorAll(".notice")) {
				if (!seen.has(el)) { seen.add(el); probe.notices.push(el.textContent); }
			}
		});
		for (const el of document.querySelectorAll(".notice")) seen.add(el);
		observer.observe(document.body, { childList: true, subtree: true });
		adapter.read = function(file, ...args) {
			if (file === path) {
				probe.reads++;
				if (probe.blocked) return Promise.reject(new Error("PERS4 read outage"));
			}
			return read.call(this, file, ...args);
		};
		adapter.write = function(file, ...args) {
			if (file === path) probe.writes++;
			return write.call(this, file, ...args);
		};
		probe.restore = () => { adapter.read = read; adapter.write = write; observer.disconnect(); };
		window.__pers4 = probe;
		return true;
	})()`);
	onTestFinished(async () => {
		await obsidian.dev.evalJson("window.__pers4?.restore(), delete window.__pers4, true");
	});
}

async function sample(obsidian: ObsidianClient, label: string, path: string) {
	const state = await obsidian.dev.evalJson<{ reads: number; writes: number; notices: string[] }>(
		`({ reads: window.__pers4.reads, writes: window.__pers4.writes, notices: window.__pers4.notices })`,
	);
	const bytes = await readFile(path).catch((error: NodeJS.ErrnoException) => {
		if (error.code === "ENOENT") return null;
		throw error;
	});
	console.info(
		JSON.stringify({
			label,
			...state,
			sha256: bytes && createHash("sha256").update(bytes).digest("hex"),
		}),
	);
	await capture(obsidian, label);
	return state;
}

async function capture(obsidian: ObsidianClient, label: string) {
	const directory = resolve(".obsidian-e2e-artifacts/save-refusal-recovery");
	await mkdir(directory, { recursive: true });
	await obsidian.dev.screenshot(resolve(directory, `${label}.png`));
}

async function externalChange(obsidian: ObsidianClient) {
	await obsidian.dev.evalJsonAsync(
		"app.plugins.plugins.podnotes.onExternalSettingsChange().then(() => true)",
	);
}

async function outage(obsidian: ObsidianClient) {
	await obsidian.dev.evalJson("window.__pers4.blocked = true");
	await externalChange(obsidian);
	await expect
		.poll(
			async () =>
				(await obsidian.dev.notices()).some((n) => n.message.includes("could not read")),
			POLL,
		)
		.toBe(true);
}

describe("save refusal recovery", () => {
	test("#431 restores the full idle library after an unreadable file is moved away without an edit", async () => {
		const { obsidian, plugin } = await seed();
		const path = await plugin.dataPath();
		const original = await readFile(path, "utf8");
		await observe(obsidian);
		onTestFinished(async () => {
			await rm(path + ".unreadable", { force: true });
		});
		await writeFile(path, "{");
		await expect
			.poll(
				async () =>
					(await obsidian.dev.notices()).some((n) =>
						n.message.includes("could not read"),
					),
				POLL,
			)
			.toBe(true);
		await sample(obsidian, "idle-refused", path);
		expect(await readFile(path, "utf8")).toBe("{");
		await rename(path, path + ".unreadable");
		await obsidian.sleep(12_000);
		await sample(obsidian, "idle-recovered", path);
		const restored = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return "missing";
			throw error;
		});
		expect(restored).not.toBe("missing");
		expect(JSON.parse(restored)).toEqual(JSON.parse(original));
		expect((await sample(obsidian, "idle-once", path)).writes).toBe(1);
	});

	test.each([99, 1])(
		"#429 schema %s stops retries and shows one actionable Notice without writing",
		async (version) => {
			const { obsidian, plugin } = await seed();
			await openPodNotesSettings(obsidian);
			onTestFinished(() => closeSettings(obsidian));
			await obsidian.dev.evalJsonAsync(`(async () => {
			const p = app.plugins.plugins.podnotes;
			p.api.volume = 0.95;
			await p.flushSaves();
			p.checkpoint(() => { p.api.volume = 0.9; });
			return true;
		})()`);
			await observe(obsidian);
			const data = await plugin.data<PodNotesData>().read();
			await plugin.data<PodNotesData>().write({ ...data, schemaVersion: version });
			const path = await plugin.dataPath();
			const protectedText = await readFile(path, "utf8");
			await externalChange(obsidian);
			await typeInto(obsidian, ui.settingControl("Skip forward (s)", "input"), "25", {
				replace: true,
			});
			await obsidian.sleep(500);
			const before = await sample(obsidian, `schema-${version}-refused`, path);
			await obsidian.sleep(21_000);
			const after = await sample(obsidian, `schema-${version}-waiting`, path);
			expect.soft(after.notices.filter((text) => /PodNotes/.test(text))).toHaveLength(1);
			expect
				.soft(after.notices.join(" "))
				.toMatch(version === 99 ? /updat.*PodNotes/i : /restart|reload/i);
			expect.soft(after.reads).toBe(before.reads);
			expect(after.writes).toBe(0);
			expect(await readFile(path, "utf8")).toBe(protectedText);
		},
	);

	test("#430 imports through the file picker immediately after a read outage clears", async () => {
		const { obsidian, plugin, sandbox } = await seed();
		await openPodNotesSettings(obsidian);
		onTestFinished(() => closeSettings(obsidian));
		const importPath = `${await obsidian.vaultPath()}/${sandbox.path("recovery.json")}`;
		await writeFile(
			importPath,
			JSON.stringify({
				type: "podnotes-settings",
				version: 2,
				settings: { skipForwardLength: 37 },
			}),
		);
		await observe(obsidian);
		await outage(obsidian);
		await obsidian.dev.evalJson("window.__pers4.blocked = false");
		await chooseFile(obsidian, ui.settingControl("Import settings", "button"), importPath);
		await click(obsidian, {
			name: "Import confirmation",
			elements:
				'[...document.querySelectorAll(".modal button.mod-destructive")].filter(el => el.textContent.trim() === "Import")',
		});
		await obsidian.sleep(1000);
		await sample(obsidian, "import-recovered", await plugin.dataPath());
		expect((await plugin.data<PodNotesData>().read()).skipForwardLength).toBe(37);
		expect(
			(await plugin.data<PodNotesData>().read()).playedEpisodes?.["Recovery::Saved episode"],
		).toEqual(progress);
	});

	test("#430 links an API key immediately after a read outage clears", async () => {
		const { obsidian, plugin } = await seed();
		await obsidian.dev.evalJson(
			'app.secretStorage.setSecret("podnotes-pers4-recovery", "sk-podnotes-e2e-recovery"), true',
		);
		try {
			await openPodNotesSettings(obsidian);
			await observe(obsidian);
			await outage(obsidian);
			await obsidian.dev.evalJson("window.__pers4.blocked = false");
			await click(obsidian, ui.settingControl("OpenAI API key", "button"));
			await click(obsidian, {
				name: "Recovery secret",
				elements:
					'[...document.querySelectorAll(".modal .suggestion-item")].filter(el => el.textContent.includes("podnotes-pers4-recovery"))',
			});
			await click(obsidian, {
				name: "Save secret selection",
				elements:
					'[...document.querySelectorAll(".modal button")].filter(el => el.textContent.trim() === "Save")',
			});
			await obsidian.sleep(500);
			await sample(obsidian, "key-recovered", await plugin.dataPath());
			expect((await plugin.data<PodNotesData>().read()).openAISecretId).toBe(
				"podnotes-pers4-recovery",
			);
		} finally {
			await closeSettings(obsidian);
			await obsidian.dev.evalJson(
				'app.secretStorage.setSecret("podnotes-pers4-recovery", null), true',
			);
		}
	});

	test("#431 visibility flush reads through a recovered outage before the retry interval", async () => {
		const { obsidian, plugin } = await seed();
		await observe(obsidian);
		await outage(obsidian);
		await obsidian.dev.evalJson(`(() => {
			const podnotes = app.plugins.plugins.podnotes;
			podnotes.api.volume = 0.42;
			window.__pers4.blocked = false;
			Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
			document.dispatchEvent(new Event("visibilitychange"));
			delete document.visibilityState;
			return true;
		})()`);
		await obsidian.sleep(300);
		await sample(obsidian, "visibility-recovered", await plugin.dataPath());
		expect((await plugin.data<PodNotesData>().read()).defaultVolume).toBe(0.42);
	});

	test("#432 an unread startup file says to restore access and reload, and stays protected", async () => {
		const { obsidian, plugin } = await seed();
		await plugin.disable();
		const path = await plugin.dataPath();
		await writeFile(path, "{");
		await plugin.enable();
		await waitForPodNotesReady(obsidian);
		const notices = await obsidian.dev.notices();
		await capture(obsidian, "startup-refused");
		console.info(
			JSON.stringify({
				label: "startup-refused",
				notices,
				sha256: createHash("sha256")
					.update(await readFile(path))
					.digest("hex"),
			}),
		);
		expect
			.soft(notices.map((notice) => notice.message).join(" "))
			.toMatch(
				/(?:make|restore)[^.]+(?:read|access)[^.]+(?:reload|restart)|(?:readable|read access)[^.]+(?:reload|restart)/i,
			);
		await obsidian.dev
			.evalJsonAsync(`(async () => {
			const p = app.plugins.plugins.podnotes;
			p.api.volume = 0.42;
			await p.flushSaves();
			return p.saveSettingsStrict().then(() => "saved", () => "refused");
		})()`)
			.then((result) => expect(result).toBe("refused"));
		expect(await readFile(path, "utf8")).toBe("{");
	});
});
