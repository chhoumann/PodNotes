import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, onTestFinished, test } from "vitest";
import { SUPERCAST_FIXTURE_HOST } from "../../scripts/e2e-instance.mjs";
import released2211 from "../fixtures/persistence/released-2.21.1.json";
import { createPodNotesE2EHarness } from "./harness";
import { showLibrary, showPodNotes } from "./journey/actions";
import { recordWrites } from "./journey/library";
import { type FixtureFeed, startFixtureServer } from "./journey/fixtures";
import { holdsFor, shownPodcasts } from "./journey/wait";
import { jsLiteral, RELOAD_OPTIONS, WAIT_OPTS } from "./runtime";

const getContext = createPodNotesE2EHarness("sync-private-address");

const feedUrlSecretIds = (obsidian: ReturnType<typeof getContext>["obsidian"]) =>
	obsidian.dev.evalJson<string[]>(
		`app.secretStorage.listSecrets().filter((id) => id.startsWith("podnotes-feed-url-"))`,
	);

test.each(["raw event", "external settings handler"])(
	"protects a synced 2.21.1 private address on disk once per incoming change, under one reference, through %s",
	async (trigger) => {
		const { obsidian, plugin } = getContext();
		await plugin.updateDataAndReload<Record<string, unknown>>((data) => {
			data.savedFeeds = {};
			delete data.currentEpisode;
		}, RELOAD_OPTIONS);
		await showPodNotes(obsidian);
		const path = await plugin.dataPath();
		const sentinel = "FIX488_ADOPTED_SENTINEL";
		const feed: FixtureFeed = {
			title: "Private",
			slug: "adopted-private",
			host: SUPERCAST_FIXTURE_HOST,
			path: `/feeds/${sentinel}`,
			artwork: true,
			episodes: [],
		};
		const server = await startFixtureServer([feed]);
		onTestFinished(() => server.stop());
		const address = server.feedUrl(feed);
		const data: Record<string, unknown> = {
			...structuredClone(released2211),
			savedFeeds: {
				Private: {
					title: "Private",
					url: address,
					artworkUrl: server.artworkUrl(feed),
				},
			},
			copiedNote: `from ${address}`,
		};
		delete data.currentEpisode;
		const before = await feedUrlSecretIds(obsidian);
		const evidence = [];
		for (let incoming = 1; incoming <= 3; incoming++) {
			const recorder = await recordWrites(obsidian);
			await writeFile(path, JSON.stringify({ ...data, incoming }), "utf8");
			if (trigger === "external settings handler") {
				await obsidian.dev.evalJsonAsync(
					"(async () => { await app.plugins.plugins.podnotes.onExternalSettingsChange(); return true; })()",
				);
			}
			await obsidian.waitFor(
				() =>
					obsidian.dev.evalJson<boolean>(
						`app.plugins.plugins.podnotes.settings.savedFeeds.Private?.url === ${jsLiteral("podnotes-private-feed:Private")}`,
					),
				{ ...WAIT_OPTS, message: "the synced private feed was adopted" },
			);
			await expect
				.poll(() => readFile(path, "utf8"), { timeout: 5_000, interval: 100 })
				.not.toContain(sentinel);
			const disk = await plugin.data<Record<string, unknown>>().read();
			expect(disk).toMatchObject({
				incoming,
				savedFeeds: { Private: { url: "podnotes-private-feed:Private" } },
				copiedNote: "from podnotes-private-feed:Private",
			});
			const text = await readFile(path, "utf8");
			expect(await holdsFor(obsidian, () => readFile(path, "utf8"), text, 1_000)).toBe(text);
			const writes = await recorder.stop();
			expect(writes).toMatchObject({ attempted: 1, completed: 1, failed: 0, intact: true });
			evidence.push({ incoming, writes, sentinelOnDisk: text.includes(sentinel) });
		}
		const disk = await plugin
			.data<{ savedFeeds: { Private: { urlSecretId: string } } }>()
			.read();
		const listed = await feedUrlSecretIds(obsidian);
		expect(listed.filter((id) => !before.includes(id))).toEqual([
			disk.savedFeeds.Private.urlSecretId,
		]);
		await plugin.reload(RELOAD_OPTIONS);
		expect(await feedUrlSecretIds(obsidian)).toEqual(listed);
		expect(
			await obsidian.dev.evalJson<string | null>(
				"(() => { const p = app.plugins.plugins.podnotes; return p.feedUrls.resolve(p.settings.savedFeeds.Private.urlSecretId); })()",
			),
		).toBe(address);
		await showLibrary(obsidian);
		expect(await shownPodcasts(obsidian)).toContain("Private");
		const directory = resolve(".obsidian-e2e-artifacts/fix488");
		await mkdir(directory, { recursive: true });
		await obsidian.dev.screenshot(resolve(directory, `${trigger.replaceAll(" ", "-")}.png`));
		console.info(
			JSON.stringify({
				trigger,
				evidence,
				feedUrlSecretIds: { before: before.length, after: listed.length },
				version: await obsidian.exec("version"),
			}),
		);
	},
);

test("adopts public and protected feeds without writing them back", async () => {
	const { obsidian, plugin } = getContext();
	await plugin.updateDataAndReload<Record<string, unknown>>((data) => {
		data.savedFeeds = {};
		delete data.currentEpisode;
	}, RELOAD_OPTIONS);
	const path = await plugin.dataPath();
	for (const url of ["https://example.com/feed.xml", "podnotes-private-feed:Private"]) {
		const incoming = await plugin.data<Record<string, unknown>>().read();
		incoming.savedFeeds = { Private: { title: "Private", url, artworkUrl: "" } };
		const text = JSON.stringify(incoming);
		const recorder = await recordWrites(obsidian);
		await writeFile(path, text, "utf8");
		await obsidian.waitFor(
			() =>
				obsidian.dev.evalJson<boolean>(
					`app.plugins.plugins.podnotes.settings.savedFeeds.Private?.url === ${jsLiteral(url)}`,
				),
			WAIT_OPTS,
		);
		expect(await holdsFor(obsidian, () => readFile(path, "utf8"), text, 1_000)).toBe(text);
		expect(await recorder.stop()).toMatchObject({
			attempted: 0,
			completed: 0,
			failed: 0,
			intact: true,
		});
	}
});
