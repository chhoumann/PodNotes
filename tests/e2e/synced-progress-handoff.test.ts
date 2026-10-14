import { expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness, type PodNotesData } from "./harness";
import { showLibrary, showPodNotes } from "./journey/actions";
import { type FixtureFeed, pubDate, startFixtureServer } from "./journey/fixtures";
import { click } from "./journey/input";
import { observePlayback, seedLibrary, waitForPlayback } from "./journey/library";
import { ui } from "./journey/targets";
import { jsLiteral, PLUGIN_ID, WAIT_OPTS } from "./runtime";

const getContext = createPodNotesE2EHarness("synced-progress-handoff");
const FEED: FixtureFeed = {
	title: "Handoff Podcast",
	slug: "handoff",
	artwork: true,
	episodes: [{ title: "Handoff Episode", seconds: 60, pubDate: pubDate(0) }],
};
const PROGRESS_KEY = "Handoff Podcast::Handoff Episode";
const POLL = { timeout: WAIT_OPTS.timeoutMs, interval: WAIT_OPTS.intervalMs };

const SAVED_AFTER = { hide: 45, seek: 25, "native seek": 42 };

for (const [action, expected] of Object.entries(SAVED_AFTER)) {
	test(`a paused episode adopts synced progress before a local ${action} (#461)`, async () => {
		const context = getContext();
		const { obsidian, plugin } = context;
		const server = await startFixtureServer([FEED]);
		onTestFinished(() => server.stop());
		await seedLibrary(context, server, { subscriptions: [FEED] });
		await showPodNotes(obsidian);
		await showLibrary(obsidian);
		await click(obsidian, ui.podcastCard(FEED.title));
		await click(obsidian, ui.episode("Handoff Episode"));
		await waitForPlayback(obsidian, (state) => state.playing && state.seconds > 0, "playing");
		await click(obsidian, ui.playbackToggle);
		await waitForPlayback(obsidian, (state) => !state.playing, "paused");
		const before = await observePlayback(obsidian);
		await plugin.waitForData<PodNotesData>(
			(data) => data.playedEpisodes?.[PROGRESS_KEY]?.time === before.seconds,
			WAIT_OPTS,
		);
		expect(before.seconds).toBeLessThan(45);

		await obsidian.dev.evalJson(`(() => {
			const original = navigator.mediaSession.setPositionState.bind(navigator.mediaSession);
			navigator.mediaSession.setPositionState = (state) => {
				window.__handoffMediaPosition = state?.position;
				return original(state);
			};
			window.__handoffRestoreMediaPosition = () => { navigator.mediaSession.setPositionState = original; };
			return true;
		})()`);
		onTestFinished(() =>
			obsidian.dev.evalJson(`(() => {
				window.__handoffRestoreMediaPosition?.();
				delete window.__handoffRestoreMediaPosition;
				delete window.__handoffMediaPosition;
				require("@electron/remote").getCurrentWindow().show();
				return true;
			})()`),
		);
		await plugin.data<PodNotesData>().patch((data) => {
			const progress = data.playedEpisodes?.[PROGRESS_KEY];
			if (!progress) throw new Error("The paused episode has no saved progress.");
			progress.time = 45;
		});
		await expect
			.poll(
				() =>
					obsidian.dev.evalJson<number>(
						`app.plugins.plugins.${PLUGIN_ID}.settings.playedEpisodes[${jsLiteral(PROGRESS_KEY)}]?.time`,
					),
				POLL,
			)
			.toBe(45);
		await expect
			.poll(() => observePlayback(obsidian), POLL)
			.toMatchObject({
				playing: false,
				seconds: 45,
				media: { seconds: 45, paused: true },
			});
		expect(await obsidian.dev.evalJson<number>("window.__handoffMediaPosition")).toBe(45);
		await expect
			.poll(
				() =>
					obsidian.dev.evalJson<string>(
						'document.querySelector(".pn-player .pn-times span")?.textContent',
					),
				POLL,
			)
			.toBe("0:45");
		await click(obsidian, ui.collapsePlayer);
		expect(
			await obsidian.dev.evalJson<string>(
				'document.querySelector(".pn-mini [role=progressbar]")?.getAttribute("aria-valuenow")',
			),
		).toBe("45");

		if (action === "seek") {
			await click(obsidian, ui.openPlayer);
			await obsidian.dev.evalJson(`(() => {
				app.plugins.plugins.${PLUGIN_ID}.api.currentTime = 25;
				return true;
			})()`);
		} else if (action === "native seek") {
			await obsidian.dev.evalJsonAsync(`(async () => {
				const media = document.querySelector(".podnotes-media");
				const seeked = new Promise((resolve) => media.addEventListener("seeked", resolve, { once: true }));
				media.currentTime = 42;
				await seeked;
				return true;
			})()`);
		} else {
			await obsidian.dev.evalJson(
				'require("@electron/remote").getCurrentWindow().hide(), true',
			);
			await expect
				.poll(() => obsidian.dev.evalJson<string>("document.visibilityState"), POLL)
				.toBe("hidden");
		}
		await obsidian.dev.evalJsonAsync(`(async () => {
			const plugin = app.plugins.plugins.${PLUGIN_ID};
			plugin.player.save();
			await plugin.flushSaves();
			return true;
		})()`);
		expect(
			(await plugin.data<PodNotesData>().read()).playedEpisodes?.[PROGRESS_KEY]?.time,
		).toBe(expected);
		expect((await observePlayback(obsidian)).seconds).toBe(expected);
	});
}

const PLAY_AFTER_END = { "a re-listen synced afterwards": 30, "no newer progress": 0 };

for (const [sync, expected] of Object.entries(PLAY_AFTER_END)) {
	test(`Play on a naturally ended episode with ${sync} starts at ${expected} s (#463)`, async () => {
		const context = getContext();
		const { obsidian, plugin } = context;
		const server = await startFixtureServer([FEED]);
		onTestFinished(() => server.stop());
		await seedLibrary(context, server, { subscriptions: [FEED] });
		await showPodNotes(obsidian);
		await showLibrary(obsidian);
		await click(obsidian, ui.podcastCard(FEED.title));
		await click(obsidian, ui.episode("Handoff Episode"));
		await waitForPlayback(obsidian, (state) => state.playing && state.seconds > 0, "playing");
		await obsidian.dev.evalJson(`(() => {
			app.plugins.plugins.${PLUGIN_ID}.api.currentTime = 57;
			return true;
		})()`);
		await plugin.waitForData<PodNotesData>(
			(data) => data.playedEpisodes?.[PROGRESS_KEY]?.finished === true,
			WAIT_OPTS,
		);
		const ended = await waitForPlayback(
			obsidian,
			(state) => !state.playing && state.media?.paused === true,
			"ended",
		);
		expect(ended.seconds).toBeGreaterThan(59);

		if (expected > 0) {
			await plugin.data<PodNotesData>().patch((data) => {
				const progress = data.playedEpisodes?.[PROGRESS_KEY];
				if (!progress) throw new Error("The ended episode has no saved progress.");
				progress.time = expected;
				progress.finished = false;
			});
			await expect
				.poll(
					() =>
						obsidian.dev.evalJson<number>(
							`app.plugins.plugins.${PLUGIN_ID}.settings.playedEpisodes[${jsLiteral(PROGRESS_KEY)}]?.time`,
						),
					POLL,
				)
				.toBe(expected);
		}
		await obsidian.dev.evalJsonAsync(`(async () => {
			const plugin = app.plugins.plugins.${PLUGIN_ID};
			plugin.player.save();
			await plugin.flushSaves();
			return true;
		})()`);
		expect(
			(await plugin.data<PodNotesData>().read()).playedEpisodes?.[PROGRESS_KEY],
		).toMatchObject(expected > 0 ? { time: expected, finished: false } : { finished: true });

		await click(obsidian, ui.playbackToggle);
		const resumed = await waitForPlayback(
			obsidian,
			(state) => state.playing && state.media?.paused === false,
			"playing again",
		);
		expect(resumed.seconds).toBeGreaterThanOrEqual(expected);
		expect(resumed.seconds).toBeLessThan(expected + 5);

		await click(obsidian, ui.playbackToggle);
		const paused = await waitForPlayback(
			obsidian,
			(state) => !state.playing && state.media?.paused === true,
			"paused again",
		);
		await obsidian.dev.evalJsonAsync(
			`(async () => { await app.plugins.plugins.${PLUGIN_ID}.flushSaves(); return true; })()`,
		);
		const progress = (await plugin.data<PodNotesData>().read()).playedEpisodes?.[PROGRESS_KEY];
		expect(progress).toMatchObject({ time: paused.seconds, finished: false });
		expect(progress?.time).toBeGreaterThanOrEqual(expected);
		expect(progress?.time).toBeLessThan(expected + 5);
	});
}
