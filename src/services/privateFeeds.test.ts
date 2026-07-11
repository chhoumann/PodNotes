import { describe, expect, it, vi } from "vitest";
import type { SecretStorage } from "obsidian";
import type { PodcastFeed } from "src/types/PodcastFeed";
import { FeedUrlRepository } from "./FeedUrlRepository";
import { internPrivateFeed, migratePrivateFeedUrls, resolveFeedUrl } from "./privateFeeds";

function repository(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	const api = {
		getSecret: vi.fn((id: string) => values.get(id) ?? null),
		setSecret: vi.fn((id: string, value: string) => {
			values.set(id, value);
		}),
		listSecrets: vi.fn(() => [...values.keys()]),
	} as unknown as SecretStorage;
	return { values, api, feedUrls: new FeedUrlRepository(api) };
}

function feed(overrides: Partial<PodcastFeed> = {}): PodcastFeed {
	return { title: "My Show", url: "https://feeds.example.com/rss", artworkUrl: "", ...overrides };
}

const PRIVATE_URL = "https://www.patreon.com/rss/show?auth=se-cret";

describe("internPrivateFeed", () => {
	it("moves a credential-bearing URL into SecretStorage and persists a placeholder", () => {
		const { feedUrls, values } = repository();
		const interned = internPrivateFeed(feed({ url: PRIVATE_URL }), feedUrls);

		expect(interned.urlSecretId).toBe("podnotes-feed-url");
		expect(values.get("podnotes-feed-url")).toBe(PRIVATE_URL);
		expect(interned.url).toBe("podnotes-private-feed:My%20Show");
		expect(JSON.stringify(interned)).not.toContain("se-cret");
	});

	it("passes public feeds and already-interned feeds through untouched", () => {
		const { feedUrls } = repository();
		const publicFeed = feed();
		expect(internPrivateFeed(publicFeed, feedUrls)).toBe(publicFeed);

		const interned = feed({
			url: "podnotes-private-feed:My%20Show",
			urlSecretId: "podnotes-feed-url",
		});
		expect(internPrivateFeed(interned, feedUrls)).toBe(interned);
	});

	it("keeps the feed unchanged when SecretStorage fails, never half-migrated", () => {
		const { api, feedUrls } = repository();
		(api.setSecret as ReturnType<typeof vi.fn>).mockImplementation(() => {
			throw new Error("locked");
		});
		const original = feed({ url: PRIVATE_URL });
		const result = internPrivateFeed(original, feedUrls);
		expect(result).toBe(original);
		expect(result.urlSecretId).toBeUndefined();
	});
});

describe("resolveFeedUrl", () => {
	it("resolves a private feed from SecretStorage", () => {
		const { feedUrls } = repository({ "podnotes-feed-url": PRIVATE_URL });
		const privateFeed = feed({
			url: "podnotes-private-feed:My%20Show",
			urlSecretId: "podnotes-feed-url",
		});
		expect(resolveFeedUrl(privateFeed, feedUrls)).toBe(PRIVATE_URL);
	});

	it("returns null when the secret is absent on this device", () => {
		const { feedUrls } = repository();
		const privateFeed = feed({
			url: "podnotes-private-feed:My%20Show",
			urlSecretId: "podnotes-feed-url",
		});
		expect(resolveFeedUrl(privateFeed, feedUrls)).toBeNull();
	});

	it("never fetches a stranded placeholder without a reference", () => {
		const { feedUrls } = repository();
		expect(
			resolveFeedUrl(feed({ url: "podnotes-private-feed:My%20Show" }), feedUrls),
		).toBeNull();
	});

	it("passes public URLs through", () => {
		const { feedUrls } = repository();
		expect(resolveFeedUrl(feed(), feedUrls)).toBe("https://feeds.example.com/rss");
	});
});

describe("migratePrivateFeedUrls", () => {
	it("moves only credential-bearing feeds and reports the count", () => {
		const { feedUrls, values } = repository();
		const { savedFeeds, migrated } = migratePrivateFeedUrls(
			{
				Public: feed({ title: "Public" }),
				Patreon: feed({ title: "Patreon", url: PRIVATE_URL }),
				Basic: feed({ title: "Basic", url: "https://user:pw@feeds.example.com/rss" }),
			},
			feedUrls,
		);

		expect(migrated).toBe(2);
		expect(savedFeeds.Public.url).toBe("https://feeds.example.com/rss");
		expect(savedFeeds.Patreon.url).toBe("podnotes-private-feed:Patreon");
		expect(savedFeeds.Basic.urlSecretId).toBe("podnotes-feed-url-2");
		expect(JSON.stringify(savedFeeds)).not.toMatch(/se-cret|user:pw/);
		expect(values.get("podnotes-feed-url")).toBe(PRIVATE_URL);
	});

	it("is idempotent: a second run over migrated feeds changes nothing", () => {
		const { feedUrls } = repository();
		const first = migratePrivateFeedUrls({ Patreon: feed({ url: PRIVATE_URL }) }, feedUrls);
		const second = migratePrivateFeedUrls(first.savedFeeds, feedUrls);
		expect(second.migrated).toBe(0);
		expect(second.savedFeeds).toEqual(first.savedFeeds);
	});
});
