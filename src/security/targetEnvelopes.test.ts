import { describe, expect, it } from "vitest";
import type { EpisodeHandle, FeedHandle } from "./resourceHandles";
import {
	MAX_EPISODE_RESOURCES_PER_FEED,
	MAX_FEED_CAPABILITY_METADATA_BYTES,
	MAX_FEED_CAPABILITY_ENVELOPE_BYTES,
	MAX_PRIVATE_GRANTS_PER_KIND,
	MAX_TARGET_URL_BYTES,
	validateEpisodeResourcesEnvelope,
	validateFeedCapabilityEnvelope,
} from "./targetEnvelopes";

const feedId = `podnotes-feed-${"11".repeat(32)}` as FeedHandle;
const otherFeedId = `podnotes-feed-${"22".repeat(32)}` as FeedHandle;
const episodeId = `podnotes-episode-${"33".repeat(32)}` as EpisodeHandle;
const otherEpisodeId = `podnotes-episode-${"44".repeat(32)}` as EpisodeHandle;

function episodeResources(id: EpisodeHandle = episodeId) {
	return {
		schemaVersion: 1 as const,
		kind: "episode-resources" as const,
		feedId,
		episodeId: id,
		streamUrl: "https://media.example.com/audio.mp3?signature=value",
	};
}

function feedBundle() {
	return {
		schemaVersion: 1 as const,
		kind: "feed-capability-bundle" as const,
		feedId,
		subscriptionUrl: "https://listener:secret@example.com/feed.xml?token=value",
		episodeResources: { [episodeId]: episodeResources() },
	};
}

describe("feed capability bundles", () => {
	it("validates a complete bundle without rewriting exact target bytes", () => {
		const subscriptionUrl =
			"HTTPS://listener:secret@Example.com:443/feed%2fraw.xml?X-Amz-Signature=AbC%2f123";
		const result = validateFeedCapabilityEnvelope(
			{
				...feedBundle(),
				subscriptionUrl,
				artworkUrl: "https://cdn.example.com/image.jpg",
				siteUrl: "https://example.com/show",
				guid: "podcast:channel:opaque-guid",
				privateGrants: {
					"episode-stream": ["http://192.168.1.4:8080"],
					"episode-artwork": ["https://private.example.com"],
				},
			},
			feedId,
		);

		expect(result).toEqual({
			schemaVersion: 1,
			kind: "feed-capability-bundle",
			feedId,
			subscriptionUrl,
			artworkUrl: "https://cdn.example.com/image.jpg",
			siteUrl: "https://example.com/show",
			guid: "podcast:channel:opaque-guid",
			privateGrants: {
				"episode-stream": ["http://192.168.1.4:8080"],
				"episode-artwork": ["https://private.example.com"],
			},
			episodeResources: { [episodeId]: episodeResources() },
		});
	});

	it.each(["ftp://example.com/feed", "file:///tmp/feed.xml", "data:text/plain,feed", "nope"])(
		"rejects a non-http target: %s",
		(subscriptionUrl) => {
			expect(validateFeedCapabilityEnvelope({ ...feedBundle(), subscriptionUrl })).toBeNull();
		},
	);

	it("rejects wrong-object binding, extra fields, and malformed grants", () => {
		const base = feedBundle();

		expect(validateFeedCapabilityEnvelope(base, otherFeedId)).toBeNull();
		expect(validateFeedCapabilityEnvelope({ ...base, unexpected: true })).toBeNull();
		expect(
			validateFeedCapabilityEnvelope({
				...base,
				privateGrants: { unknown: ["https://example.com"] },
			}),
		).toBeNull();
		expect(
			validateFeedCapabilityEnvelope({
				...base,
				privateGrants: { "episode-stream": ["https://example.com/private/path"] },
			}),
		).toBeNull();
		const sparse: string[] = [];
		sparse.length = 1;
		expect(
			validateFeedCapabilityEnvelope({
				...base,
				privateGrants: { "episode-stream": sparse },
			}),
		).toBeNull();
	});

	it("fails closed for unsupported versions and hostile objects", () => {
		const hostile = new Proxy(feedBundle(), {
			get() {
				throw new Error("hostile getter");
			},
		});

		expect(validateFeedCapabilityEnvelope({ ...feedBundle(), schemaVersion: 2 })).toBeNull();
		expect(validateFeedCapabilityEnvelope(hostile)).toBeNull();
	});

	it("preserves bounded channel GUID evidence without imposing uniqueness", () => {
		const guid = "podcast:channel:opaque%2fGUID";

		expect(validateFeedCapabilityEnvelope({ ...feedBundle(), guid })?.guid).toBe(guid);
		expect(validateFeedCapabilityEnvelope({ ...feedBundle(), guid: "" })).toBeNull();
	});

	it("requires every episode record key and value to bind to the same feed and episode", () => {
		const base = feedBundle();

		expect(
			validateFeedCapabilityEnvelope({
				...base,
				episodeResources: { [otherEpisodeId]: episodeResources() },
			}),
		).toBeNull();
		expect(
			validateFeedCapabilityEnvelope({
				...base,
				episodeResources: {
					[episodeId]: { ...episodeResources(), feedId: otherFeedId },
				},
			}),
		).toBeNull();
	});

	it("bounds URLs, private-grant arrays, episode count, and serialized bundle size", () => {
		const base = feedBundle();
		const oversizedUrl = `https://example.com/${"a".repeat(MAX_TARGET_URL_BYTES)}`;
		const tooManyGrants = Array.from(
			{ length: MAX_PRIVATE_GRANTS_PER_KIND + 1 },
			(_, index) => `https://private-${index}.example.com`,
		);
		const tooManyEpisodes = Object.fromEntries(
			Array.from({ length: MAX_EPISODE_RESOURCES_PER_FEED + 1 }, (_, index) => {
				const id =
					`podnotes-episode-${index.toString(16).padStart(64, "0")}` as EpisodeHandle;
				return [id, episodeResources(id)];
			}),
		);
		const oversizedBundleEpisodes = Object.fromEntries(
			Array.from({ length: 72 }, (_, index) => {
				const id =
					`podnotes-episode-${(index + 1000).toString(16).padStart(64, "0")}` as EpisodeHandle;
				return [
					id,
					{
						...episodeResources(id),
						streamUrl: `https://media.example.com/${"a".repeat(15_000)}${index}`,
					},
				];
			}),
		);

		expect(validateFeedCapabilityEnvelope({ ...base, artworkUrl: oversizedUrl })).toBeNull();
		expect(
			validateFeedCapabilityEnvelope({
				...base,
				privateGrants: { "episode-stream": tooManyGrants },
			}),
		).toBeNull();
		expect(
			validateFeedCapabilityEnvelope({ ...base, episodeResources: tooManyEpisodes }),
		).toBeNull();
		expect(
			validateFeedCapabilityEnvelope({ ...base, episodeResources: oversizedBundleEpisodes }),
		).toBeNull();
		expect(MAX_FEED_CAPABILITY_ENVELOPE_BYTES).toBe(1024 * 1024);
	});

	it("independently bounds feed-level capability metadata", () => {
		const longTarget = `https://example.com/${"a".repeat(15_000)}`;
		const origins = Array.from({ length: 16 }, (_, index) => {
			const label = `${index.toString(36)}${"a".repeat(60)}`;
			return `https://${label}.${"b".repeat(63)}.${"c".repeat(63)}.example`;
		});
		const privateGrants = Object.fromEntries(
			[
				"subscription",
				"feed-artwork",
				"site",
				"episode-stream",
				"episode-chapters",
				"episode-artwork",
				"episode-item-link",
			].map((kind) => [kind, origins]),
		);

		expect(
			validateFeedCapabilityEnvelope({
				...feedBundle(),
				subscriptionUrl: longTarget,
				artworkUrl: longTarget,
				siteUrl: longTarget,
				guid: "g".repeat(7000),
				privateGrants,
			}),
		).toBeNull();
		expect(MAX_FEED_CAPABILITY_METADATA_BYTES).toBe(64 * 1024);
	});
});

describe("episode resource envelopes", () => {
	it("validates a complete v1 entry and exact object binding", () => {
		const streamUrl = "HTTPS://Media.Example.com:443/audio%2fraw.mp3?X-Amz-Signature=AbC%2f123";
		expect(
			validateEpisodeResourcesEnvelope(
				{
					...episodeResources(),
					streamUrl,
					chaptersUrl: "https://example.com/chapters.json",
					artworkUrl: "https://example.com/art.jpg",
					itemLink: "https://example.com/episode",
					guid: "opaque-guid-value",
				},
				feedId,
				episodeId,
			),
		).toEqual({
			schemaVersion: 1,
			kind: "episode-resources",
			feedId,
			episodeId,
			streamUrl,
			chaptersUrl: "https://example.com/chapters.json",
			artworkUrl: "https://example.com/art.jpg",
			itemLink: "https://example.com/episode",
			guid: "opaque-guid-value",
		});
	});

	it("rejects cross-feed, cross-episode, non-http, empty GUID, and extra fields", () => {
		const base = episodeResources();

		expect(validateEpisodeResourcesEnvelope(base, otherFeedId, episodeId)).toBeNull();
		expect(validateEpisodeResourcesEnvelope(base, feedId, otherEpisodeId)).toBeNull();
		expect(validateEpisodeResourcesEnvelope({ ...base, streamUrl: "blob:value" })).toBeNull();
		expect(validateEpisodeResourcesEnvelope({ ...base, guid: "" })).toBeNull();
		expect(
			validateEpisodeResourcesEnvelope({ ...base, url: "https://legacy.example" }),
		).toBeNull();
	});

	it("preserves durable nonplayable episodes with evidence but no stream URL", () => {
		const base = episodeResources();
		const { streamUrl, ...withoutStream } = base;

		expect(streamUrl).toBe(base.streamUrl);
		expect(validateEpisodeResourcesEnvelope({ ...withoutStream, guid: "opaque-guid" })).toEqual(
			{ ...withoutStream, guid: "opaque-guid" },
		);
		expect(validateEpisodeResourcesEnvelope(withoutStream)).toBeNull();
	});

	it("fails closed for unsupported versions and hostile objects", () => {
		const hostile = new Proxy(episodeResources(), {
			get() {
				throw new Error("hostile getter");
			},
		});

		expect(
			validateEpisodeResourcesEnvelope({ ...episodeResources(), schemaVersion: 2 }),
		).toBeNull();
		expect(validateEpisodeResourcesEnvelope(hostile)).toBeNull();
	});
});
