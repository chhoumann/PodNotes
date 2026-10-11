import { describe, expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness, PLUGIN_ID, RELOAD_OPTIONS } from "./harness";
import {
	click,
	closePodNotes,
	listedEpisodes,
	openInReadingView,
	revealInFileExplorer,
	runCommand,
	showPodNotes,
	ui,
	waitUntilShown,
} from "./journey/actions";
import {
	type FixtureEpisode,
	type FixtureFeed,
	type FixtureServer,
	pubDate,
	startFixtureServer,
	wav,
} from "./journey/fixtures";
import {
	episodeRef,
	playbackOver,
	playerLeafCount,
	readLibrary,
	readVaultText,
	seedLibrary,
	storedEpisode,
	waitForLibrary,
	waitForPlayback,
	writeVaultFile,
} from "./journey/library";

const getContext = createPodNotesE2EHarness("journey-links-local");

async function serve(...feeds: FixtureFeed[]): Promise<FixtureServer> {
	const server = await startFixtureServer(feeds);
	onTestFinished(() => server.stop());
	return server;
}

describe("link and local file journeys", () => {
	test("J-NOTE-07 the default note's Resume in PodNotes link resumes the saved position", async () => {
		const context = getContext();
		const { obsidian, plugin, sandbox } = context;
		const noted: FixtureEpisode = { title: "Noted Episode", seconds: 60, pubDate: pubDate(0) };
		const other: FixtureEpisode = { title: "Other Episode", seconds: 60, pubDate: pubDate(1) };
		const done: FixtureEpisode = {
			title: "Finished Episode",
			seconds: 60,
			pubDate: pubDate(2),
		};
		const show: FixtureFeed = {
			title: "Journey Notes",
			slug: "notes",
			artwork: true,
			episodes: [noted, other, done],
		};
		const server = await serve(show);
		await seedLibrary(context, server, {
			subscriptions: [show],
			progress: [
				{
					episode: storedEpisode(server, show, done),
					seconds: 60,
					duration: 60,
					finished: true,
				},
			],
		});
		const feedParam = encodeURIComponent(server.feedUrl(show));

		await showPodNotes(obsidian);
		await click(obsidian, ui.podcastCard("Journey Notes"));
		await click(obsidian, ui.episode("Noted Episode"));
		await waitForPlayback(
			obsidian,
			(playback) =>
				playback.episode?.title === "Noted Episode" &&
				playback.playing &&
				playback.seconds >= 3,
			"Noted Episode played for 3 s",
		);
		await click(obsidian, ui.playbackToggle);
		await waitForPlayback(obsidian, (playback) => !playback.playing, "paused");
		const [, paused] = await playbackOver(obsidian, 500);

		await runCommand(obsidian, `${PLUGIN_ID}:create-podcast-note`);
		const notePath = sandbox.path("PodNotes/Journey Notes/Noted Episode.md");
		await sandbox.waitForExists("PodNotes/Journey Notes/Noted Episode.md", {
			timeoutMs: 10_000,
		});
		const note = await readVaultText(obsidian, notePath);
		expect(note).toMatch(/^---\ntype: podcastEpisode\n/);
		expect(note).toContain("\n# Noted Episode\n");
		expect(note).toContain(
			`\n[Resume in PodNotes](obsidian://podnotes?episodeName=Noted%20Episode&url=${feedParam})\n`,
		);

		await click(obsidian, ui.podcastGridTab);
		await click(obsidian, ui.podcastCard("Journey Notes"));
		await click(obsidian, ui.episode("Other Episode"));
		await waitForPlayback(
			obsidian,
			(playback) => playback.episode?.title === "Other Episode" && playback.playing,
			"switched to Other Episode",
		);
		await waitForLibrary(
			plugin,
			(library) =>
				Math.abs(
					(library.progress(episodeRef(show, noted))?.seconds ?? -1) - paused.seconds,
				) < 0.25,
			"Noted Episode's position saved on the switch",
		);

		await openInReadingView(obsidian, notePath);
		await click(obsidian, ui.readingLink("Resume in PodNotes"));
		const resumed = await waitForPlayback(
			obsidian,
			(playback) =>
				playback.episode?.title === "Noted Episode" && (playback.media?.seconds ?? 0) > 0,
			"the Resume link reopens Noted Episode",
		);
		expect(resumed.seconds).toBeGreaterThanOrEqual(paused.seconds - 0.5);
		expect(resumed.seconds).toBeLessThanOrEqual(paused.seconds + 3);
		expect(resumed.playing).toBe(true);

		const finishedNote = sandbox.path("Finished episode.md");
		await writeVaultFile(
			obsidian,
			finishedNote,
			`[Resume in PodNotes](obsidian://podnotes?episodeName=Finished+Episode&url=${feedParam})\n`,
		);
		await openInReadingView(obsidian, finishedNote);
		await click(obsidian, ui.readingLink("Resume in PodNotes"));
		const restarted = await waitForPlayback(
			obsidian,
			(playback) =>
				playback.episode?.title === "Finished Episode" &&
				playback.playing &&
				playback.media?.paused === false,
			"the Resume link reopens Finished Episode",
		);
		expect(restarted.seconds).toBeLessThan(3);
	}, 60_000);

	test("J-URI-03 a timestamp link to a podcast that was never loaded fetches it and plays from that time", async () => {
		const context = getContext();
		const { obsidian, sandbox } = context;
		const linked: FixtureEpisode = {
			title: "Linked Episode",
			seconds: 60,
			pubDate: pubDate(0),
		};
		const current: FixtureEpisode = {
			title: "Current Episode",
			seconds: 60,
			pubDate: pubDate(0),
		};
		const linkedShow: FixtureFeed = {
			title: "Journey Links",
			slug: "links",
			artwork: true,
			episodes: [linked],
		};
		const currentShow: FixtureFeed = {
			title: "Journey Current",
			slug: "current",
			artwork: true,
			episodes: [current],
		};
		const server = await serve(linkedShow, currentShow);
		await seedLibrary(context, server, {
			subscriptions: [currentShow],
			current: storedEpisode(server, currentShow, current),
		});
		const notePath = sandbox.path("Timestamp link.md");
		await writeVaultFile(
			obsidian,
			notePath,
			`- [00:00:37](obsidian://podnotes?episodeName=Linked%20Episode&url=${encodeURIComponent(server.feedUrl(linkedShow))}&time=37) the part worth hearing\n`,
		);
		expect(server.requests()).not.toContain("/links/feed.xml");

		await openInReadingView(obsidian, notePath);
		await click(obsidian, ui.readingLink("00:00:37"));
		const playing = await waitForPlayback(
			obsidian,
			(playback) =>
				playback.episode?.title === "Linked Episode" && (playback.media?.seconds ?? 0) > 0,
			"the linked episode loads",
		);
		expect(playing.episode).toEqual({ podcast: "Journey Links", title: "Linked Episode" });
		expect(playing.seconds).toBeGreaterThanOrEqual(37);
		expect(playing.seconds).toBeLessThanOrEqual(40);
		expect(playing.media?.src).toBe(server.mediaUrl(linkedShow, linked));
		expect(server.requests()).toContain("/links/feed.xml");
		await waitForPlayback(
			obsidian,
			(playback) => playback.playing && playback.seconds > playing.seconds + 0.5,
			"the linked episode plays on",
		);
	});

	test("J-LOCAL-01 Play with PodNotes on a vault audio file opens the player and keeps the file in Local Files", async () => {
		const context = getContext();
		const { obsidian, plugin, sandbox } = context;
		const explorerWasEnabled = await obsidian.dev.evalJson<boolean>(
			`app.internalPlugins.getPluginById("file-explorer")?.enabled === true`,
		);
		if (!explorerWasEnabled) {
			await obsidian.plugin("file-explorer").enable({ filter: "core" });
			onTestFinished(() => obsidian.plugin("file-explorer").disable({ filter: "core" }));
		}
		await seedLibrary(context, null);
		const audioPath = sandbox.path("Local Journey.wav");
		await writeVaultFile(obsidian, audioPath, wav(30));
		await closePodNotes(obsidian);
		expect(await playerLeafCount(obsidian)).toBe(0);

		await revealInFileExplorer(obsidian, audioPath);
		await click(obsidian, ui.fileExplorerItem(audioPath), { button: "right" });
		await click(obsidian, ui.menuItem("Play with PodNotes"));

		await waitUntilShown(obsidian, ui.podcastViewport);
		expect(await playerLeafCount(obsidian)).toBe(1);
		const started = await waitForPlayback(
			obsidian,
			(playback) =>
				playback.episode?.title === "Local Journey" &&
				playback.playing &&
				playback.seconds > 0,
			"the local file playing",
		);
		expect(started.episode).toEqual({ podcast: "local file", title: "Local Journey" });
		await waitForPlayback(
			obsidian,
			(playback) => playback.seconds > started.seconds + 1,
			"the local file's media advancing",
		);

		const registered = { title: "Local Journey", filePath: audioPath };
		await waitForLibrary(
			plugin,
			(library) => library.localFiles.some((entry) => entry.filePath === audioPath),
			"the local file registered",
		);
		await plugin.reload(RELOAD_OPTIONS);
		expect((await readLibrary(plugin)).localFiles).toEqual([registered]);
		await showPodNotes(obsidian);
		await click(obsidian, ui.podcastGridTab);
		await click(obsidian, ui.playlistCard("Local Files"));
		await obsidian.waitFor(async () => (await listedEpisodes(obsidian)).length > 0, {
			timeoutMs: 10_000,
			message: "the Local Files list",
		});
		expect(await listedEpisodes(obsidian)).toEqual(["Local Journey"]);
	});
});
