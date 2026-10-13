import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness } from "./harness";
import {
	click,
	closePodNotes,
	closeSettings,
	isShown,
	listedEpisodes,
	notices,
	openPodNotesSettings,
	reloadObsidian,
	restartObsidian,
	runCommand,
	setMobileEmulation,
	shownText,
	showPodNotes,
	typeInto,
	ui,
} from "./journey/actions";
import {
	deepgramRequests,
	type FixtureEpisode,
	type FixtureFeed,
	type FixtureServer,
	installDeepgramTripwire,
	installOpenAIStub,
	pubDate,
	removeDeepgramTripwire,
	removeOpenAIStub,
	startFixtureServer,
	transcriptionUploads,
} from "./journey/fixtures";
import {
	clearFeedCache,
	playerLeafCount,
	readVaultBytes,
	readVaultText,
	seedLibrary,
	storedEpisode,
	waitForLibrary,
	waitForPlayback,
} from "./journey/library";
import { PLUGIN_ID } from "./runtime";

const getContext = createPodNotesE2EHarness("journey-resilience");
const isolatedInstance = Boolean(process.env.OBSIDIAN_E2E_OBSIDIAN_HOME);

function keyPaths(value: unknown, prefix = ""): string[] {
	if (typeof value !== "object" || value === null) return [];
	return Object.entries(value).flatMap(([key, child]) => {
		const keyPath = Array.isArray(value) ? `${prefix}[]` : `${prefix}.${key}`;
		return [keyPath, ...keyPaths(child, keyPath)];
	});
}

async function serve(...feeds: FixtureFeed[]): Promise<FixtureServer> {
	const server = await startFixtureServer(feeds);
	onTestFinished(() => server.stop());
	return server;
}

describe("resilience journeys", () => {
	test("J-EDGE-12: a data.json replaced by sync keeps both the remote and the local change (#357)", async () => {
		const context = getContext();
		const { obsidian, plugin } = context;
		const local: FixtureFeed = {
			title: "Journey Local Feed",
			slug: "local",
			artwork: true,
			episodes: [],
		};
		const remote: FixtureFeed = {
			title: "Journey Remote Feed",
			slug: "remote",
			artwork: true,
			episodes: [],
		};
		const server = await serve(local, remote);
		await seedLibrary(context, server, { subscriptions: [local] });
		await obsidian.dev.evalJson(`(() => {
			window.__podnotesJourneyRaw = { seen: [], ref: app.vault.on("raw", (path) => window.__podnotesJourneyRaw.seen.push(path)) };
			return true;
		})()`);
		onTestFinished(() =>
			obsidian.dev.evalJson(
				"window.__podnotesJourneyRaw && app.vault.offref(window.__podnotesJourneyRaw.ref), delete window.__podnotesJourneyRaw, true",
			),
		);
		onTestFinished(() => closeSettings(obsidian));

		const dataPath = await plugin.dataPath();
		const synced = JSON.parse(await fs.readFile(dataPath, "utf8"));
		synced.savedFeeds["Journey Remote Feed"] = {
			title: "Journey Remote Feed",
			url: server.feedUrl(remote),
			artworkUrl: server.artworkUrl(remote),
		};
		const staged = path.join(path.dirname(dataPath), ".data.json.sync");
		await fs.writeFile(staged, JSON.stringify(synced, null, 2));
		await fs.rename(staged, dataPath);
		await obsidian.waitFor(
			() =>
				obsidian.dev.evalJson<boolean>(
					`window.__podnotesJourneyRaw.seen.some((path) => path.endsWith("plugins/${PLUGIN_ID}/data.json"))`,
				),
			{
				timeoutMs: 10_000,
				intervalMs: 100,
				message: "Obsidian to notice the replaced data.json",
			},
		);
		await obsidian.waitFor(
			() =>
				obsidian.dev.evalJson<boolean>(
					`Boolean(app.plugins.plugins.${PLUGIN_ID}.settings.savedFeeds["Journey Remote Feed"])`,
				),
			{ timeoutMs: 10_000, message: "the remote feed to reach the live settings" },
		);

		await openPodNotesSettings(obsidian);
		await typeInto(obsidian, ui.settingControl("Skip backward length (s)", "input"), "42", {
			replace: true,
		});
		const saved = await waitForLibrary(
			plugin,
			(library) => library.skipBackwardSeconds === 42,
			"the local setting change saved",
		);
		expect(saved.subscriptions.map((entry) => entry.title).sort()).toEqual([
			"Journey Local Feed",
			"Journey Remote Feed",
		]);
	});

	test.runIf(isolatedInstance)(
		"J-EDGE-03 offline after a restart: cached episodes browse, the downloaded episode plays, an unloaded podcast fails cleanly",
		async () => {
			const context = getContext();
			const { obsidian, plugin } = context;
			const keeper: FixtureEpisode = {
				title: "Offline Keeper",
				seconds: 20,
				pubDate: pubDate(0),
			};
			const extra: FixtureEpisode = {
				title: "Offline Extra",
				seconds: 20,
				pubDate: pubDate(1),
			};
			const show: FixtureFeed = {
				title: "Journey Offline",
				slug: "offline",
				artwork: true,
				episodes: [keeper, extra],
			};
			const server = await serve(show);
			await seedLibrary(context, server, { subscriptions: [show] });

			await showPodNotes(obsidian);
			await click(obsidian, ui.podcastCard("Journey Offline"));
			await obsidian.waitFor(async () => (await listedEpisodes(obsidian)).length === 2, {
				timeoutMs: 15_000,
				message: "the podcast's episodes while online",
			});
			await click(obsidian, ui.episode("Offline Keeper"), { button: "right" });
			await click(obsidian, ui.menuItem("Download"));
			const downloaded = (
				await waitForLibrary(
					plugin,
					(library) =>
						library.downloads.some((entry) => entry.title === "Offline Keeper"),
					"the download registered",
				)
			).downloads.find((entry) => entry.title === "Offline Keeper");
			expect(downloaded?.podcast).toBe("Journey Offline");
			expect(
				(await readVaultBytes(obsidian, downloaded?.filePath ?? "")).equals(
					server.audio(show, keeper),
				),
			).toBe(true);

			const loopbackFeed = new URL(server.feedUrl(show));
			loopbackFeed.hostname = "127.0.0.1";
			expect((await fetch(loopbackFeed)).status).toBe(200);
			await server.stop();
			await expect(fetch(loopbackFeed)).rejects.toThrow();

			await restartObsidian(obsidian, async () => {
				await plugin.data<Record<string, any>>().patch((data) => {
					data.savedFeeds["Journey Never Loaded"] = {
						title: "Journey Never Loaded",
						url: server.feedUrl({ ...show, slug: "never-loaded" }),
						artworkUrl: server.artworkUrl(show),
					};
				});
			});

			await showPodNotes(obsidian);
			await click(obsidian, ui.podcastCard("Journey Offline"));
			await obsidian.waitFor(
				async () =>
					(await listedEpisodes(obsidian)).includes("Offline Keeper") &&
					!(await isShown(obsidian, ui.feedLoading)) &&
					!(await isShown(obsidian, ui.episodeLoading)),
				{
					timeoutMs: 15_000,
					message: "the downloaded episode listed offline after loading settles",
				},
			);
			await click(obsidian, ui.backToLatestEpisodes);
			await obsidian.waitFor(
				async () =>
					(await listedEpisodes(obsidian)).length === 2 &&
					!(await isShown(obsidian, ui.backToLatestEpisodes)) &&
					!(await isShown(obsidian, ui.feedLoading)) &&
					!(await isShown(obsidian, ui.episodeLoading)),
				{
					timeoutMs: 15_000,
					message: "cached Latest Episodes offline after loading settles",
				},
			);
			expect(await listedEpisodes(obsidian)).toEqual(["Offline Keeper", "Offline Extra"]);

			await click(obsidian, ui.episode("Offline Keeper"));
			const playing = await waitForPlayback(
				obsidian,
				(playback) =>
					playback.episode?.title === "Offline Keeper" &&
					playback.playing &&
					playback.seconds > 0,
				"the downloaded episode playing offline",
			);
			expect(playing.media?.src.startsWith("http")).toBe(false);
			await waitForPlayback(
				obsidian,
				(playback) => playback.seconds > playing.seconds + 1,
				"the downloaded episode's media advancing",
			);

			await click(obsidian, ui.podcastGridTab);
			await click(obsidian, ui.podcastCard("Journey Never Loaded"));
			await obsidian.waitFor(
				async () =>
					(await notices(obsidian)).includes(
						"Could not load episodes for Journey Never Loaded. Check your connection and try again.",
					),
				{ timeoutMs: 15_000, message: "the offline failure notice" },
			);
			expect(await isShown(obsidian, ui.episodeLoading)).toBe(false);
			expect(await shownText(obsidian)).toContain("No episodes found.");
		},
		120_000,
	);

	test("J-TR-02 transcribing the current episode writes its transcript note from the real audio", async () => {
		const context = getContext();
		const { obsidian, sandbox } = context;
		const spoken: FixtureEpisode = { title: "Spoken Episode", seconds: 4, pubDate: pubDate(0) };
		const show: FixtureFeed = {
			title: "Journey Transcribe",
			slug: "transcribe",
			artwork: true,
			episodes: [spoken],
		};
		const server = await serve(show);
		const secretId = "podnotes-openai-api-key-424242";
		const previousSecret = await obsidian.dev.evalJson<string | null>(
			`app.secretStorage.getSecret(${JSON.stringify(secretId)})`,
		);
		onTestFinished(() =>
			obsidian.dev.evalJson(
				previousSecret === null
					? `app.secretStorage.deleteSecret(${JSON.stringify(secretId)}), true`
					: `app.secretStorage.setSecret(${JSON.stringify(secretId)}, ${JSON.stringify(previousSecret)}), true`,
			),
		);
		await obsidian.dev.evalJson(
			`app.secretStorage.setSecret(${JSON.stringify(secretId)}, "sk-journey-test"), true`,
		);
		await seedLibrary(context, server, {
			subscriptions: [show],
			current: storedEpisode(server, show, spoken),
			openAISecretId: secretId,
		});
		await installOpenAIStub(
			obsidian,
			"Journey transcript opens here. It closes with a second sentence.",
		);
		onTestFinished(() => removeOpenAIStub(obsidian));

		await runCommand(obsidian, `${PLUGIN_ID}:podnotes-transcribe`);
		await sandbox.waitForExists("Transcripts/Journey Transcribe/Spoken Episode.md", {
			timeoutMs: 30_000,
		});
		const transcript = await readVaultText(
			obsidian,
			sandbox.path("Transcripts/Journey Transcribe/Spoken Episode.md"),
		);
		expect(transcript).toMatch(
			/^# Spoken Episode\n\nPodcast: Journey Transcribe\nDate: .+\n\nJourney transcript opens here\.\n\nIt closes with a second sentence\.$/,
		);

		const uploads = await transcriptionUploads(obsidian);
		expect(uploads).toHaveLength(1);
		expect(uploads[0]).toMatchObject({
			method: "POST",
			authorization: "Bearer sk-journey-test",
			model: "whisper-1",
			fileBytes: server.audio(show, spoken).length,
			riffWave: true,
			sha256: createHash("sha256").update(server.audio(show, spoken)).digest("hex"),
		});
		expect(server.requests()).toContain("/transcribe/1.wav");
		expect(
			await obsidian.dev.evalJsonAsync<string | null>(
				`app.plugins.plugins.${PLUGIN_ID}.api.transcript`,
			),
		).toBe(transcript);
	}, 60_000);

	test("J-TR-03 transcribing an episode whose feed publishes a transcript needs no API key and no audio", async () => {
		const context = getContext();
		const { obsidian, plugin, sandbox } = context;
		const podnewsVtt = await fs.readFile(
			path.resolve("tests/fixtures/transcripts/podnews-2026-10-05.vtt"),
			"utf8",
		);
		const captioned: FixtureEpisode = {
			title: "Captioned Episode",
			seconds: 4,
			pubDate: pubDate(0),
			transcripts: [
				{ path: "1.html", type: "text/html", absolute: true, body: "<p>Not this one.</p>" },
				{ path: "1.vtt", type: "text/vtt", body: podnewsVtt },
			],
		};
		const show: FixtureFeed = {
			title: "Journey Captions",
			slug: "captions",
			artwork: true,
			episodes: [captioned],
		};
		const server = await serve(show);
		await seedLibrary(context, server, {
			subscriptions: [show],
			current: storedEpisode(server, show, captioned),
		});
		await setMobileEmulation(obsidian, true);
		await closePodNotes(obsidian);
		await clearFeedCache(obsidian);
		await obsidian.dev.evalJsonAsync(
			"(async () => { await app.workspace.saveLayout(); return true; })()",
		);
		await reloadObsidian(obsidian);
		expect(await playerLeafCount(obsidian)).toBe(0);
		await installOpenAIStub(obsidian, "OpenAI must not be called.");
		onTestFinished(() => removeOpenAIStub(obsidian));
		await installDeepgramTripwire(obsidian);
		onTestFinished(() => removeDeepgramTripwire(obsidian));
		const savedBefore = await plugin.data<Record<string, unknown>>().read();
		const requestsBefore = server.requests().length;

		await runCommand(obsidian, `${PLUGIN_ID}:podnotes-transcribe`);
		await sandbox.waitForExists("Transcripts/Journey Captions/Captioned Episode.md", {
			timeoutMs: 30_000,
		});
		await obsidian.waitFor(
			async () =>
				(await notices(obsidian)).some((notice) =>
					notice.endsWith("Saved the transcript the feed publishes."),
				),
			{ timeoutMs: 10_000, intervalMs: 100, message: "the published transcript notice" },
		);

		const transcript = await readVaultText(
			obsidian,
			sandbox.path("Transcripts/Journey Captions/Captioned Episode.md"),
		);
		const link = `obsidian://podnotes?episodeName=Captioned%20Episode&url=${encodeURIComponent(server.feedUrl(show))}&time=0.48`;
		expect(transcript.replace(/^Date: .+$/m, "Date: <date>")).toBe(
			"# Captioned Episode\n\nPodcast: Journey Captions\nDate: <date>\n\n" +
				`[00:00:00](${link}) From Potsdam in Brandenburg, Germany, the latest from podnews.net with Soundstack. The audio fiction podcast network Fable & Folly is to close at the end of the year. The network blames a change in podcast advertising for its closure, but the network says that the shows you love aren't going away, they're just headed to new homes. Through the end of the year, the company is helping producers migrate their shows and connect with new hosting and advertising partners. After we revealed that Apple Podcasts has dropped country-specific`,
		);
		expect(
			await obsidian.dev.evalJsonAsync<string | null>(
				`app.plugins.plugins.${PLUGIN_ID}.api.transcript`,
			),
		).toBe(transcript);
		const requests = server.requests().slice(requestsBefore);
		expect(requests).toContain("/captions/feed.xml");
		expect(requests.indexOf("/captions/1.vtt")).toBeGreaterThan(
			requests.indexOf("/captions/feed.xml"),
		);
		expect(server.requests()).not.toContain("/captions/1.html");
		expect(server.requests().filter((request) => request.endsWith(".wav"))).toEqual([]);
		expect(await transcriptionUploads(obsidian)).toEqual([]);
		expect(await deepgramRequests(obsidian)).toEqual([]);
		const savedPaths = new Set(keyPaths(savedBefore));
		expect(
			keyPaths(await plugin.data<Record<string, unknown>>().read()).filter(
				(keyPath) => !savedPaths.has(keyPath),
			),
		).toEqual([]);
	}, 120_000);

	test("J-TR-04 a published transcript that fails offers the paid transcription, which runs only on request", async () => {
		const context = getContext();
		const { obsidian, sandbox } = context;
		const spoken: FixtureEpisode = {
			title: "Spoken Episode",
			seconds: 4,
			pubDate: pubDate(0),
			transcripts: [{ path: "1.vtt", type: "text/vtt" }],
		};
		const show: FixtureFeed = {
			title: "Journey Missing Captions",
			slug: "missing-captions",
			artwork: true,
			episodes: [spoken],
		};
		const server = await serve(show);
		const secretId = "podnotes-openai-api-key-434343";
		const previousSecret = await obsidian.dev.evalJson<string | null>(
			`app.secretStorage.getSecret(${JSON.stringify(secretId)})`,
		);
		onTestFinished(() =>
			obsidian.dev.evalJson(
				previousSecret === null
					? `app.secretStorage.deleteSecret(${JSON.stringify(secretId)}), true`
					: `app.secretStorage.setSecret(${JSON.stringify(secretId)}, ${JSON.stringify(previousSecret)}), true`,
			),
		);
		await obsidian.dev.evalJson(
			`app.secretStorage.setSecret(${JSON.stringify(secretId)}, "sk-journey-test"), true`,
		);
		await seedLibrary(context, server, {
			subscriptions: [show],
			current: storedEpisode(server, show, spoken),
			openAISecretId: secretId,
		});
		await installOpenAIStub(obsidian, "Paid transcript opens here. It closes here.");
		onTestFinished(() => removeOpenAIStub(obsidian));
		const notePath = "Transcripts/Journey Missing Captions/Spoken Episode.md";

		await runCommand(obsidian, `${PLUGIN_ID}:podnotes-transcribe`);
		await obsidian.waitFor(
			async () =>
				(await notices(obsidian)).some((notice) =>
					notice.endsWith(
						'The published transcript could not be fetched: Network response returned HTTP 404. Run "Transcribe current episode from audio" to transcribe it with OpenAI instead, which uses your API credit.',
					),
				),
			{
				timeoutMs: 30_000,
				intervalMs: 100,
				message: "the failed published transcript notice",
			},
		);

		expect(server.requests()).toContain("/missing-captions/1.vtt");
		expect(server.requests().filter((request) => request.endsWith(".wav"))).toEqual([]);
		expect(await transcriptionUploads(obsidian)).toEqual([]);
		expect(await sandbox.exists(notePath)).toBe(false);

		await runCommand(obsidian, `${PLUGIN_ID}:podnotes-transcribe-audio`);
		await sandbox.waitForExists(notePath, { timeoutMs: 30_000 });

		expect(await readVaultText(obsidian, sandbox.path(notePath))).toMatch(
			/^# Spoken Episode\n\nPodcast: Journey Missing Captions\nDate: .+\n\nPaid transcript opens here\.\n\nIt closes here\.$/,
		);
		const uploads = await transcriptionUploads(obsidian);
		expect(uploads).toHaveLength(1);
		expect(uploads[0]).toMatchObject({
			authorization: "Bearer sk-journey-test",
			sha256: createHash("sha256").update(server.audio(show, spoken)).digest("hex"),
		});
		expect(server.requests()).toContain("/missing-captions/1.wav");
		expect(server.requests().filter((request) => request.endsWith(".vtt"))).toHaveLength(1);
	}, 60_000);

	test("J-TR-05 feed text cannot give the transcript note a block ID or an inline field", async () => {
		const context = getContext();
		const { obsidian, sandbox } = context;
		const marked: FixtureEpisode = {
			title: "Marked Episode",
			seconds: 4,
			pubDate: pubDate(0),
			transcripts: [
				{
					path: "1.txt",
					type: "text/plain",
					body: "Normal text with a block marker ^v420-block\n\nv420-field:: injected value\n",
				},
			],
		};
		const show: FixtureFeed = {
			title: "Journey Marked Captions",
			slug: "marked-captions",
			artwork: true,
			episodes: [marked],
		};
		const server = await serve(show);
		await seedLibrary(context, server, {
			subscriptions: [show],
			current: storedEpisode(server, show, marked),
		});
		const notePath = sandbox.path("Transcripts/Journey Marked Captions/Marked Episode.md");

		await runCommand(obsidian, `${PLUGIN_ID}:podnotes-transcribe`);
		await sandbox.waitForExists("Transcripts/Journey Marked Captions/Marked Episode.md", {
			timeoutMs: 30_000,
		});
		const note = await obsidian.dev.evalJsonAsync<{
			blocks: string[];
			lines: string[];
			reading: string;
		}>(`(async () => {
			const file = app.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
			const deadline = Date.now() + 10000;
			while (!app.metadataCache.getFileCache(file)?.sections && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			const leaf = app.workspace.getLeaf(true);
			await leaf.openFile(file, { state: { mode: "preview" } });
			const view = () => leaf.view.containerEl.querySelector(".markdown-preview-view");
			while (!view()?.textContent.includes("injected value") && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			const reading = view()?.textContent ?? "";
			leaf.detach();
			return {
				blocks: Object.keys(app.metadataCache.getFileCache(file)?.blocks ?? {}),
				lines: (await app.vault.read(file)).split("\\n").slice(-3),
				reading,
			};
		})()`);

		expect(note.blocks).toEqual([]);
		expect(note.lines).toEqual([
			"Normal text with a block marker \\^v420-block",
			"",
			"v420-field:\\: injected value",
		]);
		expect(note.reading).toContain("Normal text with a block marker ^v420-block");
		expect(note.reading).toContain("v420-field:: injected value");
	}, 60_000);

	test("J-TR-06 a hostile cue cannot freeze its transcript note in Live Preview, also when Obsidian reopens it", async () => {
		const context = getContext();
		const { obsidian, sandbox } = context;
		const hostile: FixtureEpisode = {
			title: "Hostile Episode",
			seconds: 4,
			pubDate: pubDate(0),
			transcripts: [
				{
					path: "1.vtt",
					type: "text/vtt",
					body: `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${"|".repeat(3_000)} ${"<".repeat(6_000)} survived\n`,
				},
			],
		};
		const show: FixtureFeed = {
			title: "Journey Hostile Captions",
			slug: "hostile-captions",
			artwork: true,
			episodes: [hostile],
		};
		const server = await serve(show);
		await seedLibrary(context, server, {
			subscriptions: [show],
			current: storedEpisode(server, show, hostile),
		});
		const notePath = sandbox.path("Transcripts/Journey Hostile Captions/Hostile Episode.md");
		await obsidian.dev.evalJson(`(() => {
			const beat = { last: performance.now(), max: 0 };
			beat.timer = setInterval(() => {
				const now = performance.now();
				beat.max = Math.max(beat.max, now - beat.last);
				beat.last = now;
			}, 10);
			window.__podnotesJourneyBeat = beat;
			return true;
		})()`);
		onTestFinished(() =>
			obsidian.dev.evalJson(
				"clearInterval(window.__podnotesJourneyBeat?.timer), delete window.__podnotesJourneyBeat",
			),
		);

		await runCommand(obsidian, `${PLUGIN_ID}:podnotes-transcribe`);
		await sandbox.waitForExists("Transcripts/Journey Hostile Captions/Hostile Episode.md", {
			timeoutMs: 30_000,
		});
		const opened = await obsidian.dev.evalJsonAsync<{
			state: unknown;
			stallMs: number;
			text: string;
		}>(
			`(async () => {
				const shows = (leaf) => leaf.view.file?.path === ${JSON.stringify(notePath)};
				const deadline = Date.now() + 30000;
				while (!app.workspace.getLeavesOfType("markdown").some(shows) && Date.now() < deadline) {
					await new Promise((resolve) => setTimeout(resolve, 50));
				}
				await new Promise((resolve) => setTimeout(resolve, 1500));
				const beat = window.__podnotesJourneyBeat;
				clearInterval(beat.timer);
				const leaf = app.workspace.getLeavesOfType("markdown").find(shows);
				app.workspace.setActiveLeaf(leaf, { focus: true });
				await app.workspace.saveLayout();
				return {
					state: leaf.view.getState(),
					stallMs: beat.max,
					text: await app.vault.read(leaf.view.file),
				};
			})()`,
			{ timeoutMs: 120_000 },
		);
		const lines = opened.text.trimEnd().split("\n");

		expect(Math.max(...lines.map((line) => line.length))).toBeLessThan(4_300);
		expect(opened.text.split("\\|").length - 1).toBe(3_000);
		expect(opened.text.split("\\<").length - 1).toBe(6_000);
		expect(lines.at(-1)).toMatch(/\) survived$/);
		expect(opened.state).toMatchObject({ mode: "source", source: false });
		expect(opened.stallMs).toBeLessThan(5_000);

		await reloadObsidian(obsidian);
		const reopened = await obsidian.dev.evalJsonAsync<{
			file?: string;
			state: unknown;
			longestTaskMs: number;
		}>(`(async () => {
			const tasks = await new Promise((resolve) => {
				const observer = new PerformanceObserver((list) => {
					observer.disconnect();
					resolve(list.getEntries());
				});
				observer.observe({ type: "longtask", buffered: true });
				setTimeout(() => resolve([]), 500);
			});
			const view = app.workspace.activeLeaf?.view;
			return {
				file: view?.file?.path,
				state: view?.getState?.(),
				longestTaskMs: Math.max(0, ...tasks.map((task) => task.duration)),
			};
		})()`);

		expect(reopened.file).toBe(notePath);
		expect(reopened.state).toMatchObject({ mode: "source", source: false });
		expect(reopened.longestTaskMs).toBeLessThan(5_000);
	}, 240_000);
});
