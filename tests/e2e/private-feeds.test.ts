import type { ObsidianClient } from "obsidian-e2e";
import { expect, onTestFinished, test } from "vitest";
import { SUPERCAST_FIXTURE_HOST } from "../../scripts/e2e-instance.mjs";
import { createPodNotesE2EHarness } from "./harness";
import {
	click,
	closeSettings,
	notices,
	openPodNotesSettings,
	runCommand,
	showPodNotes,
	typeInto,
	ui,
} from "./journey/actions";
import { type FixtureFeed, pubDate, startFixtureServer } from "./journey/fixtures";
import {
	feedCacheHolds,
	feedCacheText,
	readLibrary,
	readVaultText,
	seedLibrary,
	waitForLibrary,
	waitForPlayback,
} from "./journey/library";
import { PLUGIN_ID, RELOAD_OPTIONS } from "./runtime";

const getContext = createPodNotesE2EHarness("private-feeds");

const closeFeedAddressDialog = (obsidian: ObsidianClient) =>
	obsidian.dev.evalJson(
		'document.querySelectorAll(".modal-container:not(:has(.mod-settings)) .modal-close-button").forEach(el => el.click()), true',
	);

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
		await closeSettings(obsidian);
	});

	await openPodNotesSettings(obsidian);
	await typeInto(obsidian, ui.podcastSearch, address);
	await click(obsidian, ui.addPodcast(show.title));
	await waitForLibrary(
		plugin,
		(library) => library.subscriptions.length === 1,
		"the private feed saved",
	);
	const saved = await obsidian.dev.evalJson<{ url: string; urlSecretId: string }>(
		`app.plugins.plugins.${PLUGIN_ID}.settings.savedFeeds[${JSON.stringify(show.title)}]`,
	);
	const secret = (id: string) =>
		obsidian.dev.evalJson<string | null>(`app.secretStorage.getSecret(${JSON.stringify(id)})`);
	onTestFinished(() =>
		obsidian.dev.evalJson(
			`app.secretStorage.setSecret(${JSON.stringify(saved.urlSecretId)}, ""), true`,
		),
	);
	expect(saved.url).toBe(placeholder);
	expect(await secret(saved.urlSecretId)).toBe(address);
	await closeSettings(obsidian);

	await showPodNotes(obsidian);
	await click(obsidian, ui.podcastCard(show.title));
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
		`app.secretStorage.setSecret(${JSON.stringify(saved.urlSecretId)}, ""), true`,
	);
	await plugin.reload(RELOAD_OPTIONS);
	const fetches = server.requests().filter((path) => path === feedPath).length;
	await openPodNotesSettings(obsidian);
	await click(obsidian, {
		name: "Set feed address",
		elements: `[...document.querySelectorAll(${JSON.stringify(`button[aria-label="Set feed address for ${show.title}"]`)})]`,
	});
	const dialog = ".modal-container:not(:has(.mod-settings))";
	await typeInto(
		obsidian,
		{ name: "Feed address", elements: `[...document.querySelectorAll("${dialog} input")]` },
		address,
	);
	await click(obsidian, {
		name: "Save",
		elements: `[...document.querySelectorAll("${dialog} button")].filter((button) => button.textContent.trim() === "Save")`,
	});
	await obsidian.waitFor(async () => (await secret(saved.urlSecretId)) === address, {
		timeoutMs: 10_000,
		message: "the address set under the saved reference",
	});
	await obsidian.waitFor(
		() => server.requests().filter((path) => path === feedPath).length > fetches,
		{ timeoutMs: 10_000, message: "the feed fetched again" },
	);
	expect((await readLibrary(plugin)).subscriptions).toEqual([
		{ title: show.title, url: placeholder },
	]);
	expect(
		await obsidian.dev.evalJson<string>(
			`app.plugins.plugins.${PLUGIN_ID}.settings.savedFeeds[${JSON.stringify(show.title)}].urlSecretId`,
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
		await obsidian.dev.evalJson(`app.secretStorage.setSecret(${JSON.stringify(id)}, ""), true`);
		onTestFinished(() =>
			obsidian.dev.evalJson(`app.secretStorage.setSecret(${JSON.stringify(id)}, ""), true`),
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
			await closeSettings(obsidian);
		});
		await openPodNotesSettings(obsidian);
		await click(obsidian, {
			name: "Set feed address",
			elements: `[...document.querySelectorAll(${JSON.stringify('button[aria-label="Set feed address for Private"]')})]`,
		});
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
						`app.secretStorage.getSecret(${JSON.stringify(id)}) === ${JSON.stringify(server.feedUrl(show))}`,
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
