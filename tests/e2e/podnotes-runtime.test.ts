import type { PluginHandle, SandboxApi } from "obsidian-e2e";
import { describe, expect, test } from "vitest";
import type DownloadedEpisode from "../../src/types/DownloadedEpisode";
import type { Episode } from "../../src/types/Episode";
import type { IPodNotesSettings } from "../../src/types/IPodNotesSettings";
import type { LocalEpisode } from "../../src/types/LocalEpisode";
import encodePodnotesURI from "../../src/utility/encodePodnotesURI";
import {
	createPodNotesE2EHarness,
	evalJsonAsync,
	openPodNotesView,
	PLUGIN_ID,
	RELOAD_OPTIONS,
	VIEW_TYPE,
	WAIT_OPTS,
	waitForPodNotesReady,
} from "./harness";

type PodNotesData = Partial<IPodNotesSettings> & {
	schemaVersion?: number;
	legacyExtension?: { enabled: boolean };
};

type PlaybackState = {
	currentTime: number | null;
	hasPlayer: boolean;
	isPlaying: boolean;
	title: string | null;
};

const getContext = createPodNotesE2EHarness("podnotes-runtime");

describe("PodNotes runtime", () => {
	test("registers commands, protocol handling, and the player view", async () => {
		const { obsidian } = getContext();

		await openPodNotesView(obsidian);

		const state = await obsidian.dev.evalJson<{
			captureUsesEditorCallback: boolean;
			captureUsesEditorCheckCallback: boolean;
			hasCaptureSegment10Command: boolean;
			hasCaptureSegment20Command: boolean;
			hasProtocolHandler: boolean;
			hasRateCommands: boolean;
			hasShowCommand: boolean;
			viewCount: number;
		}>(`
			(() => ({
				captureUsesEditorCallback:
					typeof app.commands?.commands?.[${JSON.stringify(`${PLUGIN_ID}:capture-timestamp`)}]?.editorCallback === "function",
				captureUsesEditorCheckCallback:
					typeof app.commands?.commands?.[${JSON.stringify(`${PLUGIN_ID}:capture-timestamp`)}]?.editorCheckCallback === "function",
				hasCaptureSegment10Command: Boolean(app.commands?.commands?.[${JSON.stringify(`${PLUGIN_ID}:capture-segment-10s`)}]),
				hasCaptureSegment20Command: Boolean(app.commands?.commands?.[${JSON.stringify(`${PLUGIN_ID}:capture-segment-20s`)}]),
				hasProtocolHandler: (app.workspace.protocolHandlers ?? app.workspace.protocolHandler?.handlers)?.has(${JSON.stringify(PLUGIN_ID)}) ?? false,
				hasRateCommands: [
					${JSON.stringify(`${PLUGIN_ID}:increase-playback-rate`)},
					${JSON.stringify(`${PLUGIN_ID}:decrease-playback-rate`)},
					${JSON.stringify(`${PLUGIN_ID}:reset-playback-rate`)},
				].every((id) => Boolean(app.commands?.commands?.[id])),
				hasShowCommand: Boolean(app.commands?.commands?.[${JSON.stringify(`${PLUGIN_ID}:podnotes-show-leaf`)}]),
				viewCount: app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)}).length,
			}))()
		`);

		expect(state).toMatchObject({
			captureUsesEditorCallback: true,
			captureUsesEditorCheckCallback: false,
			hasCaptureSegment10Command: true,
			hasCaptureSegment20Command: true,
			hasRateCommands: true,
			hasProtocolHandler: true,
			hasShowCommand: true,
		});
		expect(state.viewCount).toBeGreaterThan(0);
		expect(await obsidian.dev.runtimeErrors()).toEqual([]);
	});

	test("opens timestamp URI links at requested progress even after an episode is played", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const audioPath = await seedAudio(sandbox, "finished-episode.mp3");
		const episode = createLocalEpisode("E2E Finished Episode", audioPath);

		await seedRuntimeData(plugin, sandbox, episode, {
			played: { duration: 3600, time: 3600 },
			timestampTemplate: "- {{linktime}}",
		});
		await waitForPodNotesReady(obsidian);
		await openPodNotesView(obsidian);

		await invokePodNotesUri(obsidian, episode, 240);
		await dispatchLoadedMetadata(obsidian);

		const state = await waitForPlaybackState(
			obsidian,
			(value) =>
				value.hasPlayer &&
				value.title === episode.title &&
				value.isPlaying &&
				value.currentTime === 240,
		);

		expect(state).toMatchObject({
			currentTime: 240,
			hasPlayer: true,
			isPlaying: true,
			title: episode.title,
		});
	});

	test("preserves zero-second timestamp URI links at runtime", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const audioPath = await seedAudio(sandbox, "zero-second-episode.mp3");
		const episode = createLocalEpisode("E2E Zero Second Episode", audioPath);

		await seedRuntimeData(plugin, sandbox, episode, {
			played: { duration: 3600, time: 3600 },
			timestampTemplate: "- {{linktime}}",
		});
		await waitForPodNotesReady(obsidian);
		await openPodNotesView(obsidian);

		await invokePodNotesUri(obsidian, episode, 0);
		await dispatchLoadedMetadata(obsidian);

		const state = await waitForPlaybackState(
			obsidian,
			(value) =>
				value.hasPlayer &&
				value.title === episode.title &&
				value.isPlaying &&
				value.currentTime === 0,
		);

		expect(state).toMatchObject({
			currentTime: 0,
			hasPlayer: true,
			isPlaying: true,
			title: episode.title,
		});
	});

	test("seeks immediately when the linked episode is already loaded", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const audioPath = await seedAudio(sandbox, "already-loaded-episode.mp3");
		const episode = createLocalEpisode("E2E Already Loaded Episode", audioPath);

		await seedRuntimeData(plugin, sandbox, episode, {
			currentEpisode: episode,
			timestampTemplate: "- {{linktime}}",
		});
		await waitForPodNotesReady(obsidian);
		await openPodNotesView(obsidian);
		await setPlayback(obsidian, { currentTime: 999, paused: true });

		await invokePodNotesUri(
			obsidian,
			{
				...episode,
				filePath: "https://invalid.invalid/podnotes-e2e.xml",
				streamUrl: "https://invalid.invalid/podnotes-e2e.xml",
				url: "https://invalid.invalid/podnotes-e2e.xml",
			},
			12,
		);
		await dispatchAudioPlay(obsidian);

		const state = await waitForPlaybackState(
			obsidian,
			(value) => value.title === episode.title && value.isPlaying && value.currentTime === 12,
		);

		expect(state).toMatchObject({
			currentTime: 12,
			isPlaying: true,
			title: episode.title,
		});
		expect(await obsidian.dev.notices()).not.toContainEqual(
			expect.objectContaining({ message: "Episode not found" }),
		);
	});

	test("captures a linked timestamp into the active editor", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const audioPath = await seedAudio(sandbox, "capture-episode.mp3");
		const episode = createLocalEpisode("E2E Capture Episode", audioPath);
		const notePath = sandbox.path("capture-target.md");

		await seedRuntimeData(plugin, sandbox, episode, {
			currentEpisode: episode,
			timestampTemplate: "- {{linktime}}",
		});
		await waitForPodNotesReady(obsidian);
		await openMarkdownFile(obsidian, notePath);
		await setPlayback(obsidian, { currentTime: 125, paused: false });

		await obsidian.command(`${PLUGIN_ID}:capture-timestamp`).run();

		const expectedLink = `- ${expectedTimestampLink("00:02:05", episode, 125)}`;
		const content = await sandbox.waitForContent(
			"capture-target.md",
			(value) => value.includes(expectedLink),
			WAIT_OPTS,
		);

		expect(content).toContain(expectedLink);
		expect(content).toContain("obsidian://podnotes");
		expect(content).toContain("episodeName=E2E%20Capture%20Episode");
		expect(content).toContain("time=125");
	});

	test("captures a linked segment into the active editor", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const audioPath = await seedAudio(sandbox, "capture-segment-episode.mp3");
		const episode = createLocalEpisode("E2E Capture Segment Episode", audioPath);
		const notePath = sandbox.path("capture-segment-target.md");

		await seedRuntimeData(plugin, sandbox, episode, {
			currentEpisode: episode,
			timestampTemplate: "- {{linktime}}",
		});
		await waitForPodNotesReady(obsidian);
		await openMarkdownFile(obsidian, notePath);
		await setPlayback(obsidian, { currentTime: 125, paused: false });

		await obsidian.command(`${PLUGIN_ID}:capture-segment-10s`).run();

		const expectedLink = `- ${expectedTimestampLink("00:01:55-00:02:05", episode, 115, 125)}`;
		const content = await sandbox.waitForContent(
			"capture-segment-target.md",
			(value) => value.includes(expectedLink),
			WAIT_OPTS,
		);

		expect(content).toContain(expectedLink);
		expect(content).toContain("time=115");
		expect(content).toContain("endTime=125");

		await obsidian.command(`${PLUGIN_ID}:capture-segment-20s`).run();
		const expected20SecondLink = expectedTimestampLink("00:01:45-00:02:05", episode, 105, 125);
		const contentWithBothSegments = await sandbox.waitForContent(
			"capture-segment-target.md",
			(value) => value.includes(expected20SecondLink),
			WAIT_OPTS,
		);

		expect(contentWithBothSegments).toContain(expected20SecondLink);
	});

	test("stops playback when a segment URI reaches its end", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const audioPath = await seedAudio(sandbox, "segment-uri-episode.mp3");
		const episode = createLocalEpisode("E2E Segment URI Episode", audioPath);

		await seedRuntimeData(plugin, sandbox, episode, {
			timestampTemplate: "- {{linktime}}",
		});
		await waitForPodNotesReady(obsidian);
		await openPodNotesView(obsidian);

		await invokePodNotesUri(obsidian, episode, 115, 125);
		await openPodNotesView(obsidian);
		await dispatchLoadedMetadata(obsidian);

		await waitForPlaybackState(
			obsidian,
			(value) =>
				value.hasPlayer &&
				value.title === episode.title &&
				value.isPlaying &&
				value.currentTime === 115,
		);

		await dispatchAudioTimeUpdate(obsidian, 126);

		const state = await waitForPlaybackState(
			obsidian,
			(value) =>
				value.title === episode.title && !value.isPlaying && value.currentTime === 125,
		);

		expect(state).toMatchObject({
			currentTime: 125,
			isPlaying: false,
			title: episode.title,
		});
	});

	test("playback-rate commands update the live player rate and reset to the configured default", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const audioPath = await seedAudio(sandbox, "rate-command-episode.mp3");
		const episode = createLocalEpisode("E2E Rate Command Episode", audioPath);

		await seedRuntimeData(plugin, sandbox, episode, {
			currentEpisode: episode,
			defaultPlaybackRate: 1.5,
		});
		await waitForPodNotesReady(obsidian);
		await openPodNotesView(obsidian);
		await invokePodNotesUri(obsidian, episode, 0);
		await dispatchLoadedMetadata(obsidian);
		await waitForPlaybackRate(obsidian, 1.5);

		await obsidian.command(`${PLUGIN_ID}:increase-playback-rate`).run();
		await waitForPlaybackRate(obsidian, 1.6);

		await obsidian.command(`${PLUGIN_ID}:decrease-playback-rate`).run();
		await obsidian.command(`${PLUGIN_ID}:decrease-playback-rate`).run();
		await waitForPlaybackRate(obsidian, 1.4);

		await obsidian.command(`${PLUGIN_ID}:reset-playback-rate`).run();
		const rate = await waitForPlaybackRate(obsidian, 1.5);

		expect(rate).toMatchObject({
			api: 1.5,
			audio: 1.5,
		});
	});

	test("previous-track Media Session action captures a timestamp into the active editor", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const audioPath = await seedAudio(sandbox, "headphone-capture-episode.mp3");
		const episode = createLocalEpisode("E2E Headphone Capture Episode", audioPath);
		const notePath = sandbox.path("headphone-capture-target.md");

		await seedRuntimeData(plugin, sandbox, episode, {
			currentEpisode: episode,
			timestampTemplate: "- {{linktime}}",
		});
		await installMediaSessionRecorder(obsidian);
		try {
			await waitForPodNotesReady(obsidian);
			await openMarkdownFile(obsidian, notePath);
			await setPlayback(obsidian, { currentTime: 95, paused: false });

			const action = await invokeRecordedMediaSessionAction(obsidian, "previoustrack");
			expect(action).toMatchObject({
				action: "previoustrack",
				ok: true,
			});

			const expectedLink = `- ${expectedTimestampLink("00:01:35", episode, 95)}`;
			const content = await sandbox.waitForContent(
				"headphone-capture-target.md",
				(value) => value.includes(expectedLink),
				WAIT_OPTS,
			);

			expect(content).toContain(expectedLink);
		} finally {
			await restoreMediaSessionRecorder(obsidian);
		}
	});

	test("previous-track Media Session action appends to the episode note without an active editor", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const audioPath = await seedAudio(sandbox, "headphone-background-episode.mp3");
		const episode = createLocalEpisode("E2E Background Capture Episode", audioPath);
		const noteRelativePath = `${episode.title}.md`;

		await seedRuntimeData(plugin, sandbox, episode, {
			currentEpisode: episode,
			note: {
				path: sandbox.path("{{title}}.md"),
				template: "# {{title}}\n",
			},
			timestampTemplate: "- {{linktime}}",
		});
		await installMediaSessionRecorder(obsidian);
		try {
			await waitForPodNotesReady(obsidian);
			await openPodNotesView(obsidian);
			await setPlayback(obsidian, { currentTime: 185, paused: false });

			const noEditor = await obsidian.dev.evalJson<boolean>(`
				!app.workspace.activeEditor?.editor
			`);
			expect(noEditor).toBe(true);

			const action = await invokeRecordedMediaSessionAction(obsidian, "previoustrack");
			expect(action).toMatchObject({
				action: "previoustrack",
				ok: true,
			});

			const expectedLink = `- ${expectedTimestampLink("00:03:05", episode, 185)}`;
			const content = await sandbox.waitForContent(
				noteRelativePath,
				(value) => value.includes(expectedLink),
				WAIT_OPTS,
			);

			expect(content).toContain("# E2E Background Capture Episode");
			expect(content).toContain(expectedLink);
		} finally {
			await restoreMediaSessionRecorder(obsidian);
		}
	});

	test("persists API volume changes and clamps out-of-range values", async () => {
		const { obsidian, plugin } = getContext();

		await plugin.updateDataAndReload<PodNotesData>((data) => {
			data.defaultVolume = 1;
		}, RELOAD_OPTIONS);
		await waitForPodNotesReady(obsidian);

		await setVolume(obsidian, 0.42);
		await plugin.waitForData<PodNotesData>((data) => data.defaultVolume === 0.42, WAIT_OPTS);

		await setVolume(obsidian, 1.5);
		const data = await plugin.waitForData<PodNotesData>(
			(value) => value.defaultVolume === 1,
			WAIT_OPTS,
		);
		const runtimeVolume = await getVolume(obsidian);

		expect(data.defaultVolume).toBe(1);
		expect(runtimeVolume).toBe(1);
	});

	test("migrates a legacy JSON date through note creation and the next durable save", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const audioPath = await seedAudio(sandbox, "legacy-date-episode.mp3");
		const isoDate = "2024-03-01T10:05:03.000Z";
		const episode = {
			...createLocalEpisode("E2E Legacy Date Episode", audioPath),
			episodeDate: isoDate as unknown as Date,
		};

		await seedRuntimeData(plugin, sandbox, episode, {
			currentEpisode: episode,
			legacyData: true,
			note: {
				path: sandbox.path("legacy-date-note.md"),
				template: "date: {{date:YYYY-MM-DD}}\n",
			},
		});
		await waitForPodNotesReady(obsidian);

		const beforeSave = await plugin.data<PodNotesData>().read();
		expect(beforeSave.schemaVersion).toBeUndefined();
		expect(beforeSave.legacyExtension).toEqual({ enabled: true });
		const runtimeDate = await evalJsonAsync<{ isDate: boolean; iso: string }>(
			obsidian,
			`(() => {
				const value = app.plugins.plugins.${PLUGIN_ID}.settings.currentEpisode.episodeDate;
				return { isDate: value instanceof Date, iso: value.toISOString() };
			})()`,
		);
		expect(runtimeDate).toEqual({ isDate: true, iso: isoDate });

		await obsidian.command(`${PLUGIN_ID}:create-podcast-note`).run();
		const note = await sandbox.waitForContent(
			"legacy-date-note.md",
			(value) => value.includes("date: 2024-03-01"),
			WAIT_OPTS,
		);
		expect(note).toContain("date: 2024-03-01");

		await setVolume(obsidian, 0.42);
		const persisted = await plugin.waitForData<PodNotesData>(
			(data) => data.schemaVersion === 1 && data.defaultVolume === 0.42,
			WAIT_OPTS,
		);
		expect(persisted.legacyExtension).toEqual({ enabled: true });
		expect(persisted.currentEpisode?.episodeDate).toBe(isoDate);
		expect(await obsidian.dev.runtimeErrors()).toEqual([]);
	});

	test("renders feed-controlled Markdown punctuation only as visible text", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const audioPath = await seedAudio(sandbox, "template-escaping-episode.mp3");
		const attacks = [
			{
				id: "link",
				title: String.raw`\[click\](//attacker.example/phish)`,
				encoded: String.raw`\\\[click\\\]\(//attacker\.example/phish\)`,
				visible: String.raw`\[click\](//attacker.example/phish)`,
			},
			{ id: "heading", title: "# forged heading", encoded: String.raw`\# forged heading` },
			{ id: "quote", title: "> forged quote", encoded: "&gt; forged quote" },
			{ id: "thematic", title: "---", encoded: String.raw`\-\-\-` },
			{ id: "list", title: "- forged list", encoded: String.raw`\- forged list` },
			{ id: "ordered", title: "1. forged list", encoded: String.raw`1\. forged list` },
			{
				id: "setext",
				title: "===",
				encoded: String.raw`\=\=\=`,
				template: "safe\n{{title}}\n",
			},
			{ id: "tilde-fence", title: "~~~dataviewjs", encoded: String.raw`\~\~\~dataviewjs` },
			{ id: "backtick-fence", title: "```dataviewjs", encoded: "\\`\\`\\`dataviewjs" },
			{
				id: "html",
				title: '<img src="//attacker.example/pixel">',
				encoded: '&lt;img src\\="//attacker\\.example/pixel"&gt;',
			},
			{
				id: "entity",
				title: "&lt;script&gt;",
				encoded: "&amp;lt;script&amp;gt;",
			},
		] as const;

		for (const attack of attacks) {
			const notePath = sandbox.path(`template-escaping-${attack.id}.md`);
			const episode = createLocalEpisode(attack.title, audioPath);
			const template = "template" in attack ? attack.template : "{{title}}\n";

			await seedRuntimeData(plugin, sandbox, episode, {
				currentEpisode: episode,
				note: { path: notePath, template },
			});
			await waitForPodNotesReady(obsidian);

			await obsidian.command(`${PLUGIN_ID}:create-podcast-note`).run();
			const content = await sandbox.waitForContent(
				`template-escaping-${attack.id}.md`,
				(value) => value.includes(attack.encoded),
				WAIT_OPTS,
			);
			expect(content).toContain(attack.encoded);

			await evalJsonAsync<boolean>(
				obsidian,
				`
				(async () => {
					const file = app.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
					if (!file) throw new Error("Template escaping note was not created.");
					const leaf = app.workspace.getLeaf(true);
					await leaf.setViewState({
						type: "markdown",
						state: { file: file.path, mode: "preview" },
						active: true,
					});
					await app.workspace.revealLeaf(leaf);
					return true;
				})()
			`,
			);

			const visible = "visible" in attack ? attack.visible : attack.title;
			await obsidian.waitFor(
				async () =>
					await obsidian.dev.evalJson<boolean>(`
						(() => {
							const preview = document.querySelector(
								".workspace-leaf.mod-active .markdown-preview-view",
							);
							return Boolean(preview?.textContent?.includes(${JSON.stringify(visible)}));
						})()
					`),
				WAIT_OPTS,
			);

			const preview = await obsidian.dev.evalJson<{
				forbiddenElements: string[];
				text: string;
			}>(`
				(() => {
					const preview = document.querySelector(
						".workspace-leaf.mod-active .markdown-preview-view",
					);
					const forbidden = "h1,h2,h3,h4,h5,h6,blockquote,hr,ul,ol,pre,code,a,img,script,iframe,video,audio,table";
					return {
						forbiddenElements: Array.from(preview?.querySelectorAll(forbidden) ?? []).map(
							(element) => element.tagName.toLowerCase(),
						),
						text: preview?.textContent ?? "",
					};
				})()
			`);

			expect(preview.text).toContain(visible);
			expect(preview.forbiddenElements).toEqual([]);
		}

		expect(await obsidian.dev.runtimeErrors()).toEqual([]);
	}, 60_000);

	test("refuses a future schema without modifying its data", async () => {
		const { obsidian, plugin } = getContext();
		const original = await plugin.data<PodNotesData>().read();
		const future = {
			...original,
			schemaVersion: 2,
			legacyExtension: { enabled: true },
		};

		await plugin.disable();
		await plugin.data<PodNotesData>().write(future);
		try {
			await plugin.enable().catch(() => undefined);
			await obsidian.sleep(200);

			const after = await plugin.data<PodNotesData>().read();
			const state = await obsidian.dev.evalJson<{ hasCommand: boolean; ready: boolean }>(
				`(() => ({
					hasCommand: Boolean(app.commands.commands[${JSON.stringify(`${PLUGIN_ID}:podnotes-show-leaf`)}]),
					ready: app.plugins.plugins.${PLUGIN_ID}?.isReady === true,
				}))()`,
			);
			expect(after).toEqual(future);
			expect(state).toEqual({ hasCommand: false, ready: false });
		} finally {
			await plugin.data<PodNotesData>().write(original);
			// A failed onload can leave Obsidian's enabled flag set without a live
			// plugin instance. Await the plugin manager directly so cleanup cannot
			// return before the restored onload finishes.
			await evalJsonAsync<boolean>(
				obsidian,
				`(async () => {
					await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});
					await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});
					return Boolean(app.plugins.plugins.${PLUGIN_ID});
				})()`,
			);
			await waitForPodNotesReady(obsidian);
			await obsidian.dev.resetDiagnostics().catch(() => undefined);
		}
	});
});

async function seedAudio(sandbox: SandboxApi, fileName: string): Promise<string> {
	await sandbox.write(fileName, "podnotes e2e audio placeholder", {
		waitForContent: true,
		waitOptions: WAIT_OPTS,
	});

	return sandbox.path(fileName);
}

async function openMarkdownFile(
	obsidian: Parameters<typeof evalJsonAsync>[0],
	path: string,
): Promise<void> {
	const result = await evalJsonAsync<{
		activePath: string | null;
		error?: string;
		ok: boolean;
	}>(
		obsidian,
		`
		(async () => {
			const targetPath = ${JSON.stringify(path)};
			let file = app.vault.getAbstractFileByPath(targetPath);
			if (!file) {
				const parentParts = targetPath.split("/").slice(0, -1);
				let current = "";
				for (const part of parentParts) {
					current = current ? current + "/" + part : part;
					if (!app.vault.getAbstractFileByPath(current)) {
						await app.vault.createFolder(current).catch(() => undefined);
					}
				}

				if (await app.vault.adapter.exists(targetPath)) {
					await app.vault.adapter.remove(targetPath);
				}

				file = await app.vault.create(targetPath, "");
			}

			if (!file) {
				return { ok: false, activePath: app.workspace.getActiveFile()?.path ?? null, error: "File not found." };
			}

			const leaf = app.workspace.getLeaf(true);
			await leaf.openFile(file);
			await app.workspace.revealLeaf(leaf);
			app.workspace.setActiveLeaf(leaf, { focus: true });

			return {
				ok: app.workspace.getActiveFile()?.path === targetPath,
				activePath: app.workspace.getActiveFile()?.path ?? null,
			};
		})()
	`,
	);

	if (!result.ok) {
		throw new Error(
			`Failed to open ${path}. Active file: ${result.activePath}. ${result.error ?? ""}`,
		);
	}
}

function createLocalEpisode(title: string, audioPath: string): LocalEpisode {
	return {
		title,
		streamUrl: audioPath,
		url: audioPath,
		description: "",
		content: "",
		podcastName: "local file",
		filePath: audioPath,
	};
}

async function seedRuntimeData(
	plugin: PluginHandle,
	sandbox: SandboxApi,
	episode: LocalEpisode,
	options: {
		currentEpisode?: Episode;
		defaultPlaybackRate?: number;
		note?: { path: string; template: string };
		played?: { duration: number; time: number };
		timestampTemplate?: string;
		legacyData?: boolean;
	} = {},
): Promise<void> {
	const placeholderEpisode = createLocalEpisode(
		"E2E Placeholder Episode",
		sandbox.path("placeholder.mp3"),
	);
	const localEpisodes = [episode];

	if (!options.currentEpisode) {
		localEpisodes.push(placeholderEpisode);
	}

	await plugin.updateDataAndReload<PodNotesData>((data) => {
		if (options.legacyData) {
			delete data.schemaVersion;
			data.legacyExtension = { enabled: true };
		}
		data.currentEpisode = options.currentEpisode ?? placeholderEpisode;
		data.defaultPlaybackRate = options.defaultPlaybackRate ?? 1;
		data.defaultVolume = 1;
		data.downloadedEpisodes = {
			[episode.podcastName]: [toDownloadedEpisode(episode)],
		};
		data.favorites = createPlaylist("Favorites", "lucide-star", []);
		data.localFiles = createPlaylist("Local Files", "folder", localEpisodes);
		data.playedEpisodes = options.played
			? {
					[episodeKey(episode)]: {
						title: episode.title,
						podcastName: episode.podcastName,
						time: options.played.time,
						duration: options.played.duration,
						finished: true,
					},
				}
			: {};
		data.playlists = {};
		data.queue = createPlaylist("Queue", "list-ordered", []);
		data.timestamp = {
			template: options.timestampTemplate ?? "- {{time}}",
			offset: 0,
		};
		if (options.note) {
			data.note = options.note;
		}
	}, RELOAD_OPTIONS);
}

function createPlaylist(
	name: string,
	icon: "folder" | "list-ordered" | "lucide-star",
	episodes: Episode[],
) {
	return {
		icon,
		name,
		episodes,
		shouldEpisodeRemoveAfterPlay: name === "Queue",
		shouldRepeat: false,
	};
}

function toDownloadedEpisode(episode: LocalEpisode): DownloadedEpisode {
	return {
		...episode,
		filePath: episode.filePath ?? episode.streamUrl,
		size: 1,
	};
}

function episodeKey(episode: Episode): string {
	return `${episode.podcastName}::${episode.title}`;
}

async function invokePodNotesUri(
	obsidian: Parameters<typeof evalJsonAsync>[0],
	episode: LocalEpisode,
	time: number,
	endTime?: number,
): Promise<void> {
	const result = await evalJsonAsync<{ error?: string; ok: boolean }>(
		obsidian,
		`
		(async () => {
			const handler = (app.workspace.protocolHandlers ?? app.workspace.protocolHandler?.handlers).get(${JSON.stringify(PLUGIN_ID)});
			if (!handler) {
				return { ok: false, error: "PodNotes protocol handler is not registered." };
			}

			await handler({
				action: ${JSON.stringify(PLUGIN_ID)},
				url: ${JSON.stringify(episode.filePath ?? episode.streamUrl)},
				episodeName: ${JSON.stringify(episode.title)},
				time: ${JSON.stringify(String(time))},
				endTime: ${JSON.stringify(endTime === undefined ? undefined : String(endTime))},
			});

			return { ok: true };
		})()
	`,
	);

	if (!result.ok) {
		throw new Error(result.error ?? "PodNotes URI handler failed.");
	}
}

async function dispatchLoadedMetadata(obsidian: {
	dev: { evalJson: <T>(code: string) => Promise<T> };
	sleep: (ms: number) => Promise<void>;
}): Promise<void> {
	const startedAt = Date.now();
	let lastError = "No PodNotes audio element found.";

	while (Date.now() - startedAt < WAIT_OPTS.timeoutMs) {
		const result = await obsidian.dev.evalJson<{
			error?: string;
			ok: boolean;
		}>(`
			(() => {
				const audio = document.querySelector(".podcast-view audio");
				if (!audio) {
					return { ok: false, error: "No PodNotes audio element found." };
				}

				Object.defineProperty(audio, "duration", {
					configurable: true,
					value: 3600,
				});
				audio.dispatchEvent(new Event("loadedmetadata"));
				Object.defineProperty(audio, "paused", {
					configurable: true,
					value: false,
				});
				audio.dispatchEvent(new Event("play"));

				return { ok: true };
			})()
		`);

		if (result.ok) return;

		lastError = result.error ?? "Failed to dispatch loadedmetadata.";
		await obsidian.sleep(WAIT_OPTS.intervalMs);
	}

	throw new Error(lastError);
}

async function dispatchAudioPlay(obsidian: {
	dev: { evalJson: <T>(code: string) => Promise<T> };
}): Promise<void> {
	const result = await obsidian.dev.evalJson<{ error?: string; ok: boolean }>(`
		(() => {
			const audio = document.querySelector(".podcast-view audio");
			if (!audio) {
				return { ok: false, error: "No PodNotes audio element found." };
			}

			Object.defineProperty(audio, "paused", {
				configurable: true,
				value: false,
			});
			audio.dispatchEvent(new Event("play"));

			return { ok: true };
		})()
	`);

	if (!result.ok) {
		throw new Error(result.error ?? "Failed to dispatch audio play.");
	}
}

async function dispatchAudioTimeUpdate(
	obsidian: {
		dev: { evalJson: <T>(code: string) => Promise<T> };
	},
	currentTime?: number,
): Promise<void> {
	const result = await obsidian.dev.evalJson<{ error?: string; ok: boolean }>(`
		(() => {
			const audio = document.querySelector(".podcast-view audio");
			if (!audio) {
				return { ok: false, error: "No PodNotes audio element found." };
			}

			if (${JSON.stringify(currentTime)} !== undefined) {
				Object.defineProperty(audio, "currentTime", {
					configurable: true,
					writable: true,
					value: ${JSON.stringify(currentTime)},
				});
			}

			Object.defineProperty(audio, "paused", {
				configurable: true,
				value: false,
			});
			audio.dispatchEvent(new Event("timeupdate"));

			return { ok: true };
		})()
	`);

	if (!result.ok) {
		throw new Error(result.error ?? "Failed to dispatch audio timeupdate.");
	}
}

async function waitForPlaybackState(
	obsidian: {
		dev: { evalJson: <T>(code: string) => Promise<T> };
		sleep: (ms: number) => Promise<void>;
	},
	predicate: (state: PlaybackState) => boolean,
): Promise<PlaybackState> {
	const startedAt = Date.now();
	let lastState: PlaybackState | null = null;

	while (Date.now() - startedAt < WAIT_OPTS.timeoutMs) {
		lastState = await getPlaybackState(obsidian);
		if (predicate(lastState)) return lastState;
		await obsidian.sleep(WAIT_OPTS.intervalMs);
	}

	throw new Error(
		`Timed out waiting for playback state. Last state: ${JSON.stringify(lastState)}`,
	);
}

async function getPlaybackState(obsidian: {
	dev: { evalJson: <T>(code: string) => Promise<T> };
}): Promise<PlaybackState> {
	return await obsidian.dev.evalJson<PlaybackState>(`
		(() => {
			const plugin = app.plugins.plugins.${PLUGIN_ID};
			return {
				currentTime: plugin?.api?.currentTime ?? null,
				hasPlayer: Boolean(document.querySelector(".episode-player")),
				isPlaying: Boolean(plugin?.api?.isPlaying),
				title: plugin?.api?.podcast?.title ?? null,
			};
		})()
	`);
}

async function setPlayback(
	obsidian: { dev: { evalJson: <T>(code: string) => Promise<T> } },
	{ currentTime, paused }: { currentTime: number; paused: boolean },
): Promise<void> {
	await obsidian.dev.evalJson(`
		(() => {
			const api = app.plugins.plugins.${PLUGIN_ID}.api;
			api.currentTime = ${JSON.stringify(currentTime)};
			if (${JSON.stringify(paused)}) {
				api.stop();
			} else {
				api.start();
			}
			return true;
		})()
	`);
}

async function setVolume(
	obsidian: { dev: { evalJson: <T>(code: string) => Promise<T> } },
	value: number,
): Promise<void> {
	await obsidian.dev.evalJson(`
		(() => {
			app.plugins.plugins.${PLUGIN_ID}.api.volume = ${JSON.stringify(value)};
			return true;
		})()
	`);
}

async function waitForPlaybackRate(
	obsidian: {
		dev: { evalJson: <T>(code: string) => Promise<T> };
		sleep: (ms: number) => Promise<void>;
	},
	expected: number,
): Promise<{ api: number | null; audio: number | null; label: string | null }> {
	const startedAt = Date.now();
	let lastRate: {
		api: number | null;
		audio: number | null;
		label: string | null;
	} = {
		api: null,
		audio: null,
		label: null,
	};

	while (Date.now() - startedAt < WAIT_OPTS.timeoutMs) {
		lastRate = await obsidian.dev.evalJson<{
			api: number | null;
			audio: number | null;
			label: string | null;
		}>(`
			(() => {
				const audio = document.querySelector(".podcast-view audio");
				const label = document.querySelector(".playbackrate-container span");
				return {
					api: app.plugins.plugins.${PLUGIN_ID}?.api?.playbackRate ?? null,
					audio: audio?.playbackRate ?? null,
					label: label?.textContent ?? null,
				};
			})()
		`);

		if (
			lastRate.api === expected &&
			lastRate.audio === expected &&
			lastRate.label === `${expected}x`
		) {
			return lastRate;
		}

		await obsidian.sleep(WAIT_OPTS.intervalMs);
	}

	throw new Error(
		`Timed out waiting for playback rate ${expected}. Last rate: ${JSON.stringify(lastRate)}`,
	);
}

async function installMediaSessionRecorder(
	obsidian: Parameters<typeof evalJsonAsync>[0],
): Promise<void> {
	const result = await evalJsonAsync<{ error?: string; ok: boolean }>(
		obsidian,
		`
		(async () => {
			const mediaSession = navigator.mediaSession;
			if (!mediaSession?.setActionHandler) {
				return { ok: false, error: "Media Session API is unavailable." };
			}

			const original = mediaSession.setActionHandler.bind(mediaSession);
			const handlers = {};

			globalThis.__podnotesMediaSessionHandlers = handlers;
			globalThis.__podnotesOriginalSetActionHandler = original;

			mediaSession.setActionHandler = (action, handler) => {
				const result = original(action, handler);
				handlers[action] = handler;
				return result;
			};

			await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});
			await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});

			return { ok: true };
		})()
	`,
	);

	if (!result.ok) {
		throw new Error(result.error ?? "Failed to install Media Session recorder.");
	}
}

async function restoreMediaSessionRecorder(
	obsidian: Parameters<typeof evalJsonAsync>[0],
): Promise<void> {
	await evalJsonAsync<boolean>(
		obsidian,
		`
		(() => {
			const original = globalThis.__podnotesOriginalSetActionHandler;
			if (navigator.mediaSession?.setActionHandler && original) {
				navigator.mediaSession.setActionHandler = original;
			}
			delete globalThis.__podnotesMediaSessionHandlers;
			delete globalThis.__podnotesOriginalSetActionHandler;
			return true;
		})()
	`,
	);
}

async function invokeRecordedMediaSessionAction(
	obsidian: Parameters<typeof evalJsonAsync>[0],
	action: string,
): Promise<{ action: string; error?: string; ok: boolean }> {
	return await evalJsonAsync(
		obsidian,
		`
		(() => {
			const handlers = globalThis.__podnotesMediaSessionHandlers ?? {};
			const handler = handlers[${JSON.stringify(action)}];

			if (typeof handler !== "function") {
				return {
					action: ${JSON.stringify(action)},
					ok: false,
					error: "Media Session action handler was not registered.",
				};
			}

			handler({ action: ${JSON.stringify(action)} });
			return { action: ${JSON.stringify(action)}, ok: true };
		})()
	`,
	);
}

async function getVolume(obsidian: {
	dev: { evalJson: <T>(code: string) => Promise<T> };
}): Promise<number> {
	return await obsidian.dev.evalJson<number>(`
		app.plugins.plugins.${PLUGIN_ID}.api.volume
	`);
}

function expectedTimestampLink(
	label: string,
	episode: LocalEpisode,
	time: number,
	endTime?: number,
): string {
	// Use the production encoder so this helper can never drift from the real wire format.
	const uri = encodePodnotesURI(
		episode.title,
		episode.filePath ?? episode.streamUrl,
		time,
		endTime,
	);

	return `[${label}](${uri.href})`;
}
