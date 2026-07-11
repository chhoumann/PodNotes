import { describe, expect, it, vi } from "vitest";
import type { SecretStorage } from "obsidian";
import type { PodcastFeed } from "src/types/PodcastFeed";
import { FeedUrlRepository } from "./FeedUrlRepository";
import {
	internPrivateFeed,
	migratePrivateFeedUrls,
	resolveFeedUrl,
	scrubMigratedEpisodeUrls,
} from "./privateFeeds";

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

		expect(interned.urlSecretId).toMatch(/^podnotes-feed-url-/);
		expect(values.get(interned.urlSecretId as string)).toBe(PRIVATE_URL);
		expect(interned.url).toBe("podnotes-private-feed:My%20Show");
		expect(JSON.stringify(interned)).not.toContain("se-cret");
	});

	it("passes public feeds and already-interned feeds through untouched", () => {
		const { feedUrls } = repository();
		const publicFeed = feed();
		expect(internPrivateFeed(publicFeed, feedUrls)).toBe(publicFeed);

		const interned = feed({
			url: "podnotes-private-feed:My%20Show",
			urlSecretId: "podnotes-feed-url-12345678-9abc-4def-8123-456789abcdef",
		});
		expect(internPrivateFeed(interned, feedUrls)).toBe(interned);
	});

	it("re-interns a record carrying BOTH a stale reference and a raw credentialed URL", () => {
		const { feedUrls, values } = repository();
		const smuggled = feed({
			url: PRIVATE_URL,
			urlSecretId: "podnotes-feed-url-12345678-9abc-4def-8123-456789abcdef",
		});
		const interned = internPrivateFeed(smuggled, feedUrls);
		expect(interned.url).toBe("podnotes-private-feed:My%20Show");
		expect(interned.urlSecretId).not.toBe(smuggled.urlSecretId);
		expect(values.get(interned.urlSecretId as string)).toBe(PRIVATE_URL);
	});

	it("builds the placeholder from the savedFeeds key when it differs from the title", () => {
		const { feedUrls } = repository();
		const interned = internPrivateFeed(feed({ url: PRIVATE_URL }), feedUrls, "Renamed Key");
		expect(interned.url).toBe("podnotes-private-feed:Renamed%20Key");
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
		const id = "podnotes-feed-url-12345678-9abc-4def-8123-456789abcdef";
		const { feedUrls } = repository({ [id]: PRIVATE_URL });
		const privateFeed = feed({ url: "podnotes-private-feed:My%20Show", urlSecretId: id });
		expect(resolveFeedUrl(privateFeed, feedUrls)).toBe(PRIVATE_URL);
	});

	it("returns null when the secret is absent on this device", () => {
		const { feedUrls } = repository();
		const privateFeed = feed({
			url: "podnotes-private-feed:My%20Show",
			urlSecretId: "podnotes-feed-url-12345678-9abc-4def-8123-456789abcdef",
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
		const { savedFeeds, replacements, failed } = migratePrivateFeedUrls(
			{
				Public: feed({ title: "Public" }),
				Patreon: feed({ title: "Patreon", url: PRIVATE_URL }),
				Basic: feed({ title: "Basic", url: "https://user:pw@feeds.example.com/rss" }),
			},
			feedUrls,
		);

		expect(replacements.size).toBe(2);
		expect(failed).toEqual([]);
		expect(savedFeeds.Public.url).toBe("https://feeds.example.com/rss");
		expect(savedFeeds.Patreon.url).toBe("podnotes-private-feed:Patreon");
		expect(savedFeeds.Basic.urlSecretId).toMatch(/^podnotes-feed-url-/);
		expect(JSON.stringify(savedFeeds)).not.toMatch(/se-cret|user:pw/);
		expect(values.get(savedFeeds.Patreon.urlSecretId as string)).toBe(PRIVATE_URL);
		expect(replacements.get(PRIVATE_URL)).toBe("podnotes-private-feed:Patreon");
	});

	it("is idempotent: a second run over migrated feeds changes nothing", () => {
		const { feedUrls } = repository();
		const first = migratePrivateFeedUrls({ Patreon: feed({ url: PRIVATE_URL }) }, feedUrls);
		const second = migratePrivateFeedUrls(first.savedFeeds, feedUrls);
		expect(second.replacements.size).toBe(0);
		expect(second.savedFeeds).toEqual(first.savedFeeds);
	});

	it("reports feeds whose URL could not be protected", () => {
		const { api, feedUrls } = repository();
		(api.setSecret as ReturnType<typeof vi.fn>).mockImplementation(() => {
			throw new Error("locked");
		});
		const { failed, replacements } = migratePrivateFeedUrls(
			{ Patreon: feed({ title: "Patreon", url: PRIVATE_URL }) },
			feedUrls,
		);
		expect(failed).toEqual(["Patreon"]);
		expect(replacements.size).toBe(0);
	});
});

describe("scrubMigratedEpisodeUrls", () => {
	const replacements = new Map([[PRIVATE_URL, "podnotes-private-feed:Patreon"]]);

	it("rewrites url/feedUrl in nested episode snapshots and nothing else", () => {
		const settings = {
			currentEpisode: { title: "Ep 1", url: PRIVATE_URL, feedUrl: PRIVATE_URL },
			queue: {
				episodes: [
					{
						title: "Ep 2",
						feedUrl: PRIVATE_URL,
						streamUrl: "https://cdn.example/e2.mp3",
					},
				],
			},
			playedEpisodes: { "Ep 3": { feedUrl: "https://public.example/rss", time: 10 } },
		};
		const scrubbed = scrubMigratedEpisodeUrls(settings, replacements);
		expect(scrubbed.currentEpisode.url).toBe("podnotes-private-feed:Patreon");
		expect(scrubbed.currentEpisode.feedUrl).toBe("podnotes-private-feed:Patreon");
		expect(scrubbed.queue.episodes[0].feedUrl).toBe("podnotes-private-feed:Patreon");
		expect(scrubbed.queue.episodes[0].streamUrl).toBe("https://cdn.example/e2.mp3");
		expect(scrubbed.playedEpisodes["Ep 3"].feedUrl).toBe("https://public.example/rss");
		expect(JSON.stringify(scrubbed)).not.toContain("se-cret");
	});

	it("preserves Date instances and untouched subtrees by reference", () => {
		const date = new Date("2026-01-01T00:00:00Z");
		const settings = {
			currentEpisode: { title: "Ep", feedUrl: PRIVATE_URL, episodeDate: date },
			untouched: { nested: { value: 1 } },
		};
		const scrubbed = scrubMigratedEpisodeUrls(settings, replacements);
		expect(scrubbed.currentEpisode.episodeDate).toBe(date);
		expect(scrubbed.untouched).toBe(settings.untouched);
	});

	it("is a no-op without replacements", () => {
		const settings = { currentEpisode: { feedUrl: PRIVATE_URL } };
		expect(scrubMigratedEpisodeUrls(settings, new Map())).toBe(settings);
	});
});
