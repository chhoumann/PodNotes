// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import type { Readable } from "svelte/store";
import { plugin as pluginStore } from "src/store";
import type { IPodNotes } from "../../types/IPodNotes";
import type { IPodNotesSettings } from "../../types/IPodNotesSettings";

const svelte = vi.hoisted(() => ({
	mount: vi.fn(() => ({ component: "podcast-view" })),
	unmount: vi.fn(),
}));

vi.mock("svelte", () => svelte);
vi.mock("./PodcastView.svelte", () => ({ default: {} }));

import { MainView } from ".";
import { Navigation } from "./Navigation";

function createView({ shouldMount }: { shouldMount: boolean }) {
	const plugin = {
		navigation: new Navigation(),
		shouldMountPodcastView: vi.fn(() => shouldMount),
		unregisterPodcastView: vi.fn(),
	} as unknown as IPodNotes;
	const view = new MainView({} as WorkspaceLeaf, plugin);
	const contentEl = document.createElement("div");
	const workspace = { requestSaveLayout: vi.fn() };
	Object.assign(view, { contentEl, app: { workspace } });

	return { contentEl, plugin, view, workspace };
}

async function openView(view: MainView): Promise<void> {
	await (view as unknown as { onOpen(): Promise<void> }).onOpen();
}

async function closeView(view: MainView): Promise<void> {
	await (view as unknown as { onClose(): Promise<void> }).onClose();
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
		const { settings } = (
			svelte.mount.mock.calls[0] as unknown as [
				unknown,
				{ props: { services: { settings: Readable<IPodNotesSettings> } } },
			]
		)[1].props.services;
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
