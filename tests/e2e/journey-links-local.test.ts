import { describe, expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness } from "./harness";
import {
	closePodNotes,
	dismissNotices,
	openInReadingView,
	revealInFileExplorer,
	runCommand,
	showLibrary,
	showList,
	showPodNotes,
} from "./journey/actions";
import { click } from "./journey/input";
import { ui } from "./journey/targets";
import { listedEpisodes, notices, waitUntilShown } from "./journey/wait";
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
	observePlayback,
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
import { jsLiteral, PLUGIN_ID, RELOAD_OPTIONS } from "./runtime";

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

		await showLibrary(obsidian);
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
		await seedLibrary(context, null);
		await obsidian.plugin("file-explorer").enable({ filter: "core" });
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
		await showList(obsidian, "Local files");
		await obsidian.waitFor(async () => (await listedEpisodes(obsidian)).length > 0, {
			timeoutMs: 10_000,
			message: "the Local Files list",
		});
		expect(await listedEpisodes(obsidian)).toEqual(["Local Journey"]);
	});
	test("a queued local file plays from where it was moved to when the queue reaches it", async () => {
		const context = getContext();
		const { obsidian, plugin, sandbox } = context;
		await seedLibrary(context, null);
		await obsidian.plugin("file-explorer").enable({ filter: "core" });
		const queuedPath = sandbox.path("Queued Journey.wav");
		const leadPath = sandbox.path("Lead Journey.wav");
		const movedPath = sandbox.path("Queue moved", "Queued Journey.wav");
		await writeVaultFile(obsidian, queuedPath, wav(30));
		await writeVaultFile(obsidian, leadPath, wav(6));

		for (const [path, title] of [
			[queuedPath, "Queued Journey"],
			[leadPath, "Lead Journey"],
		]) {
			await revealInFileExplorer(obsidian, path);
			await click(obsidian, ui.fileExplorerItem(path), { button: "right" });
			await click(obsidian, ui.menuItem("Play with PodNotes"));
			await waitForPlayback(
				obsidian,
				(playback) =>
					playback.episode?.title === title && (playback.media?.seconds ?? 0) > 0,
				`${title} playing`,
			);
		}
		await waitForLibrary(
			plugin,
			(library) => library.queue.includes("Queued Journey"),
			"the switched-away file queued",
		);

		await obsidian.dev.evalJsonAsync(`(async () => {
			await app.vault.createFolder(${jsLiteral(sandbox.path("Queue moved"))});
			await app.fileManager.renameFile(app.vault.getAbstractFileByPath(${jsLiteral(queuedPath)}), ${jsLiteral(movedPath)});
			return true;
		})()`);

		const next = await waitForPlayback(
			obsidian,
			(playback) =>
				playback.episode?.title === "Queued Journey" && (playback.media?.seconds ?? 0) > 0,
			"the queue advancing to the moved file",
		);
		expect(decodeURIComponent(next.media?.src ?? "")).toContain(movedPath);
		await waitForLibrary(
			plugin,
			(library) =>
				library.localFiles.some(
					(entry) => entry.title === "Queued Journey" && entry.filePath === movedPath,
				),
			"Local Files holding the moved path",
		);
	});

	test("a playing local file keeps its title and plays on from where it was moved to", async () => {
		const context = getContext();
		const { obsidian, sandbox } = context;
		await seedLibrary(context, null);
		await obsidian.plugin("file-explorer").enable({ filter: "core" });
		const audioPath = sandbox.path("Playing Journey.wav");
		const movedPath = sandbox.path("Renamed", "Renamed Journey.wav");
		await writeVaultFile(obsidian, audioPath, wav(30));

		await revealInFileExplorer(obsidian, audioPath);
		await click(obsidian, ui.fileExplorerItem(audioPath), { button: "right" });
		await click(obsidian, ui.menuItem("Play with PodNotes"));
		const before = await waitForPlayback(
			obsidian,
			(playback) =>
				playback.episode?.title === "Playing Journey" &&
				playback.playing &&
				(playback.media?.seconds ?? 0) > 1,
			"the local file playing",
		);

		await obsidian.dev.evalJsonAsync(`(async () => {
			await app.vault.createFolder(${jsLiteral(sandbox.path("Renamed"))});
			await app.fileManager.renameFile(app.vault.getAbstractFileByPath(${jsLiteral(audioPath)}), ${jsLiteral(movedPath)});
			return true;
		})()`);

		const after = await waitForPlayback(
			obsidian,
			(playback) =>
				playback.episode?.title === "Playing Journey" &&
				decodeURIComponent(playback.media?.src ?? "").includes(movedPath) &&
				playback.media?.paused === false,
			"the moved file playing on under its title",
		);
		expect(after.episode).toEqual({ podcast: "local file", title: "Playing Journey" });
		expect(after.media?.seconds).toBeGreaterThanOrEqual(before.media?.seconds ?? Infinity);
	});

	test("a timestamp link to a vault file outside Local Files plays it from the link's time", async () => {
		const context = getContext();
		const { obsidian, plugin, sandbox } = context;
		await seedLibrary(context, null);
		const audioPath = sandbox.path("Unlisted Journey.wav");
		await writeVaultFile(obsidian, audioPath, wav(30));
		const notePath = sandbox.path("Unlisted link.md");
		await writeVaultFile(
			obsidian,
			notePath,
			`[Unlisted audio](obsidian://podnotes?episodeName=Unlisted%20Journey&url=${encodeURIComponent(audioPath)}&time=12)\n`,
		);

		await openInReadingView(obsidian, notePath);
		await click(obsidian, ui.readingLink("Unlisted audio"));
		const playing = await waitForPlayback(
			obsidian,
			(playback) =>
				playback.episode?.title === "Unlisted Journey" &&
				(playback.media?.seconds ?? 0) > 0,
			"the linked file playing",
		);
		expect(playing.episode).toEqual({ podcast: "local file", title: "Unlisted Journey" });
		expect(decodeURIComponent(playing.media?.src ?? "")).toContain(audioPath);
		expect(playing.seconds).toBeGreaterThanOrEqual(12);
		expect(playing.seconds).toBeLessThanOrEqual(15);
		expect((await readLibrary(plugin)).localFiles).toEqual([]);
	});

	test("a timestamp link to a moved vault file plays the one file with its name, and refuses when two share it", async () => {
		const context = getContext();
		const { obsidian, sandbox } = context;
		await seedLibrary(context, null);
		const title = `Twin-${sandbox.root.split("/").pop()}`;
		const fileName = `${title}.wav`;
		const movedPath = sandbox.path("Moved/A", fileName);
		await writeVaultFile(obsidian, movedPath, wav(30));
		const notePath = sandbox.path("Moved link.md");
		const linkedPath = encodeURIComponent(sandbox.path("Missing", fileName));
		await writeVaultFile(
			obsidian,
			notePath,
			`[Moved audio](obsidian://podnotes?episodeName=${encodeURIComponent(title)}&url=${linkedPath}&time=2)\n`,
		);

		await openInReadingView(obsidian, notePath);
		await click(obsidian, ui.readingLink("Moved audio"));
		const playing = await waitForPlayback(
			obsidian,
			(playback) => playback.episode?.title === title && (playback.media?.seconds ?? 0) > 0,
			"the moved file playing",
		);
		expect(decodeURIComponent(playing.media?.src ?? "")).toContain(movedPath);
		expect(playing.seconds).toBeGreaterThanOrEqual(2);

		await runCommand(obsidian, `${PLUGIN_ID}:stop-playing`);
		await writeVaultFile(obsidian, sandbox.path("Moved/B", fileName), wav(30));
		await dismissNotices(obsidian);
		await openInReadingView(obsidian, notePath);
		await click(obsidian, ui.readingLink("Moved audio"));
		await obsidian.waitFor(
			async () =>
				(await notices(obsidian)).includes(
					`More than one vault file is named "${fileName}". Update the link with the correct path.`,
				),
			{ timeoutMs: 10_000, message: "the ambiguous file notice" },
		);
		const refused = await observePlayback(obsidian);
		expect(refused.playing).toBe(false);
		expect(decodeURIComponent(refused.media?.src ?? "")).toContain(movedPath);
	});
});
