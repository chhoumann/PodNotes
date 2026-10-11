import { describe, expect, test } from "vitest";
import { createPodNotesE2EHarness } from "./harness";
import {
	click,
	closePodNotes,
	reloadObsidian,
	setMobileEmulation,
	shownText,
	ui,
	waitUntilShown,
} from "./journey/actions";
import { playerLeafCount, seedLibrary } from "./journey/library";

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
		for (let check = 0; check < 5; check++) {
			expect(await playerLeafCount(obsidian)).toBe(0);
			await obsidian.sleep(300);
		}

		await click(obsidian, ui.leftDrawerToggle);
		await click(obsidian, ui.ribbonAction("Show PodNotes"));
		await waitUntilShown(obsidian, ui.podcastViewport);
		expect(await playerLeafCount(obsidian)).toBe(1);

		await click(obsidian, ui.playlistCard("Local Files"));
		await obsidian.waitFor(async () => (await shownText(obsidian)).includes("Local Files"), {
			timeoutMs: 10_000,
			message: "the Local Files list",
		});
		expect(await shownText(obsidian)).toContain("No episodes found.");
	}, 120_000);
});
