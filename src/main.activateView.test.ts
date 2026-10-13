// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import PodNotes from "./main";
import { dataFileText } from "../tests/mocks/dataFileWriter";
import { VIEW_TYPE } from "./constants";
import { App, Notice, Platform, type WorkspaceLeaf } from "obsidian";
import * as obsidian from "obsidian";
import { tick } from "svelte";
import type { Episode } from "./types/Episode";
import { MainView } from "./ui/PodcastView";

// Regression coverage for #55: "Show PodNotes" / the ribbon icon must reliably
// surface the view. The bug was that the command was gated on the leaf NOT
// existing and never revealed it, so an already-open-but-hidden view (collapsed
// or overflowing sidebar) could not be brought back. activateView reuses the
// existing leaf when present and always reveals it.

function makeLeaf() {
	return {
		setViewState: vi.fn().mockResolvedValue(undefined),
	};
}

const originalPlatform = { ...Platform };

afterEach(() => {
	Object.assign(Platform, originalPlatform);
	vi.useRealTimers();
});

function setupPlugin({
	existingLeaves = [] as ReturnType<typeof makeLeaf>[],
	rightLeaf = makeLeaf() as ReturnType<typeof makeLeaf> | null,
} = {}) {
	const workspace = {
		getLeavesOfType: vi.fn().mockReturnValue(existingLeaves),
		getRightLeaf: vi.fn().mockReturnValue(rightLeaf),
		revealLeaf: vi.fn().mockResolvedValue(undefined),
	};

	// Build a bare instance so we exercise activateView without running the full
	// onload() side effects (store wiring, command registration, etc.).
	const plugin = Object.create(PodNotes.prototype) as PodNotes;
	Object.assign(plugin as unknown as Record<string, unknown>, {
		podcastViewMountEnabled: true,
		views: new Set(),
	});
	(plugin as unknown as { app: { workspace: typeof workspace } }).app = {
		workspace,
	};

	return { plugin, workspace, rightLeaf };
}

describe("PodNotes.activateView", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("reuses an existing leaf and reveals it without creating a new one", async () => {
		const existing = makeLeaf();
		const { plugin, workspace } = setupPlugin({ existingLeaves: [existing] });

		await plugin.activateView();

		expect(workspace.getRightLeaf).not.toHaveBeenCalled();
		expect(existing.setViewState).not.toHaveBeenCalled();
		expect(workspace.revealLeaf).toHaveBeenCalledTimes(1);
		expect(workspace.revealLeaf).toHaveBeenCalledWith(existing);
	});

	it("creates a right-sidebar leaf when none exists, then reveals it", async () => {
		const { plugin, workspace, rightLeaf } = setupPlugin();

		await plugin.activateView();

		expect(workspace.getRightLeaf).toHaveBeenCalledWith(false);
		expect(rightLeaf?.setViewState).toHaveBeenCalledWith({
			type: VIEW_TYPE,
			active: true,
		});
		expect(workspace.revealLeaf).toHaveBeenCalledWith(rightLeaf);
	});

	it("does not throw or reveal when no right leaf is available", async () => {
		const { plugin, workspace } = setupPlugin({ rightLeaf: null });

		await expect(plugin.activateView()).resolves.toBeUndefined();
		expect(workspace.revealLeaf).not.toHaveBeenCalled();
	});

	it("enables and mounts a dormant restored view before revealing it", async () => {
		const existing = makeLeaf();
		const firstRestoredView = { mountPodcastView: vi.fn() };
		const secondRestoredView = { mountPodcastView: vi.fn() };
		const { plugin } = setupPlugin({ existingLeaves: [existing] });
		Object.assign(plugin as unknown as Record<string, unknown>, {
			podcastViewMountEnabled: false,
			views: new Set([firstRestoredView, secondRestoredView]),
		});

		expect(plugin.shouldMountPodcastView()).toBe(false);

		await plugin.activateView();

		expect(plugin.shouldMountPodcastView()).toBe(true);
		expect(firstRestoredView.mountPodcastView).toHaveBeenCalledTimes(1);
		expect(secondRestoredView.mountPodcastView).toHaveBeenCalledTimes(1);
	});
});

describe("PodNotes.onLayoutReady", () => {
	function setupLayoutPlugin({
		existingLeaves = [] as ReturnType<typeof makeLeaf>[],
		isMobile = false,
		layoutReady = true,
		rightLeaf = makeLeaf() as ReturnType<typeof makeLeaf> | null,
	} = {}) {
		const workspace = {
			layoutReady,
			getLeavesOfType: vi.fn().mockReturnValue(existingLeaves),
			getRightLeaf: vi.fn().mockReturnValue(rightLeaf),
			detachLeavesOfType: vi.fn(),
		};

		const plugin = Object.create(PodNotes.prototype) as PodNotes;
		Object.assign(plugin as unknown as Record<string, unknown>, {
			isUnloaded: false,
			layoutReadyAttempts: 0,
			layoutReadyRetry: null,
			maxLayoutReadyAttempts: 10,
			storeUnsubscribers: [],
			views: new Set(),
		});
		(plugin as unknown as { app: { isMobile: boolean; workspace: typeof workspace } }).app = {
			isMobile,
			workspace,
		};

		return { plugin, workspace, rightLeaf };
	}

	it("creates the startup view on desktop when no leaf exists", () => {
		const { plugin, workspace, rightLeaf } = setupLayoutPlugin();

		plugin.onLayoutReady();

		expect(workspace.getRightLeaf).toHaveBeenCalledWith(false);
		expect(rightLeaf?.setViewState).toHaveBeenCalledWith({
			type: VIEW_TYPE,
		});
	});

	it("does not auto-create the startup view in the mobile app", () => {
		Object.assign(Platform, {
			isDesktop: false,
			isDesktopApp: false,
			isIosApp: true,
			isMobile: true,
			isMobileApp: true,
			isPhone: true,
		});
		const { plugin, workspace, rightLeaf } = setupLayoutPlugin();

		plugin.onLayoutReady();

		expect(workspace.getLeavesOfType).not.toHaveBeenCalled();
		expect(workspace.getRightLeaf).not.toHaveBeenCalled();
		expect(rightLeaf?.setViewState).not.toHaveBeenCalled();
		expect(workspace.detachLeavesOfType).not.toHaveBeenCalled();
	});

	it("does not auto-create the startup view when desktop Obsidian emulates mobile", () => {
		const { plugin, workspace, rightLeaf } = setupLayoutPlugin({
			isMobile: true,
		});

		plugin.onLayoutReady();

		expect(workspace.getLeavesOfType).not.toHaveBeenCalled();
		expect(workspace.getRightLeaf).not.toHaveBeenCalled();
		expect(rightLeaf?.setViewState).not.toHaveBeenCalled();
		expect(workspace.detachLeavesOfType).not.toHaveBeenCalled();
	});

	it("cancels a pending startup retry on unload", () => {
		vi.useFakeTimers();
		const { plugin, workspace } = setupLayoutPlugin({ layoutReady: false });

		plugin.onLayoutReady();
		expect(vi.getTimerCount()).toBe(1);

		plugin.onunload();
		expect(vi.getTimerCount()).toBe(0);

		vi.advanceTimersByTime(100);

		expect(workspace.getRightLeaf).not.toHaveBeenCalled();
		// onunload must NOT detach the view's leaves: doing so resets a leaf the
		// user moved back to its default location on the next load. Obsidian cleans
		// up an unloaded view's leaves itself (Obsidian plugin guideline).
		expect(workspace.detachLeavesOfType).not.toHaveBeenCalled();
	});
});

// Locks the actual #55 wiring (not just activateView's internals): the
// "Show PodNotes" command must stay always-available (a plain callback, never
// a leaf-gated checkCallback) and the ribbon icon must route to activateView.
// A refactor that reintroduced the old checkCallback gate or unwired the ribbon
// would reproduce the bug while activateView's own unit tests stayed green.
describe("PodNotes onload wiring (#55)", () => {
	// onload() subscribes real module-level stores (settings persistence + queue
	// automation); unload them after each test so leaked subscriptions don't fire
	// into a disposed plugin.
	const loaded: PodNotes[] = [];

	beforeEach(() => {
		vi.clearAllMocks();
		// jsdom implements no media loading; unload releases the player's element.
		vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
	});

	afterEach(() => {
		for (const p of loaded.splice(0)) {
			p.onunload();
		}
		vi.restoreAllMocks();
	});

	async function loadPlugin(loadedData: Record<string, unknown> = {}) {
		const activateSpy = vi
			.spyOn(PodNotes.prototype, "activateView")
			.mockResolvedValue(undefined);

		const commands: Array<Record<string, unknown>> = [];
		const ribbonCalls: Array<{
			icon: string;
			title: string;
			handler: (evt: unknown) => unknown;
		}> = [];

		const plugin = Object.create(PodNotes.prototype) as PodNotes;
		Object.assign(plugin, {
			loadData: vi.fn().mockResolvedValue(loadedData),
			saveData: vi.fn().mockResolvedValue(undefined),
			addCommand: vi.fn((cmd: Record<string, unknown>) => {
				commands.push(cmd);
				return cmd;
			}),
			addRibbonIcon: vi.fn(
				(icon: string, title: string, handler: (evt: unknown) => unknown) => {
					ribbonCalls.push({ icon, title, handler });
					return document.createElement("div");
				},
			),
			addSettingTab: vi.fn(),
			registerView: vi.fn(),
			registerObsidianProtocolHandler: vi.fn(),
			registerEvent: vi.fn(),
			registerDomEvent: vi.fn(),
			writeRefusal: null,
			writeInFlight: null,
			storeUnsubscribers: [],
			views: new Set(),
			manifest: { dir: ".obsidian/plugins/podnotes" },
			app: {
				loadLocalStorage: vi.fn(() => null),
				saveLocalStorage: vi.fn(),
				secretStorage: {
					getSecret: vi.fn(() => null),
					setSecret: vi.fn(),
					listSecrets: vi.fn(() => []),
				},
				vault: {
					on: vi.fn(() => ({})),
					adapter: {
						exists: vi.fn(async () => true),
						read: vi.fn(async () =>
							dataFileText(vi.mocked(plugin.saveData).mock.lastCall?.[0]),
						),
					},
				},
				workspace: {
					onLayoutReady: vi.fn(),
					on: vi.fn(() => ({})),
					getLeavesOfType: vi.fn(() => []),
					getRightLeaf: vi.fn(() => null),
					getActiveViewOfType: vi.fn(() => null),
					revealLeaf: vi.fn(),
					detachLeavesOfType: vi.fn(),
				},
			},
		});

		await plugin.onload();
		loaded.push(plugin);

		return { commands, ribbonCalls, activateSpy, plugin };
	}

	it("starts no save once the window fires pagehide", async () => {
		const { plugin } = await loadPlugin({ schemaVersion: 2 });
		const domEvents = vi.mocked(plugin.registerDomEvent).mock.calls as unknown as Array<
			[EventTarget, string, () => void]
		>;
		const onPageHide = domEvents.find(
			([target, type]) => target === window && type === "pagehide",
		)?.[2];
		const saveData = vi.mocked(plugin.saveData);
		saveData.mockClear();

		expect(onPageHide).toBeDefined();
		onPageHide?.();

		await expect(plugin.saveSettingsStrict()).rejects.toThrow(/window unloads/);
		expect(saveData).not.toHaveBeenCalled();
	});

	function quitHandler(
		plugin: PodNotes,
	): (tasks: { addPromise: (p: Promise<void>) => void }) => void {
		const calls = vi.mocked(plugin.app.workspace.on).mock.calls as unknown as Array<
			[string, (tasks: { addPromise: (p: Promise<void>) => void }) => void]
		>;
		const handler = calls.find(([name]) => name === "quit")?.[1];
		expect(handler).toBeDefined();
		return handler!;
	}

	it("adds no quit task when no save is in flight, and saves nothing after quit", async () => {
		const { plugin } = await loadPlugin({ schemaVersion: 2 });
		const saveData = vi.mocked(plugin.saveData);
		saveData.mockClear();
		const addPromise = vi.fn();

		quitHandler(plugin)({ addPromise });

		expect(addPromise).not.toHaveBeenCalled();
		await expect(plugin.saveSettingsStrict()).rejects.toThrow(/closes/);
		expect(saveData).not.toHaveBeenCalled();
	});

	it("makes quit wait for the save in flight", async () => {
		const { plugin } = await loadPlugin({ schemaVersion: 2 });
		let finishWrite = () => {};
		vi.mocked(plugin.saveData).mockImplementation(
			() => new Promise<void>((resolve) => (finishWrite = resolve)),
		);
		const addPromise = vi.fn();

		plugin.settings.defaultVolume = 0.5;
		void plugin.saveSettingsStrict();
		await vi.waitFor(() => expect(plugin.saveData).toHaveBeenCalled());
		quitHandler(plugin)({ addPromise });

		expect(addPromise).toHaveBeenCalledTimes(1);
		const quitTask: Promise<void> = addPromise.mock.calls[0][0];
		let quitTaskDone = false;
		void quitTask.then(() => (quitTaskDone = true));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(quitTaskDone).toBe(false);

		finishWrite();
		await quitTask;
		expect(quitTaskDone).toBe(true);
	});

	it("gives quit a task that resolves even when the save in flight fails", async () => {
		const { plugin } = await loadPlugin({ schemaVersion: 2 });
		let failWrite = (_error: Error) => {};
		vi.mocked(plugin.saveData)
			.mockRejectedValue(new Error("disk full"))
			.mockImplementationOnce(
				() => new Promise<void>((_resolve, reject) => (failWrite = reject)),
			);
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const addPromise = vi.fn();

		plugin.settings.defaultVolume = 0.5;
		void plugin.saveSettingsStrict().catch(() => undefined);
		await vi.waitFor(() => expect(plugin.saveData).toHaveBeenCalled());
		quitHandler(plugin)({ addPromise });
		failWrite(new Error("disk full"));

		await expect(addPromise.mock.calls[0][0]).resolves.toBeUndefined();
	});

	it("registers Show PodNotes as an always-available callback, not a leaf-gated checkCallback", async () => {
		const { commands } = await loadPlugin();

		const showCmd = commands.find((c) => c.id === "podnotes-show-leaf");
		expect(showCmd).toBeDefined();
		expect(typeof showCmd?.callback).toBe("function");
		expect(showCmd?.checkCallback).toBeUndefined();
	});

	it("registers the capture commands as plain callbacks, so they run with no editor focused", async () => {
		const { commands } = await loadPlugin();
		const kinds = ["callback", "checkCallback", "editorCallback", "editorCheckCallback"];

		for (const id of ["capture-timestamp", "capture-segment-10s", "capture-segment-20s"]) {
			const command = commands.find((c) => c.id === id);
			expect(kinds.filter((kind) => typeof command?.[kind] === "function")).toEqual([
				"callback",
			]);
		}
	});

	it("registers playback-rate commands for hotkeys", async () => {
		const { commands } = await loadPlugin();
		const commandIds = new Set(commands.map((c) => c.id));

		expect(commandIds.has("increase-playback-rate")).toBe(true);
		expect(commandIds.has("decrease-playback-rate")).toBe(true);
		expect(commandIds.has("reset-playback-rate")).toBe(true);
	});

	it("takes its refusal Notice away on unload", async () => {
		const { plugin } = await loadPlugin({ schemaVersion: 2 });
		Object.assign(plugin, { loadData: vi.fn().mockResolvedValue(undefined) });
		vi.mocked(plugin.app.vault.adapter.read).mockResolvedValue("{ cut off");
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		await plugin.onExternalSettingsChange();
		await expect(plugin.saveSettingsStrict()).rejects.toThrow(/does not save over/);
		const hide = vi.spyOn(Notice.prototype, "hide");

		plugin.onunload();

		expect(hide).toHaveBeenCalledTimes(1);
	});

	const savedEpisode: Episode = {
		title: "Saved Episode",
		streamUrl: "https://example.com/saved.mp3",
		url: "https://example.com/saved",
		description: "",
		content: "",
		podcastName: "Pod",
	};
	const savedData = {
		schemaVersion: 2,
		currentEpisode: savedEpisode,
		playedEpisodes: {
			"Pod::Saved Episode": {
				title: "Saved Episode",
				podcastName: "Pod",
				time: 1234,
				duration: 3600,
				finished: false,
			},
		},
	};
	const media = () => document.querySelector("audio.podnotes-media") as HTMLAudioElement;
	const checkCommand = (commands: Array<Record<string, unknown>>, id: string) =>
		(commands.find((c) => c.id === id)!.checkCallback as (checking: boolean) => boolean)(true);
	const runCommand = (commands: Array<Record<string, unknown>>, id: string) =>
		(commands.find((c) => c.id === id)!.checkCallback as (checking: boolean) => void)(false);

	it("Show player opens the full player while an episode is loaded, and the ribbon icon only reveals the view", async () => {
		const { commands, ribbonCalls, activateSpy, plugin } = await loadPlugin();
		const showCmd = commands.find((c) => c.id === "podnotes-show-leaf");
		expect(showCmd).toBeDefined();

		(showCmd!.callback as () => void)();
		expect(activateSpy).toHaveBeenCalledTimes(1);
		expect(plugin.navigation.current.expanded).toBe(false);
		plugin.player.restore(savedEpisode);
		expect(plugin.navigation.current.expanded).toBe(false);

		(showCmd!.callback as () => void)();
		expect(activateSpy).toHaveBeenCalledTimes(2);
		expect(plugin.navigation.current.expanded).toBe(true);

		plugin.navigation.collapse();
		const ribbon = ribbonCalls.find((r) => r.title === "Show PodNotes");
		expect(ribbon).toBeDefined();
		expect(ribbon?.icon).toBe("podcast");
		ribbon?.handler(new MouseEvent("click"));
		expect(activateSpy).toHaveBeenCalledTimes(3);
		expect(plugin.navigation.current.expanded).toBe(false);
	});

	it.each([
		{ title: "keeps the saved Queue page", saved: { kind: "queue" }, shown: { kind: "queue" } },
		{
			title: "falls back to Latest episodes for a removed podcast",
			saved: { kind: "feed", key: "Removed podcast" },
			shown: { kind: "latest" },
		},
		{
			title: "falls back to Latest episodes for a removed playlist",
			saved: { kind: "playlist", name: "Removed playlist" },
			shown: { kind: "latest" },
		},
	])(
		"Show player on a deferred view $title with the full player open",
		async ({ saved, shown }) => {
			const { plugin, activateSpy } = await loadPlugin(savedData);
			activateSpy.mockRestore();
			const leaf = { setViewState: vi.fn() };
			const view = new MainView(leaf as unknown as WorkspaceLeaf, plugin);
			onTestFinished(async () => {
				await (view as unknown as { onClose(): Promise<void> }).onClose();
			});
			const { scope, keymap } = new App();
			Object.assign(plugin.app, { scope, keymap });
			Object.assign(view, { app: plugin.app, contentEl: document.createElement("div") });
			// Obsidian 1.14 holds a leaf in a collapsed sidebar deferred. Revealing it
			// opens the view, then hands it the state saved in the workspace.
			Object.assign(plugin.app.workspace, {
				getLeavesOfType: vi.fn(() => [leaf]),
				requestSaveLayout: vi.fn(),
				revealLeaf: vi.fn(async () => {
					await (view as unknown as { onOpen(): Promise<void> }).onOpen();
					await view.setState({ page: saved }, { history: false });
				}),
			});

			await plugin.showPlayer();
			await tick();

			expect(plugin.app.workspace.revealLeaf).toHaveBeenCalledWith(leaf);
			expect(plugin.navigation.current).toMatchObject({ page: shown, expanded: true });
			expect(view.contentEl.querySelector(".pn-player")).not.toBeNull();
		},
	);

	it("captures a timestamp into the active note and names that note", async () => {
		const { plugin } = await loadPlugin(savedData);
		const editor = {
			getCursor: () => ({ line: 0, ch: 0 }),
			getLine: () => "",
			lineCount: () => 1,
			replaceSelection: vi.fn(),
		};
		Object.assign(plugin.app.workspace, {
			activeEditor: { editor, file: { path: "Journal/Daily note.md" } },
		});

		await expect(plugin.capture.timestamp()).resolves.toMatchObject({
			destination: "editor",
			path: "Journal/Daily note.md",
		});
		expect(editor.replaceSelection).toHaveBeenCalledWith(expect.stringContaining("00:20:34"));
	});

	it("says why a timestamp has nowhere to go when the episode note is not set up", async () => {
		const { plugin } = await loadPlugin(savedData);
		const notice = vi.spyOn(obsidian, "Notice");
		plugin.settings.note.path = "";

		await expect(plugin.capture.timestamp()).resolves.toBeNull();
		expect(notice.mock.calls).toEqual([
			["Set an episode note path and template to capture timestamps"],
		]);
	});

	it("restores the selected episode paused at its saved position, without loading it", async () => {
		const { plugin } = await loadPlugin(savedData);

		expect(plugin.api.podcast).toMatchObject({ title: "Saved Episode" });
		expect(plugin.api.currentTime).toBe(1234);
		expect(plugin.api.isPlaying).toBe(false);
		expect(media().getAttribute("src")).toBeNull();
	});

	it("lets Stop cancel an episode that is still loading", async () => {
		vi.spyOn(HTMLMediaElement.prototype, "play").mockReturnValue(new Promise(() => {}));
		vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
		const { commands, plugin } = await loadPlugin(savedData);
		expect(checkCommand(commands, "start-playing")).toBe(true);

		runCommand(commands, "start-playing");
		expect(media().getAttribute("src")).toBe(savedEpisode.streamUrl);
		expect(checkCommand(commands, "stop-playing")).toBe(true);
		runCommand(commands, "stop-playing");

		expect(plugin.api.isPlaying).toBe(false);
		expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
		expect(checkCommand(commands, "start-playing")).toBe(true);
	});

	it("saves the playing position on unload, before the store bindings are disposed", async () => {
		vi.spyOn(HTMLMediaElement.prototype, "play").mockReturnValue(new Promise(() => {}));
		vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
		const { plugin } = await loadPlugin(savedData);
		plugin.api.start();
		// jsdom loads no media; the browser would hold its metadata by now.
		Object.defineProperty(media(), "readyState", { value: HTMLMediaElement.HAVE_METADATA });
		media().dispatchEvent(new Event("loadedmetadata"));
		media().currentTime = 1300;

		plugin.onunload();

		await vi.waitFor(() => {
			const written = vi.mocked(plugin.saveData).mock.lastCall?.[0] as typeof savedData;
			expect(written?.playedEpisodes["Pod::Saved Episode"]?.time).toBe(1300);
		});
	});

	it("offers both transcribe commands for an audio episode, even without an API key", async () => {
		const { commands } = await loadPlugin(savedData);

		expect(checkCommand(commands, "podnotes-transcribe")).toBe(true);
		expect(checkCommand(commands, "podnotes-transcribe-audio")).toBe(true);
	});

	function recordMediaSession(target: { navigator: Navigator }) {
		const calls: Array<{ action: string; hasHandler: boolean }> = [];
		const original = Object.getOwnPropertyDescriptor(target.navigator, "mediaSession");
		Object.defineProperty(target.navigator, "mediaSession", {
			configurable: true,
			value: {
				setActionHandler: vi.fn((action: string, handler: (() => void) | null) => {
					calls.push({ action, hasHandler: typeof handler === "function" });
				}),
				setPositionState: vi.fn(),
			},
		});
		restoreMediaSessions.push(() => {
			if (original) Object.defineProperty(target.navigator, "mediaSession", original);
			else Reflect.deleteProperty(target.navigator, "mediaSession");
		});
		return calls;
	}
	const restoreMediaSessions: Array<() => void> = [];
	afterEach(() => {
		for (const restore of restoreMediaSessions.splice(0)) restore();
		vi.unstubAllGlobals();
	});

	it("sets the headphone capture handler on the main window's Media Session once an episode is shown", async () => {
		const calls = recordMediaSession(window);
		const popout = { navigator: {} as Navigator };
		const popoutCalls = recordMediaSession(popout);
		vi.stubGlobal("activeWindow", popout);

		const { plugin } = await loadPlugin(savedData);
		const createView = vi.mocked(plugin.registerView).mock.calls[0][1];
		createView({} as WorkspaceLeaf);
		createView({} as WorkspaceLeaf);

		expect(calls.filter(({ action }) => action === "previoustrack")).toEqual([
			{ action: "previoustrack", hasHandler: true },
		]);
		expect(popoutCalls).toEqual([]);
	});

	it("clears the Media Session handlers on unload", async () => {
		const calls = recordMediaSession(window);

		const { plugin } = await loadPlugin(savedData);
		plugin.onunload();
		loaded.splice(loaded.indexOf(plugin), 1);

		const set = calls.filter(({ hasHandler }) => hasHandler).map(({ action }) => action);
		const cleared = calls.filter(({ hasHandler }) => !hasHandler).map(({ action }) => action);
		expect(set).toContain("previoustrack");
		expect(cleared.sort()).toEqual(set.sort());
	});

	it("does not offer transcription for known video episodes", async () => {
		const videoEpisode: Episode = {
			title: "Video Episode",
			streamUrl: "https://example.com/video.mp4",
			url: "https://example.com/video",
			description: "",
			content: "",
			podcastName: "Pod",
			mediaType: "video",
		};
		const { commands } = await loadPlugin({
			openAISecretId: "podnotes-openai-api-key",
			currentEpisode: videoEpisode,
		});

		for (const id of ["podnotes-transcribe", "podnotes-transcribe-audio"]) {
			const transcribeCmd = commands.find((c) => c.id === id);
			expect(transcribeCmd).toBeDefined();
			expect((transcribeCmd!.checkCallback as (checking: boolean) => boolean)(true)).toBe(
				false,
			);
		}
	});
});

// The single-instance player view is kept across reloads (onunload no longer
// detaches leaves), so a hot reload's duplicate is collapsed on layout-change.
// This locks the convergence invariant: keep the first leaf, detach the rest,
// and never act when there is at most one (so a cold-restart leaf is preserved
// and the re-fired layout-change terminates).
describe("PodNotes.dedupePlayerLeaves", () => {
	function leaf() {
		return { detach: vi.fn() };
	}

	function run(leaves: ReturnType<typeof leaf>[]) {
		const workspace = { getLeavesOfType: vi.fn().mockReturnValue(leaves) };
		const plugin = Object.create(PodNotes.prototype) as PodNotes;
		(plugin as unknown as { app: { workspace: typeof workspace } }).app = {
			workspace,
		};
		(plugin as unknown as { dedupePlayerLeaves: () => void }).dedupePlayerLeaves();
	}

	it("collapses multiple leaves to one, keeping the first", () => {
		const leaves = [leaf(), leaf(), leaf()];
		run(leaves);
		expect(leaves[0].detach).not.toHaveBeenCalled();
		expect(leaves[1].detach).toHaveBeenCalledTimes(1);
		expect(leaves[2].detach).toHaveBeenCalledTimes(1);
	});

	it("is a no-op with a single leaf (preserves the restored leaf)", () => {
		const leaves = [leaf()];
		run(leaves);
		expect(leaves[0].detach).not.toHaveBeenCalled();
	});

	it("is a no-op with no leaves", () => {
		expect(() => run([])).not.toThrow();
	});
});
