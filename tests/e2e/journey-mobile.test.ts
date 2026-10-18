import { describe, expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness } from "./harness";
import {
	asPhone,
	closePodNotes,
	closeSettings,
	enableAsNewInstall,
	reloadObsidian,
	setMobileEmulation,
} from "./journey/actions";
import { click, touchDrag, typeText } from "./journey/input";
import { ui } from "./journey/targets";
import { holdsFor, waitUntilFocused, waitUntilShown } from "./journey/wait";
import { type FixtureFeed, startFixtureServer } from "./journey/fixtures";
import { playerLeafCount, readLibrary, seedLibrary } from "./journey/library";
import { jsLiteral, RELOAD_OPTIONS } from "./runtime";
import { assertNoNewRuntimeErrors } from "./runtime-evidence";

const getContext = createPodNotesE2EHarness("journey-mobile");

describe("mobile journeys", () => {
	// Obsidian's mobile emulation on desktop: the plugin runs its mobile code paths and
	// the mobile layout, but this is not an iOS or Android device.
	test("a restored phone sidebar shows Library when selected through the workspace picker", async () => {
		const context = getContext();
		const { obsidian } = context;
		const show: FixtureFeed = {
			title: "Sidebar Podcast",
			slug: "sidebar-podcast",
			artwork: false,
			episodes: [{ title: "Sidebar Pilot", seconds: 6 }],
		};
		const server = await startFixtureServer([show]);
		onTestFinished(() => server.stop());
		await seedLibrary(context, server, { subscriptions: [show] });
		await asPhone(obsidian);
		await obsidian.dev.evalJsonAsync(`(async () => {
			const leaf = app.workspace.getRightLeaf(false);
			await leaf.setViewState({ type: "podcast_player_view", state: { page: { kind: "library" } }, active: false });
			app.workspace.rightSplit.collapse();
			await app.workspace.saveLayout();
			return true;
		})()`);
		await reloadObsidian(obsidian);
		expect(
			await obsidian.dev.evalJson(
				'app.workspace.getLeavesOfType("podcast_player_view").map(leaf => leaf.isDeferred)',
			),
		).toEqual([true]);
		expect(
			await obsidian.dev.evalJson('document.querySelector(".podcast-view") !== null'),
		).toBe(false);

		await touchDrag(obsidian, { x: 385, y: 400 }, { x: 85, y: 400 });
		await click(obsidian, {
			name: "right sidebar view picker",
			elements:
				'[...document.querySelectorAll(".workspace-drawer.mod-right .workspace-drawer-tab-select")]',
		});
		await click(obsidian, {
			name: "Podcast Player sidebar option",
			elements:
				"[...document.querySelectorAll('.workspace-drawer.mod-right .workspace-drawer-tab-options-list [aria-label=\"Podcast Player\"]')]",
		});
		await waitUntilShown(obsidian, ui.libraryHead);
		await waitUntilShown(obsidian, ui.podcastCard(show.title));
		expect(await playerLeafCount(obsidian)).toBe(1);
	}, 120_000);
	test("J-ONB-02 a new install on mobile opens PodNotes once, on First run, ready to type", async () => {
		const context = getContext();
		const { obsidian, plugin } = context;
		const show: FixtureFeed = {
			title: "Journey Mobile Start",
			slug: "mobile-start",
			artwork: false,
			episodes: [{ title: "Mobile Start Pilot", seconds: 6 }],
		};
		const server = await startFixtureServer([show]);
		onTestFinished(() => server.stop());
		await seedLibrary(context, null);
		await setMobileEmulation(obsidian, true);
		await enableAsNewInstall(obsidian);

		await waitUntilShown(obsidian, ui.firstRun);
		expect(await holdsFor(obsidian, () => playerLeafCount(obsidian), 1)).toBe(1);
		expect((await readLibrary(plugin)).subscriptions).toEqual([]);

		await waitUntilFocused(obsidian, ui.podcastSearch);
		await typeText(obsidian, server.feedUrl(show));
		await waitUntilShown(obsidian, ui.addPodcast(show.title));
		await assertNoNewRuntimeErrors(obsidian);
	}, 120_000);

	test("J-ONB-02 on a later mobile start PodNotes stays closed until its ribbon icon opens it", async () => {
		const context = getContext();
		const { obsidian } = context;
		await seedLibrary(context, null);

		await setMobileEmulation(obsidian, true);
		await closePodNotes(obsidian);
		await obsidian.dev.evalJsonAsync(
			"(async () => { await app.workspace.saveLayout(); return true; })()",
		);
		await reloadObsidian(obsidian);
		expect(await holdsFor(obsidian, () => playerLeafCount(obsidian), 0)).toBe(0);

		await click(obsidian, ui.leftDrawerToggle);
		await click(obsidian, ui.ribbonAction("Show PodNotes"));
		await waitUntilShown(obsidian, ui.podcastViewport);
		expect(await playerLeafCount(obsidian)).toBe(1);

		await waitUntilShown(obsidian, ui.firstRun);
		onTestFinished(() => closeSettings(obsidian));
		await click(obsidian, ui.firstRunSettings);
		await waitUntilShown(obsidian, ui.settingHeading("Notes"));
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
			`app.saveLocalStorage("podnotes:feed-cache:v5", ${jsLiteral(legacyCache)}), true`,
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
