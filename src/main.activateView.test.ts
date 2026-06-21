import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PodNotes from "./main";
import { VIEW_TYPE } from "./constants";
import { Platform } from "obsidian";
import type { Episode } from "./types/Episode";

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
		expect(workspace.detachLeavesOfType).toHaveBeenCalledWith(VIEW_TYPE);
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
			mediaSessionActions: [],
			storeUnsubscribers: [],
			views: new Set(),
			app: {
				workspace: {
					onLayoutReady: vi.fn(),
					on: vi.fn(() => ({})),
					getLeavesOfType: vi.fn(() => []),
					getRightLeaf: vi.fn(() => null),
					revealLeaf: vi.fn(),
					detachLeavesOfType: vi.fn(),
				},
			},
		});

		await plugin.onload();
		loaded.push(plugin);

		return { commands, ribbonCalls, activateSpy, plugin };
	}

	it("registers Show PodNotes as an always-available callback, not a leaf-gated checkCallback", async () => {
		const { commands } = await loadPlugin();

		const showCmd = commands.find((c) => c.id === "podnotes-show-leaf");
		expect(showCmd).toBeDefined();
		expect(typeof showCmd?.callback).toBe("function");
		expect(showCmd?.checkCallback).toBeUndefined();
	});

	it("registers Capture Timestamp as an editor check-callback (mobile-toolbar addable, inert when capture is impossible)", async () => {
		// editorCheckCallback (like the segment-capture commands) keeps the command
		// addable to the mobile editor toolbar while letting it go inert when there
		// is no episode / no timestamp template, instead of silently no-opping (TS-01).
		const { commands } = await loadPlugin();

		const captureCmd = commands.find((c) => c.id === "capture-timestamp");
		expect(captureCmd).toBeDefined();
		expect(typeof captureCmd?.editorCheckCallback).toBe("function");
		expect(captureCmd?.editorCallback).toBeUndefined();
		expect(captureCmd?.checkCallback).toBeUndefined();
	});

	it("registers playback-rate commands for hotkeys", async () => {
		const { commands } = await loadPlugin();
		const commandIds = new Set(commands.map((c) => c.id));

		expect(commandIds.has("increase-playback-rate")).toBe(true);
		expect(commandIds.has("decrease-playback-rate")).toBe(true);
		expect(commandIds.has("reset-playback-rate")).toBe(true);
	});

	it("registers a previous-track Media Session handler for headphone timestamp capture", async () => {
		const originalMediaSession = Object.getOwnPropertyDescriptor(
			navigator,
			"mediaSession",
		);
		const calls: Array<{ action: string; hasHandler: boolean }> = [];

		Object.defineProperty(navigator, "mediaSession", {
			configurable: true,
			value: {
				setActionHandler: vi.fn(
					(action: string, handler: (() => void) | null) => {
						calls.push({
							action,
							hasHandler: typeof handler === "function",
						});
					},
				),
			},
		});

		try {
			await loadPlugin();
			expect(calls).toContainEqual({
				action: "previoustrack",
				hasHandler: true,
			});
		} finally {
			if (originalMediaSession) {
				Object.defineProperty(
					navigator,
					"mediaSession",
					originalMediaSession,
				);
			} else {
				Reflect.deleteProperty(navigator, "mediaSession");
			}
		}
	});

	it("clears the previous-track Media Session handler on unload", async () => {
		const originalMediaSession = Object.getOwnPropertyDescriptor(
			navigator,
			"mediaSession",
		);
		const calls: Array<{ action: string; hasHandler: boolean }> = [];

		Object.defineProperty(navigator, "mediaSession", {
			configurable: true,
			value: {
				setActionHandler: vi.fn(
					(action: string, handler: (() => void) | null) => {
						calls.push({
							action,
							hasHandler: typeof handler === "function",
						});
					},
				),
			},
		});

		try {
			const { plugin } = await loadPlugin();
			plugin.onunload();
			loaded.splice(loaded.indexOf(plugin), 1);

			expect(calls).toContainEqual({
				action: "previoustrack",
				hasHandler: true,
			});
			expect(calls).toContainEqual({
				action: "previoustrack",
				hasHandler: false,
			});
		} finally {
			if (originalMediaSession) {
				Object.defineProperty(
					navigator,
					"mediaSession",
					originalMediaSession,
				);
			} else {
				Reflect.deleteProperty(navigator, "mediaSession");
			}
		}
	});

	it("Show PodNotes command and ribbon icon both route to activateView", async () => {
		const { commands, ribbonCalls, activateSpy } = await loadPlugin();

		const showCmd = commands.find((c) => c.id === "podnotes-show-leaf");
		(showCmd?.callback as () => void)();
		expect(activateSpy).toHaveBeenCalledTimes(1);

		const ribbon = ribbonCalls.find((r) => r.title === "Show PodNotes");
		expect(ribbon).toBeDefined();
		expect(ribbon?.icon).toBe("podcast");
		ribbon?.handler(new MouseEvent("click"));
		expect(activateSpy).toHaveBeenCalledTimes(2);
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
			openAIApiKey: "sk-test",
			currentEpisode: videoEpisode,
		});

		const transcribeCmd = commands.find((c) => c.id === "podnotes-transcribe");
		expect(transcribeCmd).toBeDefined();
		expect(
			(transcribeCmd?.checkCallback as (checking: boolean) => boolean)(true),
		).toBe(false);
	});
});
