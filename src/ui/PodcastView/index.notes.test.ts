// @vitest-environment jsdom
import { within } from "@testing-library/svelte";
import { TFile, type WorkspaceLeaf } from "obsidian";
import { get } from "svelte/store";
import { afterEach, expect, test, vi } from "vitest";
import { DEFAULT_SETTINGS } from "src/constants";
import { FeedRepository } from "src/services/FeedRepository";
import { FeedUrlRepository } from "src/services/FeedUrlRepository";
import { plugin as pluginStore, savedFeeds } from "src/store";
import type { Episode } from "src/types/Episode";
import type { IPodNotes } from "src/types/IPodNotes";
import { feedDocument, MemoryStorage } from "../../../tests/mocks/feeds";
import { installResizeObserver } from "../../../tests/mocks/resizeObserver";
import { createTestServices, pluginLibrary } from "../../../tests/mocks/services";
import { MainView } from ".";

const show = { title: "Show", url: "https://show.test/feed.xml", artworkUrl: "" };
const episode: Episode = {
	title: "Episode One",
	streamUrl: "https://show.test/one.mp3",
	url: "https://show.test/one",
	description: "",
	content: "",
	podcastName: show.title,
};

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	savedFeeds.set({});
	vi.restoreAllMocks();
});

/** The plugin's view, mounted as Obsidian opens it, on a podcast's page. */
async function openPodcastPage(notes: string[]) {
	const widths = installResizeObserver();
	const feeds = new FeedRepository({
		load: async () => feedDocument(show.title, [episode]),
		resolveUrl: (feed) => feed.url,
		storage: new MemoryStorage(),
		cache: () => ({ enabled: false, ttlHours: 6 }),
		now: Date.now,
	});
	const { services, dispose } = createTestServices({ feeds, library: pluginLibrary });
	const vault = {
		on: (name: string, callback: () => void) => ({ e: vault, name, callback }),
		offref: () => {},
		getAbstractFileByPath: (path: string) =>
			notes.includes(path) ? Object.assign(Object.create(TFile.prototype), { path }) : null,
		getMarkdownFiles: () => [],
	};
	const app = {
		...services.app,
		vault,
		workspace: { layoutReady: true, onLayoutReady: (ready: () => void) => ready() },
	};
	const settings = structuredClone(DEFAULT_SETTINGS);
	settings.note.path = "Notes/{{title}}.md";
	pluginStore.set({ ...get(pluginStore), app, settings } as never);
	savedFeeds.set({ [show.title]: show });
	services.navigation.go({ kind: "feed", key: show.title });
	const plugin = {
		...services,
		feedUrls: new FeedUrlRepository(app.secretStorage),
		shouldMountPodcastView: () => true,
		unregisterPodcastView: () => {},
	} as unknown as IPodNotes;
	const view = new MainView({} as WorkspaceLeaf, plugin);
	const contentEl = document.body.appendChild(document.createElement("div"));
	Object.assign(view, { app, contentEl });
	await (view as unknown as { open(): Promise<void> }).open();
	cleanups.push(
		() => widths.uninstall(),
		dispose,
		() => contentEl.remove(),
		() => (view as unknown as { close(): Promise<void> }).close(),
	);
	return { rows: within(contentEl), settings };
}

test("a listed episode shows its note as soon as the note path setting finds it", async () => {
	const { rows, settings } = await openPodcastPage(["Elsewhere/Episode One.md"]);
	const row = await rows.findByRole("button", { name: "Episode One" });
	expect(row.querySelector('[title="Has note"]')).toBeNull();

	settings.note.path = "Elsewhere/{{title}}.md";
	pluginStore.set(get(pluginStore));

	expect(await rows.findByRole("button", { name: "Episode One, has note" })).toBe(row);
	expect(row.querySelector('[title="Has note"]')).not.toBeNull();
});
