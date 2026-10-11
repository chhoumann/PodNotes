import { describe, expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness, expectKnownFailure } from "./harness";
import { click, restartObsidian, showPodNotes, ui } from "./journey/actions";
import {
	type FixtureEpisode,
	type FixtureFeed,
	type FixtureServer,
	pubDate,
	startFixtureServer,
} from "./journey/fixtures";
import {
	episodeRef,
	observePlayback,
	playbackOver,
	readLibrary,
	seedLibrary,
	storedEpisode,
	waitForLibrary,
	waitForPlayback,
} from "./journey/library";

const LONG: FixtureEpisode = { title: "Long Listen", seconds: 60, pubDate: pubDate(0) };
const OPENER: FixtureEpisode = { title: "Short Opener", seconds: 6, pubDate: pubDate(1) };
const FOLLOW_UP: FixtureEpisode = { title: "Short Follow-up", seconds: 6, pubDate: pubDate(2) };
const FEED: FixtureFeed = {
	title: "Journey Playback",
	slug: "playback",
	artwork: true,
	episodes: [LONG, OPENER, FOLLOW_UP],
};
const isolatedInstance = Boolean(process.env.OBSIDIAN_E2E_OBSIDIAN_HOME);

const getContext = createPodNotesE2EHarness("journey-playback");

async function serve(): Promise<FixtureServer> {
	const server = await startFixtureServer([FEED]);
	onTestFinished(() => server.stop());
	return server;
}

async function playFromList(episode: FixtureEpisode): Promise<void> {
	const { obsidian } = getContext();
	await showPodNotes(obsidian);
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
		await obsidian.sleep(500);
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
		"#377 known failure J-PLAY-11: after restart the restored player keeps its saved position without autoplay",
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
					20_000,
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
			await click(obsidian, ui.playerTab);
			const resumed = await waitForPlayback(
				obsidian,
				(playback) => playback.media !== null && playback.seconds > 0,
				"the player loads the restored episode",
			);
			expect(resumed.episode).toEqual({ podcast: "Journey Playback", title: "Long Listen" });
			expect(resumed.seconds).toBeGreaterThanOrEqual(saved - 0.5);
			expect(resumed.seconds).toBeLessThanOrEqual(saved + 3);
			const [first, later] = await playbackOver(obsidian, 1500);
			const captured = {
				playing: later.playing,
				mediaPaused: later.media?.paused,
				advance: later.seconds - first.seconds,
			};
			expectKnownFailure(377, captured, {
				correct: (value) => {
					expect(value.playing).toBe(false);
					expect(value.mediaPaused).toBe(true);
					expect(value.advance).toBe(0);
				},
				reproduces: (value) =>
					value.playing && value.mediaPaused === false && value.advance > 1,
			});
		},
		120_000,
	);
});
