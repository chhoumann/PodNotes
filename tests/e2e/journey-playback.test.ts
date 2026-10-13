import { describe, expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness } from "./harness";
import {
	closePodNotes,
	closeSettings,
	openInReadingView,
	openPodNotesSettings,
	restartObsidian,
	runCommand,
	showLibrary,
	showPodNotes,
} from "./journey/actions";
import { click } from "./journey/input";
import { ui } from "./journey/targets";
import { waitUntilShown } from "./journey/wait";
import {
	type FixtureEpisode,
	type FixtureFeed,
	type FixtureServer,
	pubDate,
	startFixtureServer,
} from "./journey/fixtures";
import {
	episodeRef,
	feedCachedAt,
	observePlayback,
	type PlaybackObservation,
	playbackOver,
	readLibrary,
	seedLibrary,
	storedEpisode,
	waitForLibrary,
	waitForPlayback,
	writeVaultFile,
} from "./journey/library";
import { jsLiteral, PLUGIN_ID } from "./runtime";

const LONG: FixtureEpisode = { title: "Long Listen", seconds: 60, pubDate: pubDate(0) };
const OPENER: FixtureEpisode = { title: "Short Opener", seconds: 6, pubDate: pubDate(1) };
const FOLLOW_UP: FixtureEpisode = { title: "Short Follow-up", seconds: 6, pubDate: pubDate(2) };
const SECOND: FixtureEpisode = { title: "Second Listen", seconds: 60, pubDate: pubDate(3) };
const FEED: FixtureFeed = {
	title: "Journey Playback",
	slug: "playback",
	artwork: true,
	episodes: [LONG, OPENER, FOLLOW_UP, SECOND],
};
const OTHER_SHOW: FixtureFeed = {
	title: "Journey Playback Other",
	slug: "playback-other",
	artwork: true,
	episodes: [{ title: LONG.title, seconds: 60, pubDate: pubDate(0) }],
};
const isolatedInstance = Boolean(process.env.OBSIDIAN_E2E_OBSIDIAN_HOME);

const getContext = createPodNotesE2EHarness("journey-playback");

async function serve(...feeds: FixtureFeed[]): Promise<FixtureServer> {
	const server = await startFixtureServer(feeds.length ? feeds : [FEED]);
	onTestFinished(() => server.stop());
	return server;
}

async function expectAdvancing(label: string): Promise<PlaybackObservation> {
	const [first, later] = await playbackOver(getContext().obsidian, 1500);
	expect({ label, playing: later.playing, advance: later.seconds - first.seconds }).toMatchObject(
		{
			label,
			playing: true,
		},
	);
	expect(later.seconds - first.seconds, `${label}: seconds advanced`).toBeGreaterThan(1);
	expect(later.episode?.title, `${label}: same episode`).toBe(first.episode?.title);
	return later;
}

async function evalApi(code: string): Promise<void> {
	await getContext().obsidian.dev.evalJson(
		`(() => { const api = app.plugins.plugins.${PLUGIN_ID}.api; ${code}; return true; })()`,
	);
}

async function playFromList(episode: FixtureEpisode): Promise<void> {
	const { obsidian } = getContext();
	await showPodNotes(obsidian);
	await showLibrary(obsidian);
	await click(obsidian, ui.podcastCard(FEED.title));
	await click(obsidian, ui.episode(episode.title));
	await waitForPlayback(
		obsidian,
		(playback) =>
			playback.episode?.title === episode.title && playback.playing && playback.seconds > 0,
		`${episode.title} playing`,
	);
}

describe("playback journeys", () => {
	test("J-LIST-08 clicking an episode in the list plays its real media", async () => {
		const context = getContext();
		const server = await serve();
		await seedLibrary(context, server, { subscriptions: [FEED] });

		await playFromList(LONG);
		const [first, second] = await playbackOver(context.obsidian, 1500);

		expect(second.episode).toEqual({ podcast: "Journey Playback", title: "Long Listen" });
		expect(second.playing).toBe(true);
		expect(second.media).toMatchObject({ src: server.mediaUrl(FEED, LONG), paused: false });
		expect(second.duration).toBeCloseTo(60, 1);
		expect(second.seconds - first.seconds).toBeGreaterThan(1);
		expect(server.requests()).toContain("/playback/1.wav");
	});

	test("J-PLAY-01 the on-screen button pauses, keeps the position, and resumes", async () => {
		const context = getContext();
		const { obsidian, plugin } = context;
		await seedLibrary(context, await serve(), { subscriptions: [FEED] });
		await playFromList(LONG);
		await waitForPlayback(obsidian, (playback) => playback.seconds >= 2, "two seconds played");

		await click(obsidian, ui.playbackToggle);
		await waitForPlayback(
			obsidian,
			(playback) => !playback.playing && playback.media?.paused === true,
			"paused",
		);
		const [pausedAt, pausedLater] = await playbackOver(obsidian, 1500);
		expect(pausedLater.seconds).toBe(pausedAt.seconds);
		expect(pausedLater.media?.seconds).toBe(pausedAt.media?.seconds);
		expect(pausedLater.seconds).toBeGreaterThanOrEqual(2);

		const saved = await waitForLibrary(
			plugin,
			(library) =>
				Math.abs(
					(library.progress(episodeRef(FEED, LONG))?.seconds ?? -1) - pausedLater.seconds,
				) < 0.25,
			"the paused position saved",
		);
		expect(saved.progress(episodeRef(FEED, LONG))?.finished).toBe(false);

		await click(obsidian, ui.playbackToggle);
		await waitForPlayback(
			obsidian,
			(playback) => playback.playing && playback.seconds > pausedLater.seconds + 0.5,
			"playback resumes from the paused position",
		);
	});

	test("J-PLAY-09 an episode that ends is marked played and the queue plays the next one", async () => {
		const context = getContext();
		const { obsidian, plugin } = context;
		const server = await serve();
		await seedLibrary(context, server, {
			subscriptions: [FEED],
			queue: [storedEpisode(server, FEED, FOLLOW_UP)],
			playlists: [
				{
					name: "Journey Picks",
					removeAfterPlay: true,
					episodes: [storedEpisode(server, FEED, OPENER)],
				},
			],
		});

		await playFromList(OPENER);
		const next = await waitForPlayback(
			obsidian,
			(playback) =>
				playback.episode?.title === FOLLOW_UP.title &&
				playback.playing &&
				playback.seconds > 0.5,
			"the queued episode playing after the first one ends",
			20_000,
		);
		expect(next.media).toMatchObject({ src: server.mediaUrl(FEED, FOLLOW_UP), paused: false });

		const library = await waitForLibrary(
			plugin,
			(saved) => saved.progress(episodeRef(FEED, OPENER))?.finished === true,
			"the finished episode saved as played",
		);
		expect(library.progress(episodeRef(FEED, OPENER))).toMatchObject({ finished: true });
		expect(library.queue).toEqual([]);
		expect(library.playlists).toEqual({ "Journey Picks": [] });
		expect(library.currentEpisode).toEqual({
			podcast: "Journey Playback",
			title: "Short Follow-up",
		});
	}, 60_000);

	test.runIf(isolatedInstance)(
		"#377 J-PLAY-11: after restart the restored player keeps its saved position without autoplay",
		async () => {
			const context = getContext();
			const { obsidian, plugin } = context;
			await seedLibrary(context, await serve(), { subscriptions: [FEED] });
			await playFromList(LONG);

			const checkpoint = (
				await waitForLibrary(
					plugin,
					(library) => (library.progress(episodeRef(FEED, LONG))?.seconds ?? 0) >= 5,
					"a playback checkpoint of at least 5 s on disk",
					// The second write lands about 20 s after the click.
					30_000,
				)
			).progress(episodeRef(FEED, LONG))?.seconds as number;
			expect((await observePlayback(obsidian)).playing).toBe(true);

			const { before, after } = await restartObsidian(obsidian);
			expect(after.mainPid).not.toBe(before.mainPid);
			expect(after.rendererPid).not.toBe(before.rendererPid);

			const restored = await readLibrary(plugin);
			const saved = restored.progress(episodeRef(FEED, LONG))?.seconds as number;
			expect(restored.currentEpisode).toEqual({
				podcast: "Journey Playback",
				title: "Long Listen",
			});
			expect(saved).toBeGreaterThanOrEqual(checkpoint);
			expect(saved).toBeLessThanOrEqual(checkpoint + 7);

			const relaunched = await observePlayback(obsidian);
			expect(relaunched.episode).toEqual({
				podcast: "Journey Playback",
				title: "Long Listen",
			});
			expect(relaunched.playing).toBe(false);

			await showPodNotes(obsidian);
			await waitUntilShown(obsidian, ui.fullPlayer);
			const shown = await waitForPlayback(
				obsidian,
				(playback) => playback.seconds > 0,
				"the player shows the restored episode",
			);
			expect(shown.episode).toEqual({ podcast: "Journey Playback", title: "Long Listen" });
			expect(shown.seconds).toBeGreaterThanOrEqual(saved - 0.5);
			expect(shown.seconds).toBeLessThanOrEqual(saved + 3);
			const [first, later] = await playbackOver(obsidian, 1500);
			expect(later.playing).toBe(false);
			expect(later.media?.paused).toBe(true);
			expect(later.seconds - first.seconds).toBe(0);

			await click(obsidian, ui.playbackToggle);
			const resumed = await waitForPlayback(
				obsidian,
				(playback) => playback.playing && playback.seconds > saved + 0.5,
				"the restored episode resumes from its saved position",
			);
			expect(resumed.seconds).toBeLessThan(saved + 5);
		},
		120_000,
	);

	test("#355 audio keeps playing while the user browses the grid, an episode list and settings", async () => {
		const context = getContext();
		const { obsidian } = context;
		await seedLibrary(context, await serve(), { subscriptions: [FEED] });
		await playFromList(LONG);

		await showLibrary(obsidian);
		await expectAdvancing("on the podcast grid");
		await click(obsidian, ui.podcastCard(FEED.title));
		await expectAdvancing("in an episode list");
		await openPodNotesSettings(obsidian);
		try {
			await expectAdvancing("in settings");
		} finally {
			await closeSettings(obsidian);
		}
		await click(obsidian, ui.openPlayer);
		const back = await expectAdvancing("back in the player");
		expect(back.media).toMatchObject({ paused: false });
	});

	test("#353 a restored position survives switching to another episode before the player opens", async () => {
		const context = getContext();
		const { obsidian, plugin } = context;
		const server = await serve();
		const long = storedEpisode(server, FEED, LONG);
		await seedLibrary(context, server, {
			subscriptions: [FEED],
			current: long,
			progress: [{ episode: long, seconds: 30, duration: 60, finished: false }],
		});

		await playFromList(SECOND);
		expect((await readLibrary(plugin)).progress(episodeRef(FEED, LONG))).toEqual({
			seconds: 30,
			duration: 60,
			finished: false,
		});

		await showLibrary(obsidian);
		await click(obsidian, ui.podcastCard(FEED.title));
		await click(obsidian, ui.episode(LONG.title));
		const resumed = await waitForPlayback(
			obsidian,
			(playback) =>
				playback.episode?.title === LONG.title && playback.playing && playback.seconds > 0,
			"the restored episode playing again",
		);
		expect(resumed.seconds).toBeGreaterThanOrEqual(29.5);
		expect(resumed.seconds).toBeLessThan(34);
	});

	test("J-PLAY-12 J-API-06 J-URI-07 commands, the API and a timestamp link control playback with the view closed", async () => {
		const context = getContext();
		const { obsidian, sandbox } = context;
		const server = await serve();
		await seedLibrary(context, server, { subscriptions: [FEED] });
		await playFromList(LONG);
		await closePodNotes(obsidian);
		await expectAdvancing("after closing the PodNotes view");

		await runCommand(obsidian, `${PLUGIN_ID}:stop-playing`);
		await waitForPlayback(obsidian, (playback) => !playback.playing, "stopped by the command");
		const [stopped, stillStopped] = await playbackOver(obsidian, 1000);
		expect(stillStopped.seconds).toBe(stopped.seconds);
		await runCommand(obsidian, `${PLUGIN_ID}:start-playing`);
		await expectAdvancing("started by the command");
		await runCommand(obsidian, `${PLUGIN_ID}:podnotes-toggle-playback`);
		await waitForPlayback(obsidian, (playback) => !playback.playing, "paused by the toggle");

		await evalApi("api.start()");
		await expectAdvancing("started by api.start()");
		await evalApi("api.currentTime = 40");
		const seeked = await waitForPlayback(
			obsidian,
			(playback) => playback.playing && playback.seconds >= 40,
			"playing on from the API seek",
		);
		expect(seeked.seconds).toBeLessThan(44);
		await evalApi("api.currentTime = Number.NaN");
		const afterNaN = await observePlayback(obsidian);
		expect(Number.isFinite(afterNaN.seconds)).toBe(true);
		expect(afterNaN.seconds).toBeGreaterThanOrEqual(seeked.seconds);
		await evalApi("api.stop()");
		await waitForPlayback(obsidian, (playback) => !playback.playing, "stopped by api.stop()");

		const notePath = sandbox.path("Closed view link.md");
		await writeVaultFile(
			obsidian,
			notePath,
			`[00:00:20](obsidian://podnotes?episodeName=${encodeURIComponent(LONG.title)}&url=${encodeURIComponent(server.feedUrl(FEED))}&time=20)\n`,
		);
		await openInReadingView(obsidian, notePath);
		await click(obsidian, ui.readingLink("00:00:20"));
		const linked = await waitForPlayback(
			obsidian,
			(playback) =>
				playback.episode?.title === LONG.title &&
				playback.playing &&
				playback.seconds >= 20 &&
				playback.seconds < 24,
			"the link seeks and plays",
		);
		expect(linked.episode).toEqual(episodeRef(FEED, LONG));
	});

	test("a link to another show's same-titled episode plays that show's episode", async () => {
		const context = getContext();
		const { obsidian, sandbox } = context;
		const server = await serve(FEED, OTHER_SHOW);
		await seedLibrary(context, server, { subscriptions: [FEED, OTHER_SHOW] });
		await playFromList(LONG);

		const notePath = sandbox.path("Other show link.md");
		await writeVaultFile(
			obsidian,
			notePath,
			`[00:00:10](obsidian://podnotes?episodeName=${encodeURIComponent(LONG.title)}&url=${encodeURIComponent(server.feedUrl(OTHER_SHOW))}&time=10)\n`,
		);
		await openInReadingView(obsidian, notePath);
		await click(obsidian, ui.readingLink("00:00:10"));
		const other = await waitForPlayback(
			obsidian,
			(playback) =>
				playback.episode?.podcast === OTHER_SHOW.title &&
				playback.playing &&
				playback.seconds >= 10,
			"the other show's episode playing",
		);
		expect(other.episode).toEqual(episodeRef(OTHER_SHOW, OTHER_SHOW.episodes[0]));
		expect(other.media?.src).toBe(server.mediaUrl(OTHER_SHOW, OTHER_SHOW.episodes[0]));
		expect(other.seconds).toBeLessThan(14);
	});

	test("Start playing while a slow link to another show loads keeps playing the paused episode", async () => {
		const context = getContext();
		const { obsidian, plugin, sandbox } = context;
		const server = await serve(FEED, OTHER_SHOW);
		await seedLibrary(context, server, { subscriptions: [FEED, OTHER_SHOW] });
		await playFromList(LONG);
		await click(obsidian, ui.playbackToggle);
		await waitForPlayback(
			obsidian,
			(playback) => !playback.playing && playback.media?.paused === true,
			"paused",
		);

		const release = server.holdFeed(OTHER_SHOW);
		const cachedBefore = await feedCachedAt(obsidian, server.feedUrl(OTHER_SHOW));
		const otherFeedPath = new URL(server.feedUrl(OTHER_SHOW)).pathname;
		const notePath = sandbox.path("Slow other show link.md");
		await writeVaultFile(
			obsidian,
			notePath,
			`[00:00:10](obsidian://podnotes?episodeName=${encodeURIComponent(LONG.title)}&url=${encodeURIComponent(server.feedUrl(OTHER_SHOW))}&time=10)\n`,
		);
		await openInReadingView(obsidian, notePath);
		const requestsBefore = server.requests().filter((path) => path === otherFeedPath).length;
		await click(obsidian, ui.readingLink("00:00:10"));
		await obsidian.waitFor(
			() =>
				server.requests().filter((path) => path === otherFeedPath).length > requestsBefore,
			{ timeoutMs: 10_000, intervalMs: 50, message: "the link's feed request to arrive" },
		);
		await runCommand(obsidian, `${PLUGIN_ID}:start-playing`);
		await expectAdvancing("resumed while the link's feed loads");

		await release();
		await obsidian.waitFor(
			async () => (await feedCachedAt(obsidian, server.feedUrl(OTHER_SHOW))) > cachedBefore,
			{
				timeoutMs: 15_000,
				message: "the linked feed response to enter the cache",
			},
		);
		const after = await expectAdvancing("after the link's feed arrived");
		expect(after.episode).toEqual(episodeRef(FEED, LONG));
		expect(after.media?.src).toBe(server.mediaUrl(FEED, LONG));
		await obsidian.dev.evalJsonAsync(
			`(async () => { await app.plugins.plugins.${PLUGIN_ID}.flushSaves(); return true; })()`,
		);
		expect((await readLibrary(plugin)).currentEpisode).toEqual(episodeRef(FEED, LONG));
	}, 60_000);

	test("a data.json change from another device during playback does not seek, reload, or advance the queue", async () => {
		const context = getContext();
		const { obsidian, plugin } = context;
		const server = await serve();
		await seedLibrary(context, server, {
			subscriptions: [FEED],
			queue: [storedEpisode(server, FEED, FOLLOW_UP)],
		});
		await playFromList(LONG);
		const before = await waitForPlayback(
			obsidian,
			(playback) => playback.seconds >= 3,
			"three seconds played",
		);

		await obsidian.dev.evalJsonAsync(
			`(async () => { await app.plugins.plugins.${PLUGIN_ID}.flushSaves(); return true; })()`,
		);

		await plugin.data<Record<string, any>>().patch((data) => {
			data.playedEpisodes[`${FEED.title}::${LONG.title}`] = {
				title: LONG.title,
				podcastName: FEED.title,
				time: 50,
				duration: 60,
				finished: false,
			};
			data.currentEpisode = storedEpisode(server, FEED, OPENER);
			data.queue.episodes = [
				storedEpisode(server, FEED, FOLLOW_UP),
				storedEpisode(server, FEED, OPENER),
			];
		});
		await obsidian.waitFor(
			() =>
				obsidian.dev.evalJson<boolean>(
					`app.plugins.plugins.${PLUGIN_ID}.settings.queue.episodes.length === 2`,
				),
			{ timeoutMs: 15_000, intervalMs: 200, message: "the remote change merged" },
		);

		expect(
			await obsidian.dev.evalJson<number>(
				`app.plugins.plugins.${PLUGIN_ID}.settings.playedEpisodes[${jsLiteral(`${FEED.title}::${LONG.title}`)}]?.time`,
			),
		).toBe(50);

		const after = await expectAdvancing("after the remote change");
		expect(after.episode).toEqual(episodeRef(FEED, LONG));
		expect(after.seconds).toBeGreaterThan(before.seconds);
		expect(after.seconds).toBeLessThan(before.seconds + 10);
		expect(after.media?.src).toBe(before.media?.src);
		await obsidian.dev.evalJsonAsync(
			`(async () => { await app.plugins.plugins.${PLUGIN_ID}.flushSaves(); return true; })()`,
		);
		const saved = await readLibrary(plugin);
		expect(saved.queue).toEqual([FOLLOW_UP.title, OPENER.title]);
		expect(saved.currentEpisode).toEqual(episodeRef(FEED, OPENER));
	});

	test("#355 J-PLAY-09 an episode that ends while the user browses plays the queued one", async () => {
		const context = getContext();
		const { obsidian, plugin } = context;
		const server = await serve();
		await seedLibrary(context, server, {
			subscriptions: [FEED],
			queue: [storedEpisode(server, FEED, FOLLOW_UP)],
		});
		await playFromList(OPENER);
		await showLibrary(obsidian);

		await waitForPlayback(
			obsidian,
			(playback) =>
				playback.episode?.title === FOLLOW_UP.title &&
				playback.playing &&
				playback.seconds > 0.5,
			"the queued episode playing after the first one ends",
			20_000,
		);
		const library = await waitForLibrary(
			plugin,
			(saved) => saved.progress(episodeRef(FEED, OPENER))?.finished === true,
			"the finished episode saved as played",
		);
		expect(library.queue).toEqual([]);
		expect(library.currentEpisode).toEqual(episodeRef(FEED, FOLLOW_UP));
	}, 60_000);
});
