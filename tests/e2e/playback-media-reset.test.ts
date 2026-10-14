import { expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness, type PodNotesData } from "./harness";
import { showLibrary, showPodNotes } from "./journey/actions";
import { type FixtureFeed, pubDate, startFixtureServer } from "./journey/fixtures";
import { click } from "./journey/input";
import { seedLibrary, storedEpisode, waitForPlayback } from "./journey/library";
import { ui } from "./journey/targets";
import { jsLiteral, WAIT_OPTS } from "./runtime";

const getContext = createPodNotesE2EHarness("playback-media-reset");
const FEED: FixtureFeed = {
	title: "Media reset",
	slug: "media-reset",
	artwork: true,
	episodes: [
		{ title: "Outgoing", seconds: 60, pubDate: pubDate(0) },
		{ title: "Incoming", seconds: 60, pubDate: pubDate(1) },
	],
};

async function startOutgoing() {
	const context = getContext();
	const server = await startFixtureServer([FEED]);
	onTestFinished(() => server.stop());
	await seedLibrary(context, server, { subscriptions: [FEED] });
	await showPodNotes(context.obsidian);
	await showLibrary(context.obsidian);
	await click(context.obsidian, ui.podcastCard(FEED.title));
	await click(context.obsidian, ui.episode("Outgoing"));
	await waitForPlayback(
		context.obsidian,
		(state) => state.playing && state.seconds > 0,
		"playing",
	);
	return { ...context, incoming: storedEpisode(server, FEED, FEED.episodes[1]) };
}

for (const method of ["resume", "play"]) {
	test(`${method} preserves 12 seconds before a reset element reports emptied`, async () => {
		const { obsidian } = await startOutgoing();
		await obsidian.dev.evalJson(
			"app.plugins.plugins.podnotes.api.stop(), app.plugins.plugins.podnotes.api.currentTime = 12, true",
		);
		await waitForPlayback(
			obsidian,
			(state) => !state.playing && state.seconds === 12,
			"paused at 12",
		);
		const immediate = await obsidian.dev.evalJson<{
			before: number;
			ready: number;
			reset: number;
		}>(`(() => {
			const plugin = app.plugins.plugins.podnotes;
			const media = document.querySelector(".podnotes-media");
			const before = media.currentTime;
			media.load();
			const ready = media.readyState, reset = media.currentTime;
			${method === "resume" ? "plugin.player.resume()" : "plugin.player.play(plugin.api.podcast)"};
			return { before, ready, reset };
		})()`);
		expect(immediate).toEqual({ before: 12, ready: 0, reset: 0 });
		const after = await waitForPlayback(
			obsidian,
			(state) => state.playing && (state.media?.seconds ?? 0) > 0,
			"resumed after reset",
		);
		expect(after.seconds).toBeGreaterThanOrEqual(12);
		expect(after.seconds).toBeLessThan(15);
	});
}

test("switching after a pending native seek saves and queues the ended outgoing episode", async () => {
	const { obsidian, plugin, incoming } = await startOutgoing();
	await obsidian.dev.evalJson("app.plugins.plugins.podnotes.api.currentTime = 59, true");
	await plugin.waitForData<PodNotesData>(
		(data) => data.playedEpisodes?.["Media reset::Outgoing"]?.finished === true,
		WAIT_OPTS,
	);
	await waitForPlayback(obsidian, (state) => !state.playing && state.seconds >= 59, "ended");
	const result = await obsidian.dev.evalJson<{
		before: number;
		seek: number;
		title: string;
	}>(`(() => {
		const plugin = app.plugins.plugins.podnotes;
		const media = document.querySelector(".podnotes-media");
		const before = media.currentTime;
		media.currentTime = 12;
		const seek = media.currentTime;
		plugin.player.play(${jsLiteral(incoming)});
		return { before, seek, title: plugin.api.podcast.title };
	})()`);
	expect(result).toEqual({ before: 60, seek: 12, title: "Incoming" });
	await waitForPlayback(obsidian, (state) => state.playing, "incoming playing");
	await obsidian.dev.evalJsonAsync(
		"(async () => { const p = app.plugins.plugins.podnotes; p.player.pause(); await p.flushSaves(); return true; })()",
	);
	const data = await plugin.data<PodNotesData>().read();
	expect(data.playedEpisodes?.["Media reset::Outgoing"]).toMatchObject({
		time: 12,
		duration: 60,
		finished: false,
	});
	expect(data.queue?.episodes.map((episode) => episode.title)).toContain("Outgoing");
});
