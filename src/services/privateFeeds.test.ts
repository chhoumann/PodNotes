import { describe, expect, it, vi } from "vitest";
import type { SecretStorage } from "obsidian";
import * as obsidian from "obsidian";
import { DEFAULT_SETTINGS } from "src/constants";
import {
	decodePodNotesData,
	encodePodNotesData,
	PODNOTES_DATA_SCHEMA_VERSION,
} from "src/persistence/podNotesData";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import type { PodcastFeed } from "src/types/PodcastFeed";
import { FeedUrlRepository } from "./FeedUrlRepository";
import {
	internPrivateFeed,
	notifyPrivateFeedUnavailable,
	protectPrivateFeeds,
	publicFeedUrl,
	resolveFeedUrl,
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

it("reports a missing device address in one sentence without destructive recovery instructions", () => {
	const notice = vi.spyOn(obsidian, "Notice");
	notifyPrivateFeedUnavailable("My Show");
	expect(notice).toHaveBeenCalledWith(
		'The private feed address for "My Show" is not available on this device.',
	);
});

describe("publicFeedUrl", () => {
	it("is a public feed's http or https address", () => {
		expect(publicFeedUrl(feed())).toBe("https://feeds.example.com/rss");
		expect(publicFeedUrl(feed({ url: "http://feeds.example.com/rss" }))).toBe(
			"http://feeds.example.com/rss",
		);
	});

	it.each([
		["a private feed's placeholder", feed({ url: "podnotes-private-feed:My Show" })],
		["a feed with a secret reference", feed({ urlSecretId: "podnotes-feed-url-1" })],
		["a raw private address", feed({ url: PRIVATE_URL })],
		["an address that is not http", feed({ url: "file:///feeds/rss.xml" })],
		["no address", feed({ url: "not a url" })],
	])("is nothing for %s", (_, saved) => {
		expect(publicFeedUrl(saved)).toBeUndefined();
	});
});

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

	it("throws when SecretStorage fails, so the URL is never saved in its place", () => {
		const { api, feedUrls, values } = repository();
		(api.setSecret as ReturnType<typeof vi.fn>).mockImplementation(() => {
			throw new Error("locked");
		});
		const original = feed({ url: PRIVATE_URL });
		expect(() => internPrivateFeed(original, feedUrls)).toThrow("locked");
		expect(original).toEqual(feed({ url: PRIVATE_URL }));
		expect(values.size).toBe(0);
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

function settings(overrides: Partial<IPodNotesSettings>): IPodNotesSettings {
	return { ...structuredClone(DEFAULT_SETTINGS), ...overrides };
}

function episode(title: string, feedUrl: string) {
	return {
		title,
		streamUrl: `https://cdn.example/${title}.mp3`,
		url: "",
		description: "",
		content: "",
		podcastName: "Patreon",
		feedUrl,
		episodeDate: new Date("2026-01-01T00:00:00Z"),
	};
}

describe("protectPrivateFeeds", () => {
	it("redacts entity-escaped descriptions before persistence without changing public bytes", () => {
		const { feedUrls } = repository();
		const address = "https://private.example.com/rss?auth=PERSIST_ENTITY_SENTINEL";
		const escaped = address.replace(":", "&#58;").replaceAll("/", "&#x2F;");
		const publicText = "Public https&#58;&#x2F;&#x2F;private.example.com/public?a=1&amp;b=2";
		const input = settings({
			savedFeeds: {
				Paid: feed({
					title: "Paid",
					url: address,
					description: `${escaped}. ${publicText}`,
				}),
				Public: feed({ description: publicText }),
			},
		});
		const { settings: safe } = protectPrivateFeeds(input, feedUrls);
		expect(safe.savedFeeds.Public).toEqual(input.savedFeeds.Public);
		expect(safe.savedFeeds.Paid.description).toBe(`podnotes-private-feed:Paid. ${publicText}`);
		expect(JSON.stringify(encodePodNotesData(safe))).not.toContain("PERSIST_ENTITY_SENTINEL");
	});

	it("moves only credential-bearing feeds", () => {
		const { feedUrls, values } = repository();
		const { settings: safe, failed } = protectPrivateFeeds(
			settings({
				savedFeeds: {
					Public: feed({ title: "Public" }),
					Patreon: feed({ title: "Patreon", url: PRIVATE_URL }),
					Basic: feed({ title: "Basic", url: "https://user:pw@feeds.example.com/rss" }),
				},
			}),
			feedUrls,
		);

		expect(failed).toEqual([]);
		expect(safe.savedFeeds.Public.url).toBe("https://feeds.example.com/rss");
		expect(safe.savedFeeds.Patreon.url).toBe("podnotes-private-feed:Patreon");
		expect(safe.savedFeeds.Basic.urlSecretId).toMatch(/^podnotes-feed-url-/);
		expect(JSON.stringify(safe)).not.toMatch(/se-cret|user:pw/);
		expect(values.get(safe.savedFeeds.Patreon.urlSecretId as string)).toBe(PRIVATE_URL);
	});

	it("replaces the moved URL in every persisted episode snapshot and nothing else", () => {
		const { feedUrls } = repository();
		const queued = episode("Ep 2", PRIVATE_URL);
		const { settings: safe } = protectPrivateFeeds(
			settings({
				savedFeeds: { Patreon: feed({ title: "Patreon", url: PRIVATE_URL }) },
				currentEpisode: { ...episode("Ep 1", PRIVATE_URL), url: PRIVATE_URL },
				queue: { ...DEFAULT_SETTINGS.queue, episodes: [queued] },
				favorites: { ...DEFAULT_SETTINGS.favorites, episodes: [queued] },
				playlists: { Mix: { ...DEFAULT_SETTINGS.queue, name: "Mix", episodes: [queued] } },
				downloadedEpisodes: { Patreon: [{ ...queued, filePath: "Ep 2.mp3", size: 1 }] },
				playedEpisodes: {
					"Ep 3": {
						title: "Ep 3",
						podcastName: "Other",
						time: 10,
						duration: 20,
						finished: false,
					},
				},
			}),
			feedUrls,
		);

		expect(JSON.stringify(safe)).not.toContain("se-cret");
		expect(safe.currentEpisode?.url).toBe("podnotes-private-feed:Patreon");
		expect(safe.queue.episodes[0].feedUrl).toBe("podnotes-private-feed:Patreon");
		expect(safe.queue.episodes[0].streamUrl).toBe("https://cdn.example/Ep 2.mp3");
		expect(safe.queue.episodes[0].episodeDate).toEqual(queued.episodeDate);
		expect(safe.downloadedEpisodes.Patreon[0].feedUrl).toBe("podnotes-private-feed:Patreon");
	});

	it("replaces the moved URL in a loaded library's downloads and playlists under any name", () => {
		const { feedUrls } = repository();
		const queued = episode("Ep 2", PRIVATE_URL);
		const { settings: loaded } = decodePodNotesData(
			JSON.parse(
				JSON.stringify({
					schemaVersion: PODNOTES_DATA_SCHEMA_VERSION,
					libraryId: "library",
					savedFeeds: { toString: feed({ title: "toString", url: PRIVATE_URL }) },
					playlists: {
						constructor: {
							...DEFAULT_SETTINGS.queue,
							name: "constructor",
							episodes: [queued],
						},
					},
					downloadedEpisodes: {
						toString: [{ ...queued, filePath: "Ep 2.mp3", size: 1 }],
					},
				}),
			),
		);

		const { settings: safe } = protectPrivateFeeds(loaded, feedUrls);
		const [download] = Object.values(safe.downloadedEpisodes)[0];
		const [listed] = Object.values(safe.playlists)[0].episodes;

		expect(JSON.stringify(encodePodNotesData(safe))).not.toContain("se-cret");
		expect(download.feedUrl).toBe("podnotes-private-feed:toString");
		expect(download.episodeDate).toEqual(queued.episodeDate);
		expect(listed.feedUrl).toBe("podnotes-private-feed:toString");
	});

	it("is idempotent: a second run over protected settings changes nothing", () => {
		const { feedUrls } = repository();
		const first = protectPrivateFeeds(
			settings({ savedFeeds: { Patreon: feed({ url: PRIVATE_URL }) } }),
			feedUrls,
		);
		expect(protectPrivateFeeds(first.settings, feedUrls).settings).toBe(first.settings);
	});

	it("replaces a protected feed's URL that an earlier import left in episode snapshots", () => {
		const { feedUrls } = repository();
		const id = feedUrls.store(PRIVATE_URL);
		const saved = feed({
			title: "Patreon",
			url: "podnotes-private-feed:Patreon",
			urlSecretId: id,
		});
		const leaked = settings({
			savedFeeds: { Patreon: saved },
			queue: { ...DEFAULT_SETTINGS.queue, episodes: [episode("Ep 2", PRIVATE_URL)] },
		});

		const { settings: safe } = protectPrivateFeeds(leaked, feedUrls);

		expect(JSON.stringify(safe)).not.toContain("se-cret");
		expect(safe.queue.episodes[0].feedUrl).toBe("podnotes-private-feed:Patreon");
		expect(safe.savedFeeds.Patreon).toEqual(saved);
	});

	it("replaces the feed URL in an episode that has no feedUrl", () => {
		const { feedUrls } = repository();
		const linkOnly: Partial<ReturnType<typeof episode>> = {
			...episode("Ep 2", ""),
			url: PRIVATE_URL,
		};
		delete linkOnly.feedUrl;
		const { settings: safe } = protectPrivateFeeds(
			settings({
				savedFeeds: { Patreon: feed({ title: "Patreon", url: PRIVATE_URL }) },
				queue: { ...DEFAULT_SETTINGS.queue, episodes: [linkOnly as never] },
			}),
			feedUrls,
		);
		expect(JSON.stringify(safe)).not.toContain("se-cret");
		expect(safe.queue.episodes[0].url).toBe("podnotes-private-feed:Patreon");
	});

	it("names a feed saved under another key by that key in its episodes", () => {
		const { feedUrls } = repository();
		const id = feedUrls.store(PRIVATE_URL);
		const aliased = { ...episode("Ep 2", PRIVATE_URL), podcastName: "Channel Title" };
		const queue = { ...DEFAULT_SETTINGS.queue, episodes: [aliased] };
		const raw = protectPrivateFeeds(
			settings({
				savedFeeds: { "Saved Key": feed({ title: "Channel Title", url: PRIVATE_URL }) },
				queue,
			}),
			feedUrls,
		).settings;
		const placeholder = "podnotes-private-feed:Saved%20Key";
		const protectedHere = feed({ title: "Channel Title", url: placeholder, urlSecretId: id });
		const repaired = protectPrivateFeeds(
			settings({ savedFeeds: { "Saved Key": protectedHere }, queue }),
			feedUrls,
		).settings;

		expect(raw.savedFeeds["Saved Key"].url).toBe(placeholder);
		expect(raw.queue.episodes[0].feedUrl).toBe(placeholder);
		expect(repaired.queue.episodes[0].feedUrl).toBe(placeholder);
	});

	it("keeps an episode's own link even when it carries a token", () => {
		const { feedUrls } = repository();
		const link = "https://cdn.example/post?token=abc";
		const linked = { ...episode("Ep 2", "podnotes-private-feed:Patreon"), url: link };
		const { settings: safe } = protectPrivateFeeds(
			settings({ queue: { ...DEFAULT_SETTINGS.queue, episodes: [linked] } }),
			feedUrls,
		);
		expect(safe.queue.episodes[0].url).toBe(link);
	});

	it("keeps a failed move available only for the session and redacts its snapshots", () => {
		const { api, feedUrls } = repository();
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		(api.setSecret as ReturnType<typeof vi.fn>).mockImplementation(() => {
			throw new Error("locked");
		});
		const input = settings({
			savedFeeds: {
				Public: feed({ title: "Public" }),
				Patreon: feed({ title: "Patreon", url: PRIVATE_URL }),
			},
			queue: { ...DEFAULT_SETTINGS.queue, episodes: [episode("Ep 2", PRIVATE_URL)] },
		});
		const { failed, settings: result } = protectPrivateFeeds(input, feedUrls);
		expect(failed).toEqual(["Patreon"]);
		expect(JSON.stringify(result)).not.toContain(PRIVATE_URL);
		expect(result.savedFeeds.Patreon.url).toBe("podnotes-private-feed:Patreon");
		expect(resolveFeedUrl(result.savedFeeds.Patreon, feedUrls)).toBe(PRIVATE_URL);
		expect(resolveFeedUrl(result.savedFeeds.Patreon, new FeedUrlRepository(api))).toBeNull();
	});
});
