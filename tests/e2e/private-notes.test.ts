import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, onTestFinished, test } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/constants";
import { SUPERCAST_FIXTURE_HOST } from "../../scripts/e2e-instance.mjs";
import { createPodNotesE2EHarness } from "./harness";
import {
	closeSettings,
	openInReadingView,
	openPodNotesSettings,
	runCommand,
	showAddPodcast,
	showLibrary,
	showPodNotes,
} from "./journey/actions";
import { click, typeInto } from "./journey/input";
import { ui } from "./journey/targets";
import { type FixtureFeed, startFixtureServer } from "./journey/fixtures";
import {
	feedCacheText,
	readVaultText,
	seedLibrary,
	waitForLibrary,
	waitForPlayback,
	writeVaultFile,
} from "./journey/library";
import { jsLiteral, RELOAD_OPTIONS } from "./runtime";

const getContext = createPodNotesE2EHarness("private-notes");
const evidence = path.resolve(".obsidian-e2e-artifacts/private-notes");

test("entity-escaped private descriptions stay out of data.json and the settings export", async () => {
	const context = getContext();
	const { obsidian, plugin, sandbox } = context;
	const episode = { title: "Entity episode", seconds: 60, description: "" };
	const show: FixtureFeed = {
		title: "Entity Private",
		slug: "entity-private",
		host: SUPERCAST_FIXTURE_HOST,
		path: "/feeds/PRIV5_ENTITY_SENTINEL/feed.xml",
		artwork: false,
		episodes: [episode],
	};
	const server = await startFixtureServer([show]);
	onTestFinished(() => server.stop());
	const address = server.feedUrl(show);
	const encoded = address.replaceAll(":", "&#58;").replaceAll("/", "&#x2F;");
	const publicText = "Public https://priv3.supercast.com/public?x=1&amp;y=2.";
	episode.description = `Your feed: ${encoded}. ${publicText}`;
	server.retitle(show, episode, episode.title);
	await seedLibrary(context, server, { noteTemplate: DEFAULT_SETTINGS.note.template });
	await showPodNotes(obsidian);
	await showAddPodcast(obsidian);
	await typeInto(obsidian, ui.podcastSearch, address);
	await click(obsidian, ui.addPodcast(show.title));
	await waitForLibrary(plugin, (library) => library.subscriptions.length === 1, "subscribed");
	const secretId = await obsidian.dev.evalJson<string>(
		'app.plugins.plugins.podnotes.settings.savedFeeds["Entity Private"].urlSecretId',
	);
	onTestFinished(() =>
		obsidian.dev.evalJson(`app.secretStorage.setSecret(${jsLiteral(secretId)}, ""), true`),
	);
	await showLibrary(obsidian);
	await click(obsidian, ui.podcastCard(show.title));
	await click(obsidian, ui.episodeMenu(episode.title));
	await click(obsidian, ui.menuItem("Add to Favorites"));
	await click(obsidian, ui.episode(episode.title));
	await waitForPlayback(obsidian, (state) => state.playing, "playing");
	await click(obsidian, ui.playbackToggle);
	await runCommand(obsidian, "podnotes:create-podcast-note");
	const notePath = `PodNotes/${show.title}/${episode.title}.md`;
	await sandbox.waitForExists(notePath, { timeoutMs: 10_000 });
	await obsidian.dev.evalJsonAsync(
		"(async () => { await app.plugins.plugins.podnotes.flushSaves(); return true; })()",
	);
	const persisted = JSON.stringify(await plugin.data().read());
	await openPodNotesSettings(obsidian);
	const name = "entity-settings.json";
	await typeInto(obsidian, ui.settingControl("Export settings", "input"), sandbox.path(name), {
		replace: true,
	});
	await click(obsidian, ui.settingControl("Export settings", "button"));
	await sandbox.waitForExists(name, { timeoutMs: 10_000 });
	await closeSettings(obsidian);
	const exported = await readVaultText(obsidian, sandbox.path(name));
	const note = await readVaultText(obsidian, sandbox.path(notePath));
	await mkdir(evidence, { recursive: true });
	for (const [name, text] of Object.entries({ persisted, exported, note })) {
		await writeFile(path.join(evidence, `${name}.txt`), text);
		expect.soft(text, name).not.toContain("PRIV5_ENTITY_SENTINEL");
		expect.soft(text, name).toContain("podnotes-private-feed:Entity%20Private");
	}
	expect(persisted).toContain(publicText);
	expect(exported).toContain(publicText);
});

test("private descriptions and aliases stay out of cold and warm-cache episode notes", async () => {
	const context = getContext();
	const { obsidian, plugin, sandbox } = context;
	const episodes = ["Cold episode", "Warm episode"].map((title) => ({
		title,
		seconds: 60,
		description: "",
		guid: title,
	}));
	const show: FixtureFeed = {
		title: "Quoted Private",
		slug: "quoted-private",
		host: SUPERCAST_FIXTURE_HOST,
		path: "/feeds/QUOTED_NOTE_SENTINEL/feed.xml",
		artwork: false,
		episodes,
	};
	const server = await startFixtureServer([show]);
	onTestFinished(() => server.stop());
	const address = server.feedUrl(show);
	const dotted = address.replace(".com:", ".com.:");
	const backslashes = address.replace("http://", "http:\\\\");
	for (const episode of episodes)
		episode.description = `Your feed: ${address}. Aliases: ${dotted}. ${backslashes}.`;
	server.retitle(show, episodes[0], episodes[0].title);
	await seedLibrary(context, server);
	await showPodNotes(obsidian);
	await showAddPodcast(obsidian);
	await typeInto(obsidian, ui.podcastSearch, address);
	await click(obsidian, ui.addPodcast(show.title));
	await waitForLibrary(plugin, (library) => library.subscriptions.length === 1, "subscribed");
	const secretId = await obsidian.dev.evalJson<string>(
		'app.plugins.plugins.podnotes.settings.savedFeeds["Quoted Private"].urlSecretId',
	);
	onTestFinished(() =>
		obsidian.dev.evalJson(`app.secretStorage.setSecret(${jsLiteral(secretId)}, ""), true`),
	);

	let coldFetches = 0;
	for (const [index, episode] of episodes.entries()) {
		if (index) await plugin.reload(RELOAD_OPTIONS);
		await showPodNotes(obsidian);
		await showLibrary(obsidian);
		await click(obsidian, ui.podcastCard(show.title));
		await click(obsidian, ui.episode(episode.title));
		await waitForPlayback(obsidian, (state) => state.playing && state.seconds > 0, "playing");
		await click(obsidian, ui.playbackToggle);
		await runCommand(obsidian, "podnotes:create-podcast-note");
		const notePath = `PodNotes/${show.title}/${episode.title}.md`;
		await sandbox.waitForExists(notePath, { timeoutMs: 10_000 });
		const note = await obsidian.waitFor(
			async () => {
				const text = await readVaultText(obsidian, sandbox.path(notePath));
				return text.includes("# " + episode.title) && text;
			},
			{ timeoutMs: 10_000, intervalMs: 100, message: "note content written" },
		);
		expect(note).toContain("Your feed: podnotes-private-feed:Quoted%20Private.");
		expect(note).toContain('feedUrl: "podnotes-private-feed:Quoted%20Private"');
		expect(note).not.toContain("QUOTED_NOTE_SENTINEL");
		const fetches = server.requests().filter((path) => path === show.path).length;
		if (index) expect(fetches).toBe(coldFetches);
		else coldFetches = fetches;
	}
	expect(Object.keys(JSON.parse(await feedCacheText(obsidian)))).toEqual([
		"podnotes-private-feed:Quoted%20Private",
	]);
});

test("hostname and slash aliases are redacted from persisted templates and the settings export", async () => {
	const context = getContext();
	const { obsidian, plugin, sandbox } = context;
	await seedLibrary(context, null);
	await plugin.updateDataAndReload<Record<string, unknown>>((data) => {
		data.savedFeeds = {
			Private: {
				title: "Private",
				url: "https://private.example.com/rss?auth=EXPORT_ALIAS_SENTINEL",
				artworkUrl: "",
			},
		};
		data.note = {
			path: sandbox.path("{{title}}.md"),
			template: [
				"https://private.example.com./rss?auth=EXPORT_ALIAS_SENTINEL",
				"Quoted https:\\\\private.example.com/rss?auth=EXPORT_ALIAS_SENTINEL.",
				"Quoted https:///%70rivate.example.com/rss?auth=EXPORT_ALIAS_SENTINEL.",
				"https://private.example.com/audio.mp3?token=MEDIA_SIGNATURE",
			].join("\n"),
		};
	}, RELOAD_OPTIONS);
	const secretId = await obsidian.dev.evalJson<string>(
		"app.plugins.plugins.podnotes.settings.savedFeeds.Private.urlSecretId",
	);
	onTestFinished(() =>
		obsidian.dev.evalJson(`app.secretStorage.setSecret(${jsLiteral(secretId)}, ""), true`),
	);
	const persisted = JSON.stringify(await plugin.data().read());
	expect(persisted).not.toContain("EXPORT_ALIAS_SENTINEL");
	expect(persisted).toContain("MEDIA_SIGNATURE");
	await openPodNotesSettings(obsidian);
	const name = "private-settings.json";
	await typeInto(obsidian, ui.settingControl("Export settings", "input"), sandbox.path(name), {
		replace: true,
	});
	await click(obsidian, ui.settingControl("Export settings", "button"));
	await sandbox.waitForExists(name, { timeoutMs: 10_000 });
	await closeSettings(obsidian);
	const exported = await readVaultText(obsidian, sandbox.path(name));
	expect(exported).toContain("podnotes-private-feed:Private");
	expect(exported).toContain("MEDIA_SIGNATURE");
	expect(exported).not.toContain("EXPORT_ALIAS_SENTINEL");
});

test("an unsubscribed private link plays, creates a secret-free note and captures plain timestamps", async () => {
	const context = getContext();
	const { obsidian, sandbox } = context;
	const episode = { title: "Unsubscribed episode", seconds: 60, guid: "unsubscribed-1" };
	const show: FixtureFeed = {
		title: "Unsubscribed Private",
		slug: "unsubscribed-private",
		host: SUPERCAST_FIXTURE_HOST,
		path: "/feeds/UNSUBSCRIBED_NOTE_SENTINEL/feed.xml",
		artwork: false,
		episodes: [episode],
	};
	const server = await startFixtureServer([show]);
	onTestFinished(() => server.stop());
	await seedLibrary(context, server, { noteTemplate: DEFAULT_SETTINGS.note.template });
	const address = server.feedUrl(show);
	const uri = `obsidian://podnotes?episodeName=${encodeURIComponent(episode.title)}&url=${encodeURIComponent(address)}&time=12`;
	const legacyPath = sandbox.path("legacy-link.md");
	await writeVaultFile(obsidian, legacyPath, `[Play private episode](${uri})\n`);
	await openInReadingView(obsidian, legacyPath);
	await click(obsidian, ui.readingLink("Play private episode"));
	await waitForPlayback(obsidian, (state) => state.playing && state.seconds >= 12, "URI playing");
	await runCommand(obsidian, "podnotes:create-podcast-note");
	const notePath = `PodNotes/${show.title}/${episode.title}.md`;
	await sandbox.waitForExists(notePath, { timeoutMs: 10_000 });
	await obsidian.dev.evalJsonAsync(
		'(async () => { await app.workspace.detachLeavesOfType("markdown"); return true; })()',
	);
	await runCommand(obsidian, "podnotes:capture-timestamp");
	await obsidian.waitFor(
		async () => /- 00:00:\d\d/.test(await readVaultText(obsidian, sandbox.path(notePath))),
		{ timeoutMs: 10_000, intervalMs: 100, message: "timestamp written" },
	);
	await runCommand(obsidian, "podnotes:capture-segment-10s");
	await obsidian.waitFor(
		async () =>
			/- 00:00:\d\d-00:00:\d\d/.test(await readVaultText(obsidian, sandbox.path(notePath))),
		{ timeoutMs: 10_000, intervalMs: 100, message: "plain timestamp and segment saved" },
	);
	const note = await readVaultText(obsidian, sandbox.path(notePath));
	await openInReadingView(obsidian, sandbox.path(notePath));
	await mkdir(evidence, { recursive: true });
	await writeFile(path.join(evidence, "unsubscribed-note.md"), note);
	await obsidian.dev.screenshot(path.join(evidence, "unsubscribed-note.png"));
	expect(note).toContain("# Unsubscribed episode");
	expect(note).not.toContain("UNSUBSCRIBED_NOTE_SENTINEL");
	expect(note).not.toContain("obsidian://podnotes");
	expect(note).not.toContain("Resume in PodNotes");
	expect(note).not.toMatch(/^feedUrl:/m);
	expect(
		await obsidian.dev.evalJson<string>("app.plugins.plugins.podnotes.api.podcast.feedUrl"),
	).toBe(address);
	await waitForPlayback(
		obsidian,
		(state) => state.playing && state.seconds > 12,
		"still playing",
	);
});
