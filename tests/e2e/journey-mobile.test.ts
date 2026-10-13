import { describe, expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness } from "./harness";
import {
	click,
	closePodNotes,
	closeSettings,
	reloadObsidian,
	setMobileEmulation,
	ui,
	waitUntilShown,
} from "./journey/actions";
import { playerLeafCount, readLibrary, seedLibrary } from "./journey/library";
import { RELOAD_OPTIONS } from "./runtime";

const getContext = createPodNotesE2EHarness("journey-mobile");

describe("mobile journeys", () => {
	// Obsidian's mobile emulation on desktop: the plugin runs its mobile code paths and
	// the mobile layout, but this is not an iOS or Android device.
	test("J-ONB-02 on a mobile first launch PodNotes stays closed until its ribbon icon opens it", async () => {
		const context = getContext();
		const { obsidian } = context;
		await seedLibrary(context, null);

		await setMobileEmulation(obsidian, true);
		await closePodNotes(obsidian);
		await obsidian.dev.evalJsonAsync(
			"(async () => { await app.workspace.saveLayout(); return true; })()",
		);
		await reloadObsidian(obsidian);
		const deadline = Date.now() + 1500;
		const leaves = await obsidian.waitFor(
			async () => {
				const count = await playerLeafCount(obsidian);
				return count > 0 || Date.now() >= deadline ? { count } : false;
			},
			{ timeoutMs: 10_000, intervalMs: 100, message: "the mobile player to remain closed" },
		);
		expect(leaves.count).toBe(0);

		await click(obsidian, ui.leftDrawerToggle);
		await click(obsidian, ui.ribbonAction("Show PodNotes"));
		await waitUntilShown(obsidian, ui.podcastViewport);
		expect(await playerLeafCount(obsidian)).toBe(1);

		await waitUntilShown(obsidian, ui.firstRun);
		onTestFinished(() => closeSettings(obsidian));
		await click(obsidian, ui.firstRunSettings);
		await waitUntilShown(obsidian, ui.podcastSearch);
	}, 120_000);

	test("J-EDGE-13 a private feed URL moved to SecretStorage on a mobile start leaves no copy in the old feed cache", async () => {
		const context = getContext();
		const { obsidian, plugin } = context;
		const secretUrl = "https://private.example.test/feed.xml?auth=journey-secret";
		await seedLibrary(context, null);
		await setMobileEmulation(obsidian, true);
		await closePodNotes(obsidian);
		const legacyCache = JSON.stringify({
			[secretUrl]: {
				updatedAt: Date.now(),
				episodes: [{ title: "Private Episode", url: secretUrl, feedUrl: secretUrl }],
			},
		});
		await obsidian.dev.evalJson(
			`app.saveLocalStorage("podnotes:feed-cache:v5", ${JSON.stringify(legacyCache)}), true`,
		);

		await plugin.updateDataAndReload<Record<string, any>>((data) => {
			data.savedFeeds = {
				"Journey Private": { title: "Journey Private", url: secretUrl, artworkUrl: "" },
			};
		}, RELOAD_OPTIONS);

		expect(await playerLeafCount(obsidian)).toBe(0);
		const [saved] = (await readLibrary(plugin)).subscriptions;
		expect(saved.title).toBe("Journey Private");
		expect(saved.url).not.toContain("journey-secret");
		const legacy = await obsidian.dev.evalJson<string | null>(
			'app.loadLocalStorage("podnotes:feed-cache:v5")',
		);
		expect(legacy ?? "").not.toContain("journey-secret");
	}, 120_000);
});
