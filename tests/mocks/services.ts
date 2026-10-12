import { App } from "obsidian";
import { vi } from "vitest";
import { DEFAULT_SETTINGS } from "src/constants";
import { PlayerController } from "src/player/PlayerController";
import { FeedRepository } from "src/services/FeedRepository";
import { derived } from "svelte/store";
import { plugin, savedFeeds } from "src/store";
import type { ShellServices } from "src/ui/PodcastView/context";
import { Navigation } from "src/ui/PodcastView/Navigation";
import { FakeDocument } from "./fakeMedia";
import { feedDocument, MemoryStorage } from "./feeds";

export type TestServices = ShellServices & {
	readonly captureTimestamp: ReturnType<typeof vi.fn<() => Promise<string | null>>>;
	readonly openSettings: ReturnType<typeof vi.fn<() => void>>;
};

/**
 * The plugin services a view gets, with a real player over a fake media
 * element and a feed repository that follows `savedFeeds` until `dispose`.
 * Legacy components still read the `plugin` store, so it is set too, and
 * `settings` follows it as the view's does. It stays set: views the test
 * rendered unmount after `dispose`, and still read it until then.
 */
export function createTestServices(overrides: Partial<ShellServices> = {}): {
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
		settings: derived(plugin, ($plugin) => $plugin.settings),
		captureTimestamp: vi.fn(async () => null),
		openSettings: vi.fn(),
		...overrides,
	} as TestServices;
	const unsubscribe = savedFeeds.subscribe((saved) => services.feeds.setSubscriptions(saved));
	plugin.set({ ...services, settings } as never);
	return {
		services,
		doc,
		dispose: unsubscribe,
	};
}
