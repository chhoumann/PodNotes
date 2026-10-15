import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { ObsidianClient } from "obsidian-e2e";
import { expect, onTestFinished, test } from "vitest";
import { SUPERCAST_FIXTURE_HOST } from "../../scripts/e2e-instance.mjs";
import { createPodNotesE2EHarness } from "./harness";
import {
	closePodNotes,
	runCommand,
	setOffline,
	showAddPodcast,
	showLibrary,
	showPodNotes,
} from "./journey/actions";
import { click, typeInto } from "./journey/input";
import { ui } from "./journey/targets";
import {
	eventually,
	holdsFor,
	isDisabled,
	isShown,
	notices,
	shownText,
	waitUntilShown,
} from "./journey/wait";
import { type FixtureFeed, pubDate, startFixtureServer } from "./journey/fixtures";
import {
	ageFeedCache,
	feedCacheHolds,
	feedCacheText,
	readLibrary,
	readVaultText,
	seedLibrary,
	waitForLibrary,
	waitForPlayback,
} from "./journey/library";
import { jsLiteral, PLUGIN_ID, RELOAD_OPTIONS } from "./runtime";

const getContext = createPodNotesE2EHarness("private-feeds");

const closeFeedAddressDialog = (obsidian: ObsidianClient) =>
	obsidian.dev.evalJson(
		'document.querySelectorAll(".modal-container:not(:has(.mod-settings)) .modal-close-button").forEach(el => el.click()), true',
	);

test("a private feed first opened offline explains that its address is not on this device", async () => {
	const context = getContext();
	const { obsidian, plugin } = context;
	await seedLibrary(context, null);
	const id = "podnotes-feed-url-47600000-0000-4000-8000-000000000000";
	await obsidian.dev.evalJson(`app.secretStorage.setSecret(${jsLiteral(id)}, ""), true`);
	onTestFinished(async () => {
		await closePodNotes(obsidian);
		await setOffline(obsidian, false);
	});
	await setOffline(obsidian, true);
	await plugin.updateDataAndReload<Record<string, unknown>>((data) => {
		data.savedFeeds = {
			Private: {
				title: "Private",
				artworkUrl: "",
				url: "podnotes-private-feed:Private",
				urlSecretId: id,
			},
		};
	}, RELOAD_OPTIONS);
	await showPodNotes(obsidian);
	await showLibrary(obsidian);
	await click(obsidian, ui.podcastCard("Private"));
	await waitUntilShown(obsidian, ui.offlineStrip);
	const actionShown = await eventually(
		obsidian,
		() => isShown(obsidian, ui.feedErrorAction("Set feed address")),
		true,
	);
	const text = await shownText(obsidian);
	console.log("FIX476 offline", JSON.stringify({ text, actionShown }));
	const evidence = resolve(".obsidian-e2e-artifacts/fix476");
	await mkdir(evidence, { recursive: true });
	await obsidian.dev.screenshot(resolve(evidence, "missing-address-offline.png"));
	expect.soft(text).toContain("Address not on this device");
	expect.soft(actionShown).toBe(true);
	expect.soft(await isDisabled(obsidian, ui.feedErrorAction("Set feed address"))).toBe(true);
	expect
		.soft(
			await obsidian.dev.evalJson<boolean>(`(() => {
		const description = document.querySelector(".podcast-view .pn-banner .d");
		return !!description && description.scrollWidth <= description.clientWidth;
	})()`),
		)
		.toBe(true);

	await setOffline(obsidian, false);
	await waitUntilShown(obsidian, ui.feedErrorAction("Set feed address"));
	expect(await isDisabled(obsidian, ui.feedErrorAction("Set feed address"))).toBe(false);
	expect(await shownText(obsidian)).toContain("Address not on this device");
	expect((await readLibrary(plugin)).subscriptions).toEqual([
		{ title: "Private", url: "podnotes-private-feed:Private" },
	]);
	expect(
		await obsidian.dev.evalJson<string | null>(`app.secretStorage.getSecret(${jsLiteral(id)})`),
	).toBeFalsy();
});

test("a private feed whose address is on this device, opened offline hours later, lists the episodes it cached and no missing address or earlier failure", async () => {
	const context = getContext();
	const { obsidian, plugin } = context;
	const show: FixtureFeed = {
		title: "Private Kept",
		slug: "private-kept",
		query: "?auth=KEPT_SENTINEL",
		artwork: false,
		episodes: [{ title: "Kept episode", seconds: 6, pubDate: pubDate(0) }],
	};
	const server = await startFixtureServer([show]);
	onTestFinished(() => server.stop());
	await seedLibrary(context, server);
	const id = "podnotes-feed-url-48200000-0000-4000-8000-000000000001";
	await obsidian.dev.evalJson(
		`app.secretStorage.setSecret(${jsLiteral(id)}, ${jsLiteral(server.feedUrl(show))}), true`,
	);
	onTestFinished(async () => {
		await obsidian.dev.evalJson(`app.secretStorage.setSecret(${jsLiteral(id)}, ""), true`);
		await setOffline(obsidian, false);
	});
	await plugin.updateDataAndReload<Record<string, unknown>>((data) => {
		data.savedFeeds = {
			[show.title]: {
				title: show.title,
				artworkUrl: "",
				url: `podnotes-private-feed:${encodeURIComponent(show.title)}`,
				urlSecretId: id,
			},
		};
	}, RELOAD_OPTIONS);
	await showPodNotes(obsidian);
	await showLibrary(obsidian);
	await click(obsidian, ui.podcastCard(show.title));
	await waitUntilShown(obsidian, ui.episode("Kept episode"));
	await obsidian.waitFor(() => feedCacheHolds(obsidian, "Kept episode"), {
		timeoutMs: 10_000,
		message: "the feed cached",
	});
	server.disconnect();
	await click(obsidian, ui.refreshEpisodes);
	await waitUntilShown(obsidian, ui.feedError);
	await setOffline(obsidian, true);
	await waitUntilShown(obsidian, ui.offlineStrip);
	expect(
		await holdsFor(obsidian, () => isShown(obsidian, ui.feedError), false),
		"offline, the Offline strip says why the last load failed",
	).toBe(false);
	await closePodNotes(obsidian);
	await ageFeedCache(obsidian, 7 * 60 * 60 * 1000);
	await plugin.reload(RELOAD_OPTIONS);
	await showPodNotes(obsidian);
	await showLibrary(obsidian);
	await click(obsidian, ui.podcastCard(show.title));
	await waitUntilShown(obsidian, ui.offlineStrip);

	expect(await isShown(obsidian, ui.episode("Kept episode"))).toBe(true);
	expect(await holdsFor(obsidian, () => isShown(obsidian, ui.feedError), false)).toBe(false);
	expect(await shownText(obsidian)).not.toContain("Address not on this device");
});

test("protects a Supercast subscription's address in data, cache keys and note links, then accepts it under the same reference", async () => {
	const context = getContext();
	const { obsidian, plugin, sandbox } = context;
	const sentinel = "PRIV3_E2E_SENTINEL";
	const feedPath = `/feeds/${sentinel}/feed.xml`;
	const episode = {
		title: "Path Episode",
		seconds: 60,
		pubDate: pubDate(0),
		description: "Path Episode show notes.",
	};
	const show: FixtureFeed = {
		title: "PRIV3 Supercast",
		slug: "priv3-supercast",
		host: SUPERCAST_FIXTURE_HOST,
		path: feedPath,
		artwork: false,
		episodes: [episode],
	};
	const server = await startFixtureServer([show]);
	onTestFinished(() => server.stop());
	await seedLibrary(context, server);
	const address = server.feedUrl(show);
	const placeholder = "podnotes-private-feed:PRIV3%20Supercast";
	onTestFinished(async () => {
		await closeFeedAddressDialog(obsidian);
	});

	await showPodNotes(obsidian);
	await showAddPodcast(obsidian);
	await typeInto(obsidian, ui.podcastSearch, address);
	await click(obsidian, ui.addPodcast(show.title));
	await waitForLibrary(
		plugin,
		(library) => library.subscriptions.length === 1,
		"the private feed saved",
	);
	const saved = await obsidian.dev.evalJson<{ url: string; urlSecretId: string }>(
		`app.plugins.plugins.${PLUGIN_ID}.settings.savedFeeds[${jsLiteral(show.title)}]`,
	);
	const secret = (id: string) =>
		obsidian.dev.evalJson<string | null>(`app.secretStorage.getSecret(${jsLiteral(id)})`);
	onTestFinished(() =>
		obsidian.dev.evalJson(
			`app.secretStorage.setSecret(${jsLiteral(saved.urlSecretId)}, ""), true`,
		),
	);
	expect(saved.url).toBe(placeholder);
	expect(await secret(saved.urlSecretId)).toBe(address);

	await click(obsidian, ui.episode(episode.title));
	await waitForPlayback(
		obsidian,
		(playback) => playback.playing && (playback.media?.seconds ?? 0) > 0,
		"Path Episode playing",
	);
	await click(obsidian, ui.playbackToggle);
	await waitForPlayback(obsidian, (playback) => !playback.playing, "paused");
	await obsidian.waitFor(() => feedCacheHolds(obsidian, episode.title), {
		timeoutMs: 10_000,
		message: "the feed cached",
	});
	await runCommand(obsidian, `${PLUGIN_ID}:create-podcast-note`);
	const notePath = "PodNotes/PRIV3 Supercast/Path Episode.md";
	await sandbox.waitForExists(notePath, { timeoutMs: 10_000 });
	const note = await readVaultText(obsidian, sandbox.path(notePath));

	expect(note).toContain(
		`[Resume in PodNotes](obsidian://podnotes?episodeName=Path%20Episode&url=${encodeURIComponent(placeholder)})`,
	);
	expect(note).toContain("Path Episode show notes.");
	expect(note).not.toContain(sentinel);
	expect(await feedCacheText(obsidian)).not.toContain(sentinel);
	expect(JSON.stringify(await plugin.data().read())).not.toContain(sentinel);

	await obsidian.dev.evalJson(
		`app.secretStorage.setSecret(${jsLiteral(saved.urlSecretId)}, ""), true`,
	);
	await plugin.reload(RELOAD_OPTIONS);
	const fetches = server.requests().filter((path) => path === feedPath).length;
	await showPodNotes(obsidian);
	await showLibrary(obsidian);
	await click(obsidian, ui.podcastCard(show.title));
	await waitUntilShown(obsidian, ui.episode(episode.title));
	// The cached copy shows until a load needs the address this device no longer has.
	await click(obsidian, ui.refreshEpisodes);
	await waitUntilShown(obsidian, ui.feedError);
	expect(await isShown(obsidian, ui.feedErrorAction("Retry"))).toBe(false);
	await click(obsidian, ui.feedErrorAction("Set feed address"));
	const dialog = ".modal-container:not(:has(.mod-settings))";
	await typeInto(
		obsidian,
		{
			name: "Feed address",
			elements: `[...document.querySelectorAll(${jsLiteral(`${dialog} input`)})]`,
		},
		address,
	);
	await click(obsidian, {
		name: "Save",
		elements: `[...document.querySelectorAll(${jsLiteral(`${dialog} button`)})].filter((button) => button.textContent.trim() === "Save")`,
	});
	await obsidian.waitFor(async () => (await secret(saved.urlSecretId)) === address, {
		timeoutMs: 10_000,
		message: "the address set under the saved reference",
	});
	await obsidian.waitFor(
		() => server.requests().filter((path) => path === feedPath).length > fetches,
		{ timeoutMs: 10_000, message: "the feed fetched again" },
	);
	await obsidian.waitFor(async () => !(await isShown(obsidian, ui.feedError)), {
		timeoutMs: 10_000,
		message: "the banner gone once the feed loads",
	});
	expect((await readLibrary(plugin)).subscriptions).toEqual([
		{ title: show.title, url: placeholder },
	]);
	expect(
		await obsidian.dev.evalJson<string>(
			`app.plugins.plugins.${PLUGIN_ID}.settings.savedFeeds[${jsLiteral(show.title)}].urlSecretId`,
		),
	).toBe(saved.urlSecretId);
	expect(JSON.stringify(await plugin.data().read())).not.toContain(sentinel);
});

test.each(["invalid", "public", "private"])(
	"Enter in Set feed address closes without reopening after a %s address",
	async (kind) => {
		const context = getContext();
		const { obsidian, plugin } = context;
		const show = {
			title: "Private",
			slug: "enter-private",
			query: "?auth=ENTER_SENTINEL",
			artwork: false,
			episodes: [{ title: "Private episode", seconds: 6 }],
		};
		const publicShow = { ...show, slug: "enter-public", query: "" };
		const server = await startFixtureServer([show, publicShow]);
		onTestFinished(() => server.stop());
		await seedLibrary(context, server);
		const id = "podnotes-feed-url-12345678-9abc-4def-8123-456789abcdef";
		await obsidian.dev.evalJson(`app.secretStorage.setSecret(${jsLiteral(id)}, ""), true`);
		onTestFinished(() =>
			obsidian.dev.evalJson(`app.secretStorage.setSecret(${jsLiteral(id)}, ""), true`),
		);
		await plugin.updateDataAndReload<Record<string, unknown>>((data) => {
			data.savedFeeds = {
				Private: {
					title: "Private",
					artworkUrl: "",
					url: "podnotes-private-feed:Private",
					urlSecretId: "podnotes-feed-url-12345678-9abc-4def-8123-456789abcdef",
				},
			};
		}, RELOAD_OPTIONS);
		onTestFinished(async () => {
			await closeFeedAddressDialog(obsidian);
		});
		await showPodNotes(obsidian);
		await showLibrary(obsidian);
		await click(obsidian, ui.failedPodcastCard("Private"), { button: "right" });
		await click(obsidian, ui.menuItem("Set feed address"));
		await typeInto(
			obsidian,
			{
				name: "Feed address",
				elements:
					'[...document.querySelectorAll(".modal-container:not(:has(.mod-settings)) input")]',
			},
			kind === "invalid"
				? "not an address"
				: server.feedUrl(kind === "private" ? show : publicShow),
		);
		for (const type of ["keyDown", "keyUp"]) {
			await obsidian.exec("dev:cdp", {
				method: "Input.dispatchKeyEvent",
				params: JSON.stringify({
					type,
					key: "Enter",
					code: "Enter",
					windowsVirtualKeyCode: 13,
					text: "\r",
				}),
			});
		}
		if (kind === "private") {
			await obsidian.waitFor(
				() =>
					obsidian.dev.evalJson<boolean>(
						`app.secretStorage.getSecret(${jsLiteral(id)}) === ${jsLiteral(server.feedUrl(show))}`,
					),
				{ timeoutMs: 10_000 },
			);
			expect(
				await obsidian.dev.evalJson<string>(
					"app.plugins.plugins.podnotes.settings.savedFeeds.Private.urlSecretId",
				),
			).toBe(id);
		} else {
			expect(await notices(obsidian)).toContain(
				kind === "invalid"
					? "Enter the feed's http or https address."
					: "Enter a private feed address.",
			);
			expect(server.requests()).not.toContain(new URL(server.feedUrl(publicShow)).pathname);
		}
		expect(
			await obsidian.dev.evalJson<number>(
				'document.querySelectorAll(".modal-container:not(:has(.mod-settings))").length',
			),
		).toBe(0);
	},
);
