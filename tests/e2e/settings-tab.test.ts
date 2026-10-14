import type { ObsidianClient } from "obsidian-e2e";
import { describe, expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness, type PodNotesData } from "./harness";
import {
	closeSettings,
	openPodNotesSettings,
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
	test("names each field after its row", async () => {
		const { obsidian } = getContext();
		await openPodNotesSettings(obsidian);
		onTestFinished(() => closeSettings(obsidian));
		const fields = await obsidian.dev.evalJson<Array<{ row: string; name: string }>>(`(() =>
			[...document.querySelectorAll(".modal.mod-settings .setting-item-control :is(input, select, textarea):not([aria-hidden])")].map((field) => ({
				row: field.closest(".setting-item").querySelector(".setting-item-name").textContent,
				name: field.getAttribute("aria-label") ?? document.getElementById(field.getAttribute("aria-labelledby"))?.textContent ?? "",
			})))()`);

		expect(fields.map(({ row }) => row)).toEqual([
			"Skip back (s)",
			"Skip forward (s)",
			"Default speed",
			"Queue episodes I switch away from",
			"Previous track",
			"Next track",
			"Timestamp template",
			"Timestamp offset (s)",
			"Episode note path",
			"Episode note template",
			"Podcast note path",
			"Podcast note template",
			"Transcript path",
			"Transcript template",
			"Speaker diarization",
			"Diarization provider",
			"Speaker label format",
			"Download path",
			"Export OPML",
			"Latest episodes per podcast",
			"Include API keys",
			"Export settings",
		]);
		expect(fields.filter(({ row, name }) => name !== row)).toEqual([]);
	});

	test("search finds a row of each section by name, and none of the removed rows", async () => {
		const { obsidian } = getContext();
		await openPodNotesSettings(obsidian);
		onTestFinished(() => closeSettings(obsidian));
		expect(
			await obsidian.dev.evalJson<string[]>(
				`[...document.querySelectorAll(".modal.mod-settings .setting-item-heading .setting-item-name")].map(element => element.textContent.trim())`,
			),
		).toEqual([
			"Playback",
			"Headset and lock screen",
			"Notes",
			"Transcripts",
			"Downloads",
			"Library",
			"Import and export",
		]);

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

	test("a typing burst writes data.json once after it pauses, and completing it writes nothing more", async () => {
		const { obsidian, plugin } = getContext();
		const typed = "UI3/Typed note path.md";
		await openPodNotesSettings(obsidian);
		onTestFinished(() => closeSettings(obsidian));
		const path = ui.settingControl("Episode note path", "input");

		const typing = await recordWrites(obsidian);
		await typeInto(obsidian, path, "", { replace: true });
		for (const character of typed) await typeText(obsidian, character);
		await plugin.waitForData<PodNotesData>((data) => data.note?.path === typed, {
			timeoutMs: 5_000,
			intervalMs: 100,
		});
		await obsidian.sleep(1_000);
		expect(await typing.stop(), "writes for the burst").toMatchObject({
			attempted: 1,
			completed: 1,
			failed: 0,
		});

		const completing = await recordWrites(obsidian);
		await pressKey(obsidian, "Tab");
		await obsidian.sleep(1_000);
		expect(await completing.stop(), "writes for completing a saved edit").toMatchObject({
			attempted: 0,
		});
	});

	test("Enter completes an edit while its field keeps focus", async () => {
		const { obsidian } = getContext();
		await openPodNotesSettings(obsidian);
		onTestFinished(() => closeSettings(obsidian));
		const saved = await settingValue(obsidian, "Skip back (s)");

		await typeInto(obsidian, ui.settingControl("Skip back (s)", "input"), "-", {
			replace: true,
		});
		await pressKey(obsidian, "Enter");

		expect(
			await obsidian.dev.evalJson(`(() => {
				const field = document.activeElement;
				return [field?.closest(".setting-item")?.querySelector(".setting-item-name")?.textContent, field?.value];
			})()`),
			"the focused field shows the saved value for an entry it cannot use",
		).toEqual(["Skip back (s)", saved]);
	});

	test("blur keeps an external setting received after the focused edit was saved", async () => {
		const { obsidian, plugin } = getContext();
		const local = "Local/{{title}}.md";
		const remote = "Remote/{{title}}.md";
		await openPodNotesSettings(obsidian);
		onTestFinished(() => closeSettings(obsidian));
		const path = ui.settingControl("Episode note path", "input");
		await typeInto(obsidian, path, local, { replace: true });
		await plugin.waitForData<PodNotesData>((data) => data.note?.path === local, {
			timeoutMs: 5_000,
			intervalMs: 100,
		});
		const synced = await plugin.data<PodNotesData>().read();
		if (!synced.note) throw new Error("The saved episode note settings are missing");
		synced.note.path = remote;
		await plugin.data<PodNotesData>().write(synced);
		await obsidian.dev.evalJsonAsync(
			"app.plugins.plugins.podnotes.onExternalSettingsChange().then(() => true)",
		);
		expect(
			await obsidian.dev.evalJson(`({
			memory: app.plugins.plugins.podnotes.settings.note.path,
			field: document.activeElement.value,
			focused: (${path.elements}).includes(document.activeElement)
		})`),
		).toEqual({ memory: remote, field: local, focused: true });

		await pressKey(obsidian, "Tab");
		await obsidian.dev.evalJsonAsync(
			"app.plugins.plugins.podnotes.flushSaves().then(() => true)",
		);

		expect(await settingValue(obsidian, "Episode note path")).toBe(remote);
		expect((await plugin.data<PodNotesData>().read()).note?.path).toBe(remote);
	});

	test("leaving a field saves a return to its original text before the debounce", async () => {
		const { obsidian, plugin } = getContext();
		const initial = "Initial/{{title}}.md";
		const edited = "Paused/{{title}}.md";
		await plugin.updateDataAndReload<PodNotesData>((data) => {
			data.note = { path: initial, template: "# {{title}}" };
		}, RELOAD_OPTIONS);
		await openPodNotesSettings(obsidian);
		onTestFinished(() => closeSettings(obsidian));
		const path = ui.settingControl("Episode note path", "input");
		await typeInto(obsidian, path, edited, { replace: true });
		await plugin.waitForData<PodNotesData>((data) => data.note?.path === edited, {
			timeoutMs: 5_000,
			intervalMs: 100,
		});

		await typeInto(obsidian, path, initial, { replace: true });
		await pressKey(obsidian, "Tab");
		await obsidian.sleep(100);

		expect((await plugin.data<PodNotesData>().read()).note?.path).toBe(initial);
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
