import { describe, expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness } from "./harness";
import {
	chooseFile,
	click,
	closePodNotes,
	closeSettings,
	feedsLoading,
	isShown,
	listedEpisodes,
	notices,
	openPodNotesSettings,
	removePodcast,
	showAddPodcast,
	showLibrary,
	showList,
	shownResults,
	shownText,
	showPodNotes,
	typeInto,
	ui,
	waitUntilShown,
} from "./journey/actions";
import {
	type FixtureFeed,
	type FixtureServer,
	installItunesStub,
	itunesLookupIds,
	itunesSearchTerms,
	opmlDocument,
	pubDate,
	removeItunesStub,
	startFixtureServer,
} from "./journey/fixtures";
import {
	ageFeedCache,
	feedCachedAt,
	feedCacheHolds,
	observePlayback,
	readLibrary,
	seedLibrary,
	waitForLibrary,
	waitForPlayback,
	writeVaultFile,
} from "./journey/library";
import { RELOAD_OPTIONS } from "./runtime";

const getContext = createPodNotesE2EHarness("journey-feeds");

async function serve(...feeds: FixtureFeed[]): Promise<FixtureServer> {
	const server = await startFixtureServer(feeds);
	onTestFinished(() => server.stop());
	return server;
}

function feed(title: string, slug: string, episodeTitles: string[], artwork = true): FixtureFeed {
	return {
		title,
		slug,
		artwork,
		episodes: episodeTitles.map((episodeTitle, index) => ({
			title: episodeTitle,
			seconds: 6,
			pubDate: pubDate(index),
			guid: `${slug}-${index}`,
			description: `${episodeTitle} show notes.`,
		})),
	};
}

const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title);

async function resultsBecome(
	obsidian: Parameters<typeof shownResults>[0],
	expected: Awaited<ReturnType<typeof shownResults>>,
) {
	let last: unknown;
	await obsidian
		.waitFor(
			async () => {
				last = await shownResults(obsidian);
				return JSON.stringify(last) === JSON.stringify(expected);
			},
			{ timeoutMs: 15_000, intervalMs: 100 },
		)
		.catch(() => {
			throw new Error(`Add podcast showed ${JSON.stringify(last)}`);
		});
	return expected;
}

describe("feed journeys", () => {
	test("J-FEED-01 searching Add podcast and tapping a result subscribes to the podcast for good", async () => {
		const context = getContext();
		const { obsidian, plugin } = context;
		const existing = feed("Journey Followed", "followed", ["Followed Episode"]);
		const show = feed("Journey Search Show", "search", ["Search Show Pilot"]);
		const server = await serve(existing, show);
		await seedLibrary(context, server, { subscriptions: [existing] });
		await installItunesStub(obsidian, [
			{
				collectionName: "Journey Search Show",
				feedUrl: server.feedUrl(show),
				artworkUrl100: server.artworkUrl(show),
				collectionId: "4242",
			},
		]);
		onTestFinished(() => removeItunesStub(obsidian));

		await showPodNotes(obsidian);
		await showAddPodcast(obsidian);
		await typeInto(obsidian, ui.podcastSearch, "Journey Search");
		await click(obsidian, ui.addPodcast("Journey Search Show"));

		await waitUntilShown(obsidian, ui.episode("Search Show Pilot"));
		expect(await shownText(obsidian)).toContain("Journey Search Show");
		const expected = [
			{ title: "Journey Followed", url: server.feedUrl(existing) },
			{ title: "Journey Search Show", url: server.feedUrl(show) },
		];
		const saved = await waitForLibrary(
			plugin,
			(library) => library.subscriptions.length === 2,
			"the added podcast saved",
		);
		expect([...saved.subscriptions].sort(byTitle)).toEqual(expected);
		expect(await itunesSearchTerms(obsidian)).toEqual(["Journey Search"]);

		await plugin.reload(RELOAD_OPTIONS);
		expect([...(await readLibrary(plugin)).subscriptions].sort(byTitle)).toEqual(expected);
		await showPodNotes(obsidian);
		await showLibrary(obsidian);
		await click(obsidian, ui.podcastCard("Journey Search Show"));
		await obsidian.waitFor(async () => (await listedEpisodes(obsidian)).length > 0, {
			timeoutMs: 15_000,
			message: "the subscribed podcast's episodes",
		});
		expect(await listedEpisodes(obsidian)).toEqual(["Search Show Pilot"]);
	});

	test("J-ONB-01 first run: a pasted feed address, one tap to add the podcast and one to play", async () => {
		const context = getContext();
		const { obsidian, plugin } = context;
		const show = feed("Journey First Run", "first-run", [
			"First Run Opening",
			"First Run Later",
		]);
		const server = await serve(show);
		await seedLibrary(context, server);

		await showPodNotes(obsidian);
		await waitUntilShown(obsidian, ui.firstRun);
		await typeInto(obsidian, ui.podcastSearch, server.feedUrl(show));
		await resultsBecome(obsidian, [
			{ label: `Add ${show.title}`, title: show.title, via: "RSS feed" },
		]);
		expect(await isShown(obsidian, ui.firstRun)).toBe(false);

		await click(obsidian, ui.addPodcast(show.title));
		await click(obsidian, ui.episode("First Run Opening"));

		await waitUntilShown(obsidian, ui.fullPlayer);
		const started = await waitForPlayback(
			obsidian,
			(playback) =>
				playback.episode?.title === "First Run Opening" &&
				playback.playing &&
				playback.seconds > 0,
			"the first episode playing",
		);
		const advanced = await waitForPlayback(
			obsidian,
			(playback) => playback.seconds > started.seconds + 1,
			"the first episode's media advancing",
		);
		expect(advanced.media?.src).toBe(server.mediaUrl(show, show.episodes[0]));
		const saved = await waitForLibrary(
			plugin,
			(library) => library.subscriptions.length === 1,
			"the podcast saved",
		);
		expect(saved.subscriptions).toEqual([{ title: show.title, url: server.feedUrl(show) }]);
	});

	test("J-FEED-02 a pasted RSS link and a pasted Apple Podcasts link each resolve to their one show", async () => {
		const context = getContext();
		const { obsidian, plugin } = context;
		const pasted = feed("Journey Pasted Feed", "pasted", ["Pasted Episode"]);
		const apple = feed("Journey Apple Show", "apple", ["Apple Episode"]);
		const server = await serve(pasted, apple);
		await seedLibrary(context, server);
		await installItunesStub(obsidian, [
			{
				collectionName: apple.title,
				feedUrl: server.feedUrl(apple),
				artworkUrl100: server.artworkUrl(apple),
				collectionId: "4243",
			},
		]);
		onTestFinished(() => removeItunesStub(obsidian));

		await showPodNotes(obsidian);
		await showAddPodcast(obsidian);
		await typeInto(obsidian, ui.podcastSearch, server.feedUrl(pasted));
		await resultsBecome(obsidian, [
			{ label: `Add ${pasted.title}`, title: pasted.title, via: "RSS feed" },
		]);
		expect(server.requests()).toContain(new URL(server.feedUrl(pasted)).pathname);

		await typeInto(
			obsidian,
			ui.podcastSearch,
			"https://podcasts.apple.com/us/podcast/journey-apple-show/id4243",
			{ replace: true },
		);
		await resultsBecome(obsidian, [
			{ label: `Add ${apple.title}`, title: apple.title, via: "podcasts.apple.com" },
		]);
		expect(await itunesLookupIds(obsidian)).toEqual(["4243"]);
		expect(await itunesSearchTerms(obsidian)).toEqual([]);

		await click(obsidian, ui.addPodcast(apple.title));
		await waitUntilShown(obsidian, ui.episode("Apple Episode"));
		const saved = await waitForLibrary(
			plugin,
			(library) => library.subscriptions.length === 1,
			"the Apple show saved",
		);
		expect(saved.subscriptions).toEqual([{ title: apple.title, url: server.feedUrl(apple) }]);
	});

	test("a podcast whose feed stops answering keeps its episodes under a banner, and Retry loads it again", async () => {
		const context = getContext();
		const { obsidian } = context;
		const show = feed("Journey Flaky", "flaky", ["Flaky Two", "Flaky One"]);
		const server = await serve(show);
		await seedLibrary(context, server, { subscriptions: [show] });
		const feedPath = new URL(server.feedUrl(show)).pathname;
		const fetched = () => server.requests().filter((path) => path === feedPath).length;
		const settled = async (message: string) =>
			await obsidian.waitFor(async () => !(await feedsLoading(obsidian)), {
				timeoutMs: 15_000,
				message,
			});

		await showPodNotes(obsidian);
		await click(obsidian, ui.podcastCard(show.title));
		await obsidian.waitFor(async () => (await listedEpisodes(obsidian)).length === 2, {
			timeoutMs: 15_000,
			message: "the podcast's episodes",
		});
		expect(await isShown(obsidian, ui.feedError)).toBe(false);
		const cachedAt = await feedCachedAt(obsidian, server.feedUrl(show));
		expect(cachedAt).toBeGreaterThan(0);

		const restore = server.failFeed(show);
		let before = fetched();
		await click(obsidian, ui.refreshEpisodes);
		await waitUntilShown(obsidian, ui.feedError);
		expect(fetched()).toBeGreaterThan(before);
		const banner = await shownText(obsidian);
		expect(banner).toContain("Feed didn't load");
		expect(banner).toContain(new URL(server.feedUrl(show)).host);
		expect(await listedEpisodes(obsidian)).toEqual(["Flaky Two", "Flaky One"]);
		await showLibrary(obsidian);
		await click(obsidian, ui.failedPodcastCard(show.title));
		await waitUntilShown(obsidian, ui.feedError);
		await settled("the reopened podcast's load to settle");

		before = fetched();
		await click(obsidian, ui.feedErrorAction("Retry"));
		await obsidian.waitFor(() => fetched() > before, {
			timeoutMs: 10_000,
			message: "Retry's request to reach the feed",
		});
		await settled("the failed Retry to settle");
		expect(await isShown(obsidian, ui.feedError)).toBe(true);
		expect(await listedEpisodes(obsidian)).toEqual(["Flaky Two", "Flaky One"]);

		restore();
		before = fetched();
		await click(obsidian, ui.feedErrorAction("Retry"));
		await obsidian.waitFor(async () => !(await isShown(obsidian, ui.feedError)), {
			timeoutMs: 15_000,
			message: "the banner gone once the feed answers",
		});
		expect(fetched()).toBeGreaterThan(before);
		expect(await listedEpisodes(obsidian)).toEqual(["Flaky Two", "Flaky One"]);
		expect(await feedCachedAt(obsidian, server.feedUrl(show))).toBeGreaterThan(cachedAt);
		await showLibrary(obsidian);
		expect(await isShown(obsidian, ui.failedPodcastCard(show.title))).toBe(false);
		expect(await isShown(obsidian, ui.podcastCard(show.title))).toBe(true);
	});

	test("J-FEED-06 opening a podcast lists every episode, beyond the Latest Episodes limit", async () => {
		const context = getContext();
		const { obsidian } = context;
		const titles = [
			"Archive Episode 12",
			"Archive Episode 11",
			"Archive Episode 10",
			"Archive Episode 09",
			"Archive Episode 08",
			"Archive Episode 07",
			"Archive Episode 06",
			"Archive Episode 05",
			"Archive Episode 04",
			"Archive Episode 03",
			"Archive Episode 02",
			"Archive Episode 01",
		];
		const archive = feed("Journey Archive", "archive", titles);
		await seedLibrary(context, await serve(archive), { subscriptions: [archive] });

		await showPodNotes(obsidian);
		await click(obsidian, ui.podcastCard("Journey Archive"));
		await obsidian.waitFor(async () => (await listedEpisodes(obsidian)).length >= 12, {
			timeoutMs: 15_000,
			message: "the podcast's episode list",
		});
		expect(await listedEpisodes(obsidian)).toEqual(titles);

		await showList(obsidian, "Latest episodes");
		await obsidian.waitFor(async () => (await listedEpisodes(obsidian)).length === 10, {
			timeoutMs: 15_000,
			message: "Latest Episodes capped at the default limit of 10",
		});
		expect(await listedEpisodes(obsidian)).toEqual(titles.slice(0, 10));
	});

	test("J-FEED-08 importing an OPML file through the file picker subscribes to its new podcasts", async () => {
		const context = getContext();
		const { obsidian, plugin, sandbox } = context;
		const existing = feed("Journey Existing", "existing", ["Existing Episode"]);
		const first = feed("Journey Import One", "import-one", ["Import One Episode"]);
		const second = feed("Journey Import Two", "import-two", ["Import Two Episode"]);
		const server = await serve(existing, first, second);
		await seedLibrary(context, server, { subscriptions: [existing] });
		const opmlPath = sandbox.path("subscriptions.opml");
		await writeVaultFile(
			obsidian,
			opmlPath,
			opmlDocument(
				[existing, first, second].map((entry) => ({
					title: entry.title,
					url: server.feedUrl(entry),
				})),
			),
		);
		onTestFinished(() => closeSettings(obsidian));

		await openPodNotesSettings(obsidian);
		await chooseFile(
			obsidian,
			ui.settingControl("Import OPML", "button"),
			`${await obsidian.vaultPath()}/${opmlPath}`,
		);

		const summary = await obsidian.waitFor(
			async () =>
				(await notices(obsidian)).find((text) => text.includes("OPML import complete.")),
			{ timeoutMs: 15_000, intervalMs: 100, message: "the OPML import summary" },
		);
		expect(summary).toContain("Saved 2 podcasts. Skipped 1 existing podcast.");
		const expected = [
			{ title: "Journey Existing", url: server.feedUrl(existing) },
			{ title: "Journey Import One", url: server.feedUrl(first) },
			{ title: "Journey Import Two", url: server.feedUrl(second) },
		];
		const saved = await waitForLibrary(
			plugin,
			(library) => library.subscriptions.length === 3,
			"imports saved",
		);
		expect([...saved.subscriptions].sort(byTitle)).toEqual(expected);

		await closeSettings(obsidian);
		await plugin.reload(RELOAD_OPTIONS);
		expect([...(await readLibrary(plugin)).subscriptions].sort(byTitle)).toEqual(expected);
	});

	test("J-EDGE-05 a feed missing optional fields still lists and plays its episodes, skipping one without audio", async () => {
		const context = getContext();
		const { obsidian } = context;
		const sparse: FixtureFeed = {
			title: "Journey Sparse",
			slug: "sparse",
			artwork: true,
			episodes: [
				{ title: "Bare Episode", seconds: 6, pubDate: pubDate(0) },
				{ title: "Announcement Without Audio", seconds: null, pubDate: pubDate(1) },
				{ title: "Untitled Audio", seconds: 6, pubDate: pubDate(1), omitTitle: true },
				{ title: "Second Bare Episode", seconds: 6, pubDate: pubDate(2) },
			],
		};
		const empty: FixtureFeed = {
			title: "Journey Empty",
			slug: "empty",
			artwork: true,
			episodes: [],
		};
		const server = await serve(sparse, empty);
		await seedLibrary(context, server, { subscriptions: [sparse, empty] });

		await showPodNotes(obsidian);
		await click(obsidian, ui.podcastCard("Journey Sparse"));
		await obsidian.waitFor(async () => (await listedEpisodes(obsidian)).length >= 2, {
			timeoutMs: 15_000,
			message: "the sparse feed's episodes",
		});
		expect(await listedEpisodes(obsidian)).toEqual(["Bare Episode", "Second Bare Episode"]);

		await click(obsidian, ui.episode("Bare Episode"));
		const first = await waitForPlayback(
			obsidian,
			(playback) =>
				playback.episode?.title === "Bare Episode" &&
				playback.playing &&
				playback.seconds > 0,
			"the bare episode playing",
		);
		await waitForPlayback(
			obsidian,
			(playback) => playback.seconds > first.seconds + 1,
			"the bare episode's media advancing",
		);
		expect((await observePlayback(obsidian)).media?.src).toBe(
			server.mediaUrl(sparse, sparse.episodes[0]),
		);
		await showLibrary(obsidian);
		await click(obsidian, ui.podcastCard("Journey Empty"));
		await obsidian.waitFor(async () => !(await isShown(obsidian, ui.episodeLoading)), {
			timeoutMs: 15_000,
			message: "the empty channel finished loading",
		});
		expect(await listedEpisodes(obsidian)).toEqual([]);
		expect(await isShown(obsidian, ui.noEpisodes)).toBe(true);
		expect(server.requests()).toContain("/empty/feed.xml");
		expect(await isShown(obsidian, ui.feedError), "an empty feed is no failure").toBe(false);
	});

	test("J-EDGE-05: a feed episode without pubDate still appears in the episode list (#378)", async () => {
		const context = getContext();
		const { obsidian } = context;
		const show: FixtureFeed = {
			title: "Journey Missing Date",
			slug: "missing-date",
			artwork: true,
			episodes: [
				{ title: "Dated Control", seconds: 6, pubDate: pubDate(0) },
				{ title: "Undated Episode", seconds: 6 },
			],
		};
		await seedLibrary(context, await serve(show), { subscriptions: [show] });
		await showPodNotes(obsidian);
		await click(obsidian, ui.podcastCard(show.title));
		await obsidian.waitFor(() => feedCacheHolds(obsidian, "Dated Control"), {
			timeoutMs: 15_000,
			message: "the missing-date feed loaded",
		});
		await obsidian.waitFor(async () => !(await isShown(obsidian, ui.episodeLoading)), {
			timeoutMs: 15_000,
			message: "the missing-date feed finished loading",
		});
		expect(await listedEpisodes(obsidian)).toEqual(["Dated Control", "Undated Episode"]);
	});

	test("a podcast without artwork still gets a card in the grid (#358)", async () => {
		const context = getContext();
		const { obsidian } = context;
		const control = feed("Journey Artwork Control", "control", ["Control Episode"]);
		const artless = feed("Journey No Artwork", "artless", ["Artless Episode"], false);
		await seedLibrary(context, await serve(control, artless), {
			subscriptions: [control, artless],
		});

		await showPodNotes(obsidian);
		await waitUntilShown(obsidian, ui.podcastCard("Journey Artwork Control"));
		await waitUntilShown(obsidian, ui.podcastCard("Journey No Artwork"));

		await click(obsidian, ui.podcastCard("Journey No Artwork"));
		await obsidian.waitFor(async () => (await listedEpisodes(obsidian)).length === 1, {
			timeoutMs: 15_000,
			message: "the artless podcast's episodes",
		});
		expect(await listedEpisodes(obsidian)).toEqual(["Artless Episode"]);
	});

	test("Latest episodes shows episodes that loaded while the Library was open (#375)", async () => {
		const context = getContext();
		const { obsidian } = context;
		const show = feed("Journey Latest", "latest", ["Latest Two", "Latest One"]);
		await seedLibrary(context, await serve(show), { subscriptions: [show] });

		await showPodNotes(obsidian);
		await waitUntilShown(obsidian, ui.podcastCard("Journey Latest"));
		await obsidian.waitFor(() => feedCacheHolds(obsidian, "Latest One"), {
			timeoutMs: 15_000,
			message: "the feed loaded while the grid shows",
		});
		await showList(obsidian, "Latest episodes");
		await obsidian.waitFor(async () => (await listedEpisodes(obsidian)).length === 2, {
			timeoutMs: 15_000,
			message: "Latest episodes to render its loaded episodes",
		});

		expect(await listedEpisodes(obsidian)).toEqual(["Latest Two", "Latest One"]);
	});

	test("J-LIST-04 a refresh that returns after the user moved on never shows the old feed or sticks", async () => {
		const context = getContext();
		const { obsidian } = context;
		const alpha = feed("Journey Refresh Alpha", "refresh-alpha", ["Alpha Two", "Alpha One"]);
		const beta = feed("Journey Refresh Beta", "refresh-beta", ["Beta Two", "Beta One"]);
		const server = await serve(alpha, beta);
		await seedLibrary(context, server, { subscriptions: [alpha, beta] });

		await showPodNotes(obsidian);
		await click(obsidian, ui.podcastCard(alpha.title));
		await obsidian.waitFor(async () => (await listedEpisodes(obsidian)).length === 2, {
			timeoutMs: 15_000,
			message: "Alpha's episodes",
		});
		let release = server.holdFeed(alpha);
		let cachedBefore = await feedCachedAt(obsidian, server.feedUrl(alpha));
		const alphaPath = new URL(server.feedUrl(alpha)).pathname;
		let requestsBefore = server.requests().filter((path) => path === alphaPath).length;
		await click(obsidian, ui.refreshEpisodes);
		await obsidian.waitFor(
			() => server.requests().filter((path) => path === alphaPath).length > requestsBefore,
			{
				timeoutMs: 10_000,
				message: "Alpha's refresh request to arrive",
			},
		);
		await showLibrary(obsidian);
		await click(obsidian, ui.podcastCard(beta.title));
		await obsidian.waitFor(async () => (await listedEpisodes(obsidian)).length === 2, {
			timeoutMs: 15_000,
			message: "Beta's episodes",
		});
		await release();
		await obsidian.waitFor(
			async () => (await feedCachedAt(obsidian, server.feedUrl(alpha))) > cachedBefore,
			{
				timeoutMs: 15_000,
				message: "Alpha's delayed response to update the cache",
			},
		);
		await obsidian.waitFor(
			async () =>
				!(await feedsLoading(obsidian)) && !(await isShown(obsidian, ui.episodeLoading)),
			{
				timeoutMs: 15_000,
				message: "the delayed refresh to settle on Beta",
			},
		);
		expect(await listedEpisodes(obsidian)).toEqual(["Beta Two", "Beta One"]);

		await showLibrary(obsidian);
		await click(obsidian, ui.podcastCard(alpha.title));
		release = server.holdFeed(alpha);
		cachedBefore = await feedCachedAt(obsidian, server.feedUrl(alpha));
		requestsBefore = server.requests().filter((path) => path === alphaPath).length;
		await click(obsidian, ui.refreshEpisodes);
		await obsidian.waitFor(
			() => server.requests().filter((path) => path === alphaPath).length > requestsBefore,
			{
				timeoutMs: 10_000,
				message: "Alpha's second refresh request to arrive",
			},
		);
		await showList(obsidian, "Latest episodes");
		await release();
		await obsidian.waitFor(
			async () => (await feedCachedAt(obsidian, server.feedUrl(alpha))) > cachedBefore,
			{
				timeoutMs: 15_000,
				message: "Alpha's second delayed response to update the cache",
			},
		);
		await obsidian.waitFor(
			async () =>
				(await listedEpisodes(obsidian)).length === 4 &&
				!(await feedsLoading(obsidian)) &&
				!(await isShown(obsidian, ui.episodeLoading)),
			{
				timeoutMs: 15_000,
				message: "Latest Episodes after the delayed refresh",
			},
		);
		// Both feeds publish on the same days, so Latest Episodes interleaves them.
		expect(await listedEpisodes(obsidian)).toEqual([
			"Alpha Two",
			"Beta Two",
			"Alpha One",
			"Beta One",
		]);
	});

	test("J-FEED-05 removing a podcast drops it from the grid, Latest Episodes and the feed cache at once, and another device's removal from the open Latest Episodes", async () => {
		const context = getContext();
		const { obsidian, plugin } = context;
		const keep = feed("Journey Keep", "keep", ["Keep One"]);
		const drop = feed("Journey Drop", "drop", ["Drop One"]);
		const synced = feed("Journey Drop Elsewhere", "drop-elsewhere", ["Elsewhere One"]);

		const server = await serve(keep, drop, synced);
		await seedLibrary(context, server, { subscriptions: [keep, drop, synced] });

		await showPodNotes(obsidian);
		await click(obsidian, ui.podcastCard(keep.title));
		await showList(obsidian, "Latest episodes");
		await obsidian.waitFor(async () => (await listedEpisodes(obsidian)).length === 3, {
			timeoutMs: 15_000,
			message: "every podcast in Latest Episodes",
		});
		expect(await feedCacheHolds(obsidian, "Drop One")).toBe(true);
		const dropPath = new URL(server.feedUrl(drop)).pathname;
		const dropRequests = server.requests().filter((path) => path === dropPath).length;

		await removePodcast(obsidian, drop.title);
		await waitForLibrary(
			plugin,
			(library) => library.subscriptions.length === 2,
			"the removed podcast unsaved",
		);
		expect(await feedCacheHolds(obsidian, "Drop One")).toBe(false);
		expect(await isShown(obsidian, ui.podcastCard(keep.title))).toBe(true);

		await showList(obsidian, "Latest episodes");
		expect((await listedEpisodes(obsidian)).sort()).toEqual(["Elsewhere One", "Keep One"]);
		expect(server.requests().filter((path) => path === dropPath)).toHaveLength(dropRequests);

		// Another device removes a podcast while this one shows Latest Episodes.
		await plugin.data<Record<string, any>>().patch((data) => {
			delete data.savedFeeds[synced.title];
		});
		await obsidian.waitFor(
			async () =>
				JSON.stringify(await listedEpisodes(obsidian)) === JSON.stringify(["Keep One"]),
			{
				timeoutMs: 15_000,
				message: "Latest Episodes to drop the podcast removed elsewhere",
			},
		);
		expect(await isShown(obsidian, ui.pageTitle("Latest episodes"))).toBe(true);
	});

	test("two saved podcasts sharing one feed URL each keep their own card, episodes and Remove", async () => {
		const context = getContext();
		const { obsidian, plugin } = context;
		const show = feed("Journey Shared", "shared", ["Shared One"]);
		await seedLibrary(context, await serve(show), { subscriptions: [show] });
		await plugin.updateDataAndReload<Record<string, any>>((data) => {
			data.savedFeeds["Journey Shared Alias"] = {
				...data.savedFeeds[show.title],
				title: "Journey Shared Alias",
			};
		}, RELOAD_OPTIONS);

		await showPodNotes(obsidian);
		for (const title of ["Journey Shared Alias", show.title]) {
			await showLibrary(obsidian);
			await click(obsidian, ui.podcastCard(title));
			await obsidian.waitFor(async () => (await listedEpisodes(obsidian)).length === 1, {
				timeoutMs: 15_000,
				message: `${title}'s episodes`,
			});
			expect(await listedEpisodes(obsidian)).toEqual(["Shared One"]);
			expect(await shownText(obsidian)).toContain(title);
		}

		await removePodcast(obsidian, "Journey Shared Alias");
		await waitForLibrary(
			plugin,
			(library) => library.subscriptions.length === 1,
			"the alias unsaved",
		);
		expect((await readLibrary(plugin)).subscriptions.map((entry) => entry.title)).toEqual([
			show.title,
		]);
		await showLibrary(obsidian);
		expect(await isShown(obsidian, ui.podcastCard("Journey Shared Alias"))).toBe(false);
		await click(obsidian, ui.podcastCard(show.title));
		await obsidian.waitFor(async () => (await listedEpisodes(obsidian)).length === 1, {
			timeoutMs: 15_000,
			message: "the remaining podcast's episodes",
		});
	});

	test("J-EDGE-03 offline with a cache older than its TTL still lists the podcast's episodes", async () => {
		const context = getContext();
		const { obsidian, plugin } = context;
		const show = feed("Journey Stale", "stale", ["Stale Two", "Stale One"]);
		const server = await serve(show);
		await seedLibrary(context, server, { subscriptions: [show] });

		await showPodNotes(obsidian);
		await obsidian.waitFor(() => feedCacheHolds(obsidian, "Stale One"), {
			timeoutMs: 15_000,
			message: "the feed cached while online",
		});
		await server.stop();
		await closePodNotes(obsidian);
		await ageFeedCache(obsidian, 7 * 60 * 60 * 1000);
		await plugin.reload(RELOAD_OPTIONS);

		await showPodNotes(obsidian);
		await click(obsidian, ui.podcastCard(show.title));
		await obsidian.waitFor(async () => (await listedEpisodes(obsidian)).length === 2, {
			timeoutMs: 15_000,
			message: "the stale cached episodes offline",
		});
		expect(await listedEpisodes(obsidian)).toEqual(["Stale Two", "Stale One"]);
		expect(await notices(obsidian)).toEqual([]);
	});
	test("podcasts titled toString and __proto__ download, queue, play and keep their names after a reload", async () => {
		const context = getContext();
		const { obsidian, plugin } = context;
		const toStringShow = feed("toString", "to-string", ["To String Episode"]);
		const protoShow = feed("__proto__", "proto", ["Proto Episode"]);
		const server = await serve(toStringShow, protoShow);
		await seedLibrary(context, server, { subscriptions: [toStringShow, protoShow] });

		await showPodNotes(obsidian);
		await click(obsidian, ui.podcastCard("toString"));
		await waitUntilShown(obsidian, ui.episode("To String Episode"));
		await click(obsidian, ui.episode("To String Episode"), { button: "right" });
		await click(obsidian, ui.menuItem("Download"));
		await waitForLibrary(
			plugin,
			(library) => library.downloads.some((entry) => entry.podcast === "toString"),
			"the toString episode downloaded",
		);
		await click(obsidian, ui.episode("To String Episode"), { button: "right" });
		await click(obsidian, ui.menuItem("Add to queue"));
		await waitForLibrary(
			plugin,
			(library) => library.queue.includes("To String Episode"),
			"the toString episode queued",
		);
		await click(obsidian, ui.episode("To String Episode"));
		await waitForPlayback(
			obsidian,
			(playback) => playback.episode?.podcast === "toString" && playback.seconds > 0,
			"the toString episode playing",
		);

		await plugin.reload(RELOAD_OPTIONS);
		const saved = await plugin.data<{ savedFeeds: Record<string, unknown> }>().read();
		expect(Object.keys(saved.savedFeeds).sort()).toEqual(["__proto__", "toString"]);
		expect(
			await obsidian.dev.evalJson<boolean>(
				`Object.keys(app.plugins.plugins.podnotes.settings.savedFeeds).includes("__proto__") && ({}).url === undefined`,
			),
		).toBe(true);
		await showPodNotes(obsidian);
		await showLibrary(obsidian);
		await waitUntilShown(obsidian, ui.podcastCard("__proto__"));
	});
});
