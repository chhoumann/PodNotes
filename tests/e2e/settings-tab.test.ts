import type { ObsidianClient } from "obsidian-e2e";
import { describe, expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness, type PodNotesData } from "./harness";
import {
	closeSettings,
	openPodNotesSettings,
	runCommand,
	showLibrary,
	showList,
	showPodNotes,
} from "./journey/actions";
import { pubDate, startFixtureServer, type FixtureFeed } from "./journey/fixtures";
import { click, pressKey, typeInto, typeText } from "./journey/input";
import { feedCacheHolds, recordWrites, seedLibrary } from "./journey/library";
import { PLAYER_VIEW, ui } from "./journey/targets";
import { eventually, waitUntilShown } from "./journey/wait";
import { jsLiteral, RELOAD_OPTIONS } from "./runtime";

const getContext = createPodNotesE2EHarness("settings-tab");

const FEED: FixtureFeed = {
	title: "Settings Cache Feed",
	slug: "settings-cache",
	artwork: false,
	episodes: [{ title: "Cached Episode", seconds: 6, pubDate: pubDate(1), guid: "cached" }],
};

/**
 * The names of the PodNotes rows Settings search lists for `query`. Results update a
 * moment after typing, so this waits for a list other than the previous query's.
 */
async function searchResults(
	obsidian: ObsidianClient,
	query: string,
	previous: readonly string[],
): Promise<string[]> {
	await typeInto(obsidian, ui.settingsSearch, query, { replace: true });
	const read = () =>
		obsidian.dev.evalJson<string[]>(`(() => {
			const group = [...document.querySelectorAll(".modal.mod-settings .setting-search-result-group")].find(
				(candidate) => candidate.querySelector(".setting-search-result-tab-label")?.textContent === "PodNotes",
			);
			return [...(group?.querySelectorAll(".setting-search-result-item .vertical-tab-nav-item-title") ?? [])].map(
				(item) => item.textContent,
			);
		})()`);
	let last: string[] = [];
	await obsidian.waitFor(
		async () =>
			(last = await read()).length > 0 && JSON.stringify(last) !== JSON.stringify(previous),
		{ timeoutMs: 5_000, intervalMs: 100, message: `Settings search results for ${query}` },
	);
	return last;
}

/** Every row name Settings search lists right now, from any tab. */
async function listedNow(obsidian: ObsidianClient): Promise<string[]> {
	return await obsidian.dev.evalJson<string[]>(
		`[...document.querySelectorAll(".modal.mod-settings .setting-search-result-item .vertical-tab-nav-item-title")].map((item) => item.textContent)`,
	);
}

async function settingValue(obsidian: ObsidianClient, name: string): Promise<unknown> {
	return await obsidian.dev.evalJson(`(() => {
		const row = [...document.querySelectorAll(".modal.mod-settings .setting-item")].find(
			(candidate) => candidate.querySelector(".setting-item-name")?.textContent === ${jsLiteral(name)},
		);
		const toggle = row?.querySelector(".checkbox-container");
		return toggle ? toggle.classList.contains("is-enabled") : (row?.querySelector("input, textarea")?.value ?? null);
	})()`);
}

describe("PodNotes settings tab", () => {
	test("search finds a row of each section by name, and none of the removed rows", async () => {
		const { obsidian } = getContext();
		await runCommand(obsidian, "app:open-settings");
		onTestFinished(() => closeSettings(obsidian));

		const found: Record<string, string[]> = {};
		let previous: string[] = [];
		for (const query of [
			"Skip back",
			"headset",
			"Timestamp template",
			"Deepgram",
			"Download path",
			"OPML",
			"Include API keys",
		]) {
			previous = found[query] = await searchResults(obsidian, query, previous);
		}
		expect(found).toMatchObject({
			"Skip back": expect.arrayContaining(["Skip back (s)"]),
			headset: expect.arrayContaining(["Previous track", "Next track"]),
			"Timestamp template": expect.arrayContaining(["Timestamp template"]),
			Deepgram: expect.arrayContaining(["Deepgram API key"]),
			"Download path": expect.arrayContaining(["Download path"]),
			OPML: expect.arrayContaining(["Import OPML", "Export OPML"]),
			"Include API keys": expect.arrayContaining(["Include API keys"]),
		});

		const removed = [
			"Default volume",
			"Cache podcast feeds",
			"Cache duration",
			"Clear cached feeds",
		];
		for (const name of removed) {
			await typeInto(obsidian, ui.settingsSearch, name, { replace: true });
			await obsidian.sleep(800);
			expect(await listedNow(obsidian), name).not.toContain(name);
		}
	});

	test("a text edit writes data.json once, when it completes", async () => {
		const { obsidian, plugin } = getContext();
		const typed = "UI3/Typed note path.md";
		await openPodNotesSettings(obsidian);
		onTestFinished(() => closeSettings(obsidian));
		const path = ui.settingControl("Episode note path", "input");
		await typeInto(obsidian, path, "", { replace: true });

		const typing = await recordWrites(obsidian);
		for (const character of typed) await typeText(obsidian, character);
		await obsidian.sleep(1_000);
		expect(await typing.stop(), "writes while typing").toMatchObject({ attempted: 0 });

		const completing = await recordWrites(obsidian);
		await pressKey(obsidian, "Tab");
		await plugin.waitForData<PodNotesData>((data) => data.note?.path === typed, {
			timeoutMs: 5_000,
			intervalMs: 100,
		});
		await obsidian.sleep(500);
		expect(await completing.stop(), "writes for the completed edit").toMatchObject({
			attempted: 1,
			completed: 1,
			failed: 0,
		});
	});

	test("an edit still in its field is saved when Settings closes", async () => {
		const { obsidian, plugin } = getContext();
		await openPodNotesSettings(obsidian);
		await typeInto(
			obsidian,
			ui.settingControl("Transcript path", "input"),
			"Kept/{{title}}.md",
			{
				replace: true,
			},
		);

		await closeSettings(obsidian);

		await plugin.waitForData<PodNotesData>(
			(data) => data.transcript?.path === "Kept/{{title}}.md",
			{ timeoutMs: 5_000, intervalMs: 100 },
		);
	});

	test("the queue toggle follows the Queue page menu while Settings is open", async () => {
		const context = getContext();
		const { obsidian, plugin } = context;
		const server = await startFixtureServer([FEED]);
		onTestFinished(() => server.stop());
		await seedLibrary(context, server, { subscriptions: [FEED] });
		await showPodNotes(obsidian);
		await showList(obsidian, "Queue");
		await openPodNotesSettings(obsidian);
		onTestFinished(() => closeSettings(obsidian));
		expect(await settingValue(obsidian, "Queue episodes I switch away from")).toBe(true);

		// Settings covers the view, so its menu button is clicked the way a popout user reaches it.
		await obsidian.dev.evalJson(
			`document.querySelector(${jsLiteral(`${PLAYER_VIEW} button[aria-label="Queue options"]`)}).click(), true`,
		);
		await click(obsidian, ui.menuItem("Queue episodes I switch away from"));

		expect(
			await eventually(
				obsidian,
				() => settingValue(obsidian, "Queue episodes I switch away from"),
				false,
			),
		).toBe(false);
		await plugin.waitForData<PodNotesData>((data) => data.autoQueue === false, {
			timeoutMs: 5_000,
			intervalMs: 100,
		});
	});

	test("feeds are cached even when caching was saved as off, and the next save drops that", async () => {
		const context = getContext();
		const { obsidian, plugin } = context;
		const server = await startFixtureServer([FEED]);
		onTestFinished(() => server.stop());
		await seedLibrary(context, server, { subscriptions: [FEED] });
		await plugin.updateDataAndReload<PodNotesData & { feedCache?: unknown }>((data) => {
			data.feedCache = { enabled: false, ttlHours: 1 };
		}, RELOAD_OPTIONS);
		expect(await plugin.data<{ feedCache?: unknown }>().read()).toMatchObject({
			feedCache: { enabled: false, ttlHours: 1 },
		});

		await showPodNotes(obsidian);
		await showLibrary(obsidian);
		await click(obsidian, ui.podcastCard(FEED.title));
		await waitUntilShown(obsidian, ui.episode("Cached Episode"));
		await obsidian.waitFor(() => feedCacheHolds(obsidian, "Cached Episode"), {
			timeoutMs: 10_000,
			intervalMs: 200,
			message: "the feed in the cache",
		});

		await openPodNotesSettings(obsidian);
		onTestFinished(() => closeSettings(obsidian));
		await typeInto(obsidian, ui.settingControl("Skip back (s)", "input"), "20", {
			replace: true,
		});
		await pressKey(obsidian, "Tab");
		const saved = await plugin.waitForData<PodNotesData & { feedCache?: unknown }>(
			(data) => data.skipBackwardLength === 20,
			{ timeoutMs: 5_000, intervalMs: 100 },
		);
		expect(saved).not.toHaveProperty("feedCache");
	});
});
