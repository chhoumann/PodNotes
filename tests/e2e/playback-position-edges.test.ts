import { expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness, type PodNotesData } from "./harness";
import { showLibrary, showPodNotes } from "./journey/actions";
import { type FixtureFeed, pubDate, startFixtureServer } from "./journey/fixtures";
import { click } from "./journey/input";
import { seedLibrary, waitForPlayback } from "./journey/library";
import { ui } from "./journey/targets";
import { jsLiteral, WAIT_OPTS } from "./runtime";

const getContext = createPodNotesE2EHarness("playback-position-edges");
const FEED: FixtureFeed = {
	title: "Position Edges",
	slug: "position-edges",
	artwork: true,
	episodes: [{ title: "Ended Seek", seconds: 60, pubDate: pubDate(0) }],
};
const KEY = "Position Edges::Ended Seek";

for (const delivered of [false, true]) {
	for (const path of ["player button", "episode play"] as const) {
		test(`#465 a native seek after natural end wins ${delivered ? "after native seek events" : "before events arrive"} through ${path}`, async () => {
			const context = getContext();
			const { obsidian, plugin } = context;
			const server = await startFixtureServer([FEED]);
			onTestFinished(() => server.stop());
			await seedLibrary(context, server, { subscriptions: [FEED] });
			await showPodNotes(obsidian);
			await showLibrary(obsidian);
			await click(obsidian, ui.podcastCard(FEED.title));
			await click(obsidian, ui.episode("Ended Seek"));
			await waitForPlayback(
				obsidian,
				(state) => state.playing && state.seconds > 0,
				"playing",
			);
			await obsidian.dev.evalJson("app.plugins.plugins.podnotes.api.currentTime = 59, true");
			await plugin.waitForData<PodNotesData>(
				(data) => data.playedEpisodes?.[KEY]?.finished === true,
				WAIT_OPTS,
			);
			await waitForPlayback(
				obsidian,
				(state) => !state.playing && state.seconds >= 59,
				"ended",
			);
			if (delivered) {
				await obsidian.dev.evalJsonAsync(`(async () => {
				const media = document.querySelector(".podnotes-media");
				const seeked = new Promise(resolve => media.addEventListener("seeked", resolve, {once: true}));
				media.currentTime = 12;
				await seeked;
				return true;
			})()`);
			}
			const result = await obsidian.dev.evalJson<{
				before: number;
				seek: number;
				after: number;
			}>(`(() => {
			const plugin = app.plugins.plugins.podnotes;
			const media = document.querySelector(".podnotes-media");
			const before = media.currentTime;
			media.currentTime = 12;
			const seek = media.currentTime;
			if (${jsLiteral(path)} === "player button") {
				document.querySelector(".pn-player button.pn-play").click();
			} else {
				plugin.player.play(plugin.api.podcast);
			}
			return { before, seek, after: media.currentTime };
		})()`);
			console.info(`#465 ${path}, events delivered=${delivered}: ${JSON.stringify(result)}`);
			expect(result.before).toBe(delivered ? 12 : 60);
			expect(result.seek).toBe(12);
			expect(result.after).toBe(12);
			const resumed = await waitForPlayback(obsidian, (state) => state.playing, "resumed");
			expect(resumed.seconds).toBeGreaterThanOrEqual(12);
			expect(resumed.seconds).toBeLessThan(15);
			await click(obsidian, ui.playbackToggle);
			await plugin.waitForData<PodNotesData>((data) => {
				const progress = data.playedEpisodes?.[KEY];
				return progress?.finished === false && progress.time >= 12 && progress.time < 15;
			}, WAIT_OPTS);
		});
	}
}
