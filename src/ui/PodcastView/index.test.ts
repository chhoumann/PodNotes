import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import type { IPodNotes } from "../../types/IPodNotes";

const svelte = vi.hoisted(() => ({
	mount: vi.fn(() => ({ component: "podcast-view" })),
	unmount: vi.fn(),
}));

vi.mock("svelte", () => svelte);
vi.mock("./PodcastView.svelte", () => ({ default: {} }));

import { MainView } from ".";

function createView({ shouldMount }: { shouldMount: boolean }) {
	const plugin = {
		shouldMountPodcastView: vi.fn(() => shouldMount),
		unregisterPodcastView: vi.fn(),
	} as unknown as IPodNotes;
	const view = new MainView({} as WorkspaceLeaf, plugin);
	const contentEl = document.createElement("div");
	(view as unknown as { contentEl: HTMLElement }).contentEl = contentEl;

	return { contentEl, plugin, view };
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
		const { contentEl, view } = createView({ shouldMount: true });

		await openView(view);

		expect(svelte.mount).toHaveBeenCalledTimes(1);
		expect(svelte.mount).toHaveBeenCalledWith(expect.anything(), {
			target: contentEl,
		});
	});

	it("mountPodcastView wakes a dormant restored view exactly once", () => {
		const { contentEl, view } = createView({ shouldMount: false });

		view.mountPodcastView();
		view.mountPodcastView();

		expect(svelte.mount).toHaveBeenCalledTimes(1);
		expect(svelte.mount).toHaveBeenCalledWith(expect.anything(), {
			target: contentEl,
		});
	});

	it("unmounts a mounted PodcastView", async () => {
		const { plugin, view } = createView({ shouldMount: true });

		await openView(view);
		await closeView(view);

		expect(svelte.unmount).toHaveBeenCalledTimes(1);
		expect(plugin.unregisterPodcastView).toHaveBeenCalledWith(view);
	});
});
