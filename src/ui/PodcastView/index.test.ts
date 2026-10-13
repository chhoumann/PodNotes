// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile, type WorkspaceLeaf } from "obsidian";
import { plugin as pluginStore } from "src/store";
import type { Episode } from "../../types/Episode";
import type { IPodNotes } from "../../types/IPodNotes";
import type { IPodNotesSettings } from "../../types/IPodNotesSettings";

const svelte = vi.hoisted(() => ({
	mount: vi.fn(() => ({ component: "podcast-view" })),
	unmount: vi.fn(),
}));

vi.mock("svelte", () => svelte);
vi.mock("./PodcastView.svelte", () => ({ default: {} }));

import { MainView } from ".";
import type { ShellServices } from "./context";
import { Navigation } from "./Navigation";

interface VaultListener {
	name: string;
	callback(): void;
}

/** A vault of notes at their template paths, whose event refs work like Obsidian's. */
function createVault() {
	const notes = new Set<string>();
	const listeners = new Set<VaultListener>();
	const vault = {
		notes,
		listeners,
		on(name: string, callback: () => void) {
			const ref = { e: vault, name, callback };
			listeners.add(ref);
			return ref;
		},
		offref(ref: VaultListener) {
			listeners.delete(ref);
		},
		trigger(name: string) {
			for (const ref of listeners) if (ref.name === name) ref.callback();
		},
		getAbstractFileByPath: (path: string) =>
			notes.has(path) ? Object.assign(Object.create(TFile.prototype), { path }) : null,
		getMarkdownFiles: () => [],
	};
	return vault;
}

function createView({
	shouldMount,
	layoutReady = true,
}: {
	shouldMount: boolean;
	layoutReady?: boolean;
}) {
	const plugin = {
		navigation: new Navigation(),
		shouldMountPodcastView: vi.fn(() => shouldMount),
		unregisterPodcastView: vi.fn(),
	} as unknown as IPodNotes;
	const view = new MainView({} as WorkspaceLeaf, plugin);
	const contentEl = document.createElement("div");
	const pending: Array<() => void> = [];
	const workspace = {
		layoutReady,
		requestSaveLayout: vi.fn(),
		onLayoutReady: (callback: () => void) =>
			workspace.layoutReady ? callback() : pending.push(callback),
		finishLayout() {
			workspace.layoutReady = true;
			for (const callback of pending.splice(0)) callback();
		},
	};
	const vault = createVault();
	const app = { workspace, vault };
	Object.assign(view, { contentEl, app });

	return { app, contentEl, plugin, view, workspace, vault };
}

function mountedServices(): ShellServices {
	return (
		svelte.mount.mock.calls[0] as unknown as [unknown, { props: { services: ShellServices } }]
	)[1].props.services;
}

async function openView(view: MainView): Promise<void> {
	await (view as unknown as { open(): Promise<void> }).open();
}

async function closeView(view: MainView): Promise<void> {
	await (view as unknown as { close(): Promise<void> }).close();
}

describe("MainView mobile startup mounting", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("does not mount the Svelte UI when plugin startup keeps the view dormant", async () => {
		const { plugin, view } = createView({ shouldMount: false });

		await openView(view);

		expect(plugin.shouldMountPodcastView).toHaveBeenCalled();
		expect(svelte.mount).not.toHaveBeenCalled();
	});

	it("mounts the Svelte UI when the plugin allows the view to wake", async () => {
		const { contentEl, plugin, view } = createView({ shouldMount: true });

		await openView(view);

		expect(svelte.mount).toHaveBeenCalledTimes(1);
		expect(svelte.mount).toHaveBeenCalledWith(expect.anything(), {
			target: contentEl,
			props: { services: expect.objectContaining({ navigation: plugin.navigation }) },
		});
	});

	it("mountPodcastView wakes a dormant restored view exactly once", () => {
		const { contentEl, plugin, view } = createView({ shouldMount: false });

		view.mountPodcastView();
		view.mountPodcastView();

		expect(svelte.mount).toHaveBeenCalledTimes(1);
		expect(svelte.mount).toHaveBeenCalledWith(expect.anything(), {
			target: contentEl,
			props: { services: expect.objectContaining({ navigation: plugin.navigation }) },
		});
	});

	it("gives the view the plugin's settings, current through a toggle and an import", async () => {
		const { plugin, view } = createView({ shouldMount: true });
		const host = Object.assign(plugin, { settings: { autoQueue: true } as IPodNotesSettings });
		pluginStore.set(host as never);
		await openView(view);
		const { settings } = mountedServices();
		const seen: boolean[] = [];

		const stop = settings.subscribe(({ autoQueue }) => seen.push(autoQueue));
		host.settings.autoQueue = false;
		pluginStore.set(host as never);
		host.settings = { autoQueue: true } as IPodNotesSettings;
		pluginStore.set(host as never);
		stop();

		expect(seen).toEqual([true, false, true]);
	});

	it("unmounts a mounted PodcastView", async () => {
		const { plugin, view } = createView({ shouldMount: true });

		await openView(view);
		await closeView(view);

		expect(svelte.unmount).toHaveBeenCalledTimes(1);
		expect(plugin.unregisterPodcastView).toHaveBeenCalledWith(view);
	});
});

describe("MainView episode notes", () => {
	const episode = { title: "Episode One", podcastName: "Show" } as Episode;
	const notePath = "podcasts/Episode One.md";

	function createNotesView(options: { layoutReady?: boolean } = {}) {
		const created = createView({ shouldMount: true, ...options });
		pluginStore.set({
			app: created.app,
			settings: { note: { path: "podcasts/{{title}}" } },
		} as never);
		return created;
	}

	/** Whether the row shows its note icon, each time it looks again, as EpisodeRow does. */
	function watchRow() {
		const shown: boolean[] = [];
		mountedServices().rowHasNote.subscribe((hasNote) => shown.push(hasNote(episode)));
		return shown;
	}

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	it("looks again when a note is created, deleted or renamed, not edited, until the view closes", async () => {
		const { view, vault } = createNotesView();
		await openView(view);
		const shown = watchRow();
		const change = (name: string, apply: () => void) => {
			apply();
			vault.trigger(name);
			vi.runAllTimers();
		};

		change("create", () => vault.notes.add(notePath));
		change("delete", () => vault.notes.delete(notePath));
		change("rename", () => vault.notes.add(notePath));
		change("modify", () => vault.notes.delete(notePath));
		await closeView(view);
		change("create", () => vault.notes.add(notePath));

		expect(shown).toEqual([false, true, false, true]);
	});

	it("looks again once the layout is ready, not for the files Obsidian reports while it loads the vault", async () => {
		const { view, vault, workspace } = createNotesView({ layoutReady: false });
		await openView(view);
		const shown = watchRow();

		vault.notes.add(notePath);
		vault.trigger("create");
		vi.runAllTimers();
		expect(shown).toEqual([false]);

		workspace.finishLayout();
		vi.runAllTimers();
		expect(shown).toEqual([false, true]);
	});

	it("leaves no vault listener when the view closes before the layout is ready", async () => {
		const { view, vault, workspace } = createNotesView({ layoutReady: false });
		await openView(view);

		await closeView(view);
		workspace.finishLayout();

		expect(vault.listeners.size).toBe(0);
	});

	it("looks once, after a burst of a thousand vault changes ends", async () => {
		const { view, vault } = createNotesView();
		await openView(view);
		const shown = watchRow();

		vault.notes.add(notePath);
		for (let index = 0; index < 1000; index++) {
			vault.trigger(["create", "delete", "rename"][index % 3] as string);
		}
		expect(shown).toEqual([false]);
		vi.runAllTimers();

		expect(shown).toEqual([false, true]);
	});
});

describe("MainView workspace state", () => {
	it("saves the open page and restores it in a new session", async () => {
		const first = createView({ shouldMount: true });
		first.plugin.navigation.go({ kind: "feed", key: "Test Podcast" });
		first.plugin.navigation.expand();
		const saved = JSON.parse(JSON.stringify(first.view.getState()));

		const next = createView({ shouldMount: true });
		await next.view.setState(saved, { history: false });

		expect(next.plugin.navigation.current).toEqual({
			page: { kind: "feed", key: "Test Podcast" },
			stack: [],
			expanded: false,
			scrollTop: 0,
		});
	});

	it.each([undefined, null, {}, { page: { kind: "feed" } }, { page: "queue" }])(
		"keeps the page for the saved state %j",
		async (state) => {
			const { plugin, view } = createView({ shouldMount: true });
			plugin.navigation.go({ kind: "latest" });

			await view.setState(state, { history: false });

			expect(plugin.navigation.current.page).toEqual({ kind: "latest" });
			expect(plugin.navigation.current.stack).toHaveLength(1);
		},
	);

	it("asks Obsidian to save the layout when the page changes, until the view closes", async () => {
		const { plugin, view, workspace } = createView({ shouldMount: true });
		await openView(view);

		plugin.navigation.expand();
		plugin.navigation.collapse();
		expect(workspace.requestSaveLayout).not.toHaveBeenCalled();
		plugin.navigation.go({ kind: "latest" });
		plugin.navigation.go({ kind: "latest" });
		expect(workspace.requestSaveLayout).toHaveBeenCalledTimes(1);

		await closeView(view);
		plugin.navigation.back();
		expect(workspace.requestSaveLayout).toHaveBeenCalledTimes(1);
	});
});
