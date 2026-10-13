import { App } from "obsidian";
import { vi } from "vitest";
import { DEFAULT_EPISODE_LIST_LIMIT, DEFAULT_SETTINGS } from "src/constants";
import { PlayerController } from "src/player/PlayerController";
import type { Capture } from "src/services/CaptureService";
import { FeedRepository } from "src/services/FeedRepository";
import { FeedUrlRepository } from "src/services/FeedUrlRepository";
import { createLibraryActions } from "src/services/library";
import { derived, writable, type Readable, type Writable } from "svelte/store";
import {
	downloadedEpisodes,
	episodeListLimit,
	favorites,
	hidePlayedEpisodes,
	localFiles,
	playedEpisodes,
	playlists,
	plugin,
	queue,
	savedFeeds,
} from "src/store";
import type { Episode } from "src/types/Episode";
import type { Library, ShellServices } from "src/ui/PodcastView/context";
import { Navigation } from "src/ui/PodcastView/Navigation";
import { PodcastSearch } from "src/ui/PodcastView/podcastSearch";
import { FakeDocument } from "./fakeMedia";
import { feedDocument, MemoryStorage } from "./feeds";

/** A library the test seeds, with the stores' setters. */
export type TestLibrary = {
	readonly [K in keyof Library]: Library[K] extends Readable<infer T> ? Writable<T> : never;
};

/** An empty library of its own, apart from the plugin's global stores. */
export function createTestLibrary(): TestLibrary {
	return {
		savedFeeds: writable({}),
		queue: writable(structuredClone(DEFAULT_SETTINGS.queue)),
		favorites: writable(structuredClone(DEFAULT_SETTINGS.favorites)),
		playlists: writable({}),
		localFiles: writable(structuredClone(DEFAULT_SETTINGS.localFiles)),
		playedEpisodes: writable({}),
		downloadedEpisodes: writable({}),
		episodeListLimit: writable(DEFAULT_EPISODE_LIST_LIMIT),
		hidePlayedEpisodes: writable(false),
	};
}

/**
 * The plugin's global stores, as MainView supplies them.
 */
export const pluginLibrary: TestLibrary = {
	savedFeeds,
	queue,
	favorites,
	playlists,
	localFiles,
	playedEpisodes,
	downloadedEpisodes,
	episodeListLimit,
	hidePlayedEpisodes,
};

export type TestServices = ShellServices & {
	readonly library: TestLibrary;
	readonly captureTimestamp: ReturnType<typeof vi.fn<() => Promise<Capture | null>>>;
	readonly openSettings: ReturnType<typeof vi.fn<() => void>>;
	readonly hasNote: ReturnType<typeof vi.fn<(episode: Episode) => boolean>>;
	readonly rowHasNote: Writable<(episode: Episode) => boolean>;
};

/**
 * The plugin services a view gets, with a real player over a fake media
 * element, an empty library of its own, and a feed repository that follows
 * the library's `savedFeeds` until `dispose`. `actions` changes the plugin's
 * stores, so a test that uses it passes `library: pluginLibrary`. Legacy
 * components still read the `plugin` store, so it is set too, and `settings`
 * follows it as the view's does. It stays set: views the test rendered unmount
 * after `dispose`, and still read it until then.
 */
export function createTestServices(
	overrides: Partial<Omit<TestServices, "captureTimestamp" | "openSettings" | "hasNote">> = {},
): {
	services: TestServices;
	doc: FakeDocument;
	dispose(): void;
} {
	const doc = new FakeDocument();
	const settings = structuredClone(DEFAULT_SETTINGS);
	const app = new App();
	const player = new PlayerController(doc.asPlayerDocument(), {
		settings,
		app: { vault: {} as never },
		checkpoint: (update) => update(),
		saveSettings: () => Promise.resolve(),
	});
	const feeds = new FeedRepository({
		load: async () => feedDocument("", []),
		resolveUrl: (feed) => feed.url,
		storage: new MemoryStorage(),
		cache: () => ({ enabled: false, ttlHours: 6 }),
		now: Date.now,
	});
	const services = {
		app,
		api: { skipBackward: vi.fn(), skipForward: vi.fn() } as never,
		player,
		feeds,
		navigation: new Navigation(),
		library: createTestLibrary(),
		actions: createLibraryActions({
			app,
			feeds,
			feedUrls: new FeedUrlRepository(app.secretStorage),
		}),
		search: new PodcastSearch(feeds),
		settings: derived(plugin, ($plugin) => $plugin.settings),
		captureTimestamp: vi.fn(async () => null),
		openSettings: vi.fn(),
		hasNote: vi.fn(() => false),
		rowHasNote: writable(() => false),
		...overrides,
	} as TestServices;
	const unsubscribe = services.library.savedFeeds.subscribe((saved) =>
		services.feeds.setSubscriptions(saved),
	);
	plugin.set({ ...services, settings } as never);
	return {
		services,
		doc,
		dispose: unsubscribe,
	};
}
