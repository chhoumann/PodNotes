import { describe, expect, it } from "vitest";
import {
	EPISODE_NETWORK_RESOURCE_KINDS,
	FEED_NETWORK_RESOURCE_KINDS,
	MAX_NETWORK_PRIVATE_ORIGINS,
	MAX_NETWORK_TARGET_BYTES,
	NETWORK_RESOURCE_LABELS,
	NetworkCapabilityError,
	createNetworkCapabilityAuthority,
	isNetworkCapabilityResolver,
	type NetworkCapability,
	type NetworkCapabilityScope,
} from "./NetworkCapability";
import type { EpisodeHandle, FeedHandle } from "src/security/resourceHandles";

const feedId = `podnotes-feed-${"1a".repeat(32)}` as FeedHandle;
const otherFeedId = `podnotes-feed-${"2b".repeat(32)}` as FeedHandle;
const episodeId = `podnotes-episode-${"3c".repeat(32)}` as EpisodeHandle;
const otherEpisodeId = `podnotes-episode-${"4d".repeat(32)}` as EpisodeHandle;

const subscriptionScope = Object.freeze({
	resourceKind: "subscription",
	feedId,
} as const);

const streamScope = Object.freeze({
	resourceKind: "episode-stream",
	feedId,
	episodeId,
} as const);

function expectResolutionFailure(
	resolver: ReturnType<typeof createNetworkCapabilityAuthority>["resolver"],
	token: NetworkCapability,
	expectedScope: NetworkCapabilityScope,
): void {
	let thrown: unknown;
	try {
		resolver.resolve(token, expectedScope);
	} catch (error) {
		thrown = error;
	}
	expect(thrown).toBeInstanceOf(NetworkCapabilityError);
	expect((thrown as Error).message).toBe("Network capability is invalid or unavailable.");
}

describe("network capability authority", () => {
	it.each(FEED_NETWORK_RESOURCE_KINDS)(
		"binds the %s resource to its exact feed",
		(resourceKind) => {
			const authority = createNetworkCapabilityAuthority();
			const scope = { resourceKind, feedId } as const;
			const token = authority.issuer.issue(scope, "https://media.example/resource");

			const resolution = authority.resolver.resolve(token, scope);
			expect(resolution).toMatchObject({
				scope,
				target: "https://media.example/resource",
				privateOrigins: [],
				resourceLabel: NETWORK_RESOURCE_LABELS[resourceKind],
			});
			expect(resolution.revocationSignal.aborted).toBe(false);
		},
	);

	it.each(EPISODE_NETWORK_RESOURCE_KINDS)(
		"binds the %s resource to its exact feed and episode",
		(resourceKind) => {
			const authority = createNetworkCapabilityAuthority();
			const scope = { resourceKind, feedId, episodeId } as const;
			const token = authority.issuer.issue(scope, "https://media.example/resource");

			const resolution = authority.resolver.resolve(token, scope);
			expect(resolution).toMatchObject({
				scope,
				target: "https://media.example/resource",
				privateOrigins: [],
				resourceLabel: NETWORK_RESOURCE_LABELS[resourceKind],
			});
			expect(resolution.revocationSignal.aborted).toBe(false);
		},
	);

	it("preserves exact target bytes without URL normalization", () => {
		const authority = createNetworkCapabilityAuthority();
		const target = "HTTPS://Example.COM:443/audio%2fpart.mp3?Signature=A%2BB";
		const token = authority.issuer.issue(streamScope, target);

		expect(authority.resolver.resolve(token, streamScope).target).toBe(target);
	});

	it("copies and freezes every piece of hidden resolution authority", () => {
		const authority = createNetworkCapabilityAuthority();
		const mutableScope = {
			resourceKind: "episode-stream" as const,
			feedId,
			episodeId,
		};
		const privateOrigins = ["https://private.example:8443"];
		const token = authority.issuer.issue(
			mutableScope,
			"https://private.example:8443/audio.mp3",
			privateOrigins,
		);

		mutableScope.feedId = otherFeedId;
		mutableScope.episodeId = otherEpisodeId;
		privateOrigins[0] = "https://changed.example";
		privateOrigins.push("https://extra.example");

		const resolution = authority.resolver.resolve(token, streamScope);
		expect(resolution.scope).toEqual(streamScope);
		expect(resolution.privateOrigins).toEqual(["https://private.example:8443"]);
		expect(Object.isFrozen(resolution)).toBe(true);
		expect(Object.isFrozen(resolution.scope)).toBe(true);
		expect(Object.isFrozen(resolution.privateOrigins)).toBe(true);
		expect(() => {
			(resolution.privateOrigins as string[]).push("https://mutated.example");
		}).toThrow();
		expect(() => {
			Object.assign(resolution.scope, { feedId: otherFeedId });
		}).toThrow();
	});

	it("uses frozen property-free tokens that reveal nothing when serialized", () => {
		const authority = createNetworkCapabilityAuthority();
		const target = "https://secret.example/feed.xml?token=do-not-log";
		const privateOrigin = "https://private.example";
		const token = authority.issuer.issue(subscriptionScope, target, [privateOrigin]);

		expect(Object.isFrozen(token)).toBe(true);
		expect(Object.getPrototypeOf(token)).toBeNull();
		expect(Object.keys(token)).toEqual([]);
		expect(Object.getOwnPropertyNames(token)).toEqual([]);
		expect(Object.getOwnPropertySymbols(token)).toEqual([]);
		expect(Reflect.ownKeys(token)).toEqual([]);
		expect(JSON.stringify(token)).toBe("{}");
		expect(JSON.stringify(token)).not.toContain(target);
		expect(JSON.stringify(token)).not.toContain(privateOrigin);
		expect(() => Object.defineProperty(token, "target", { value: target })).toThrow();
	});

	it("keeps issuer and resolver authority on separate frozen facets", () => {
		const authority = createNetworkCapabilityAuthority();

		expect(Object.isFrozen(authority)).toBe(true);
		expect(Object.isFrozen(authority.issuer)).toBe(true);
		expect(Object.isFrozen(authority.resolver)).toBe(true);
		expect(Object.keys(authority.issuer).sort()).toEqual(["issue", "revoke"]);
		expect(Object.keys(authority.resolver)).toEqual(["resolve"]);
		expect("resolve" in authority.issuer).toBe(false);
		expect("issue" in authority.resolver).toBe(false);
		expect(isNetworkCapabilityResolver(authority.resolver)).toBe(true);
		expect(isNetworkCapabilityResolver({ resolve: authority.resolver.resolve })).toBe(false);
	});

	it("rejects forged, cloned, deserialized, primitive, and cross-authority tokens", () => {
		const first = createNetworkCapabilityAuthority();
		const second = createNetworkCapabilityAuthority();
		const token = first.issuer.issue(subscriptionScope, "https://secret.example/feed.xml");
		const propertyFreeForgery = Object.freeze(Object.create(null) as object);
		const spreadClone = { ...token };
		const deserialized = JSON.parse(JSON.stringify(token)) as unknown;

		for (const candidate of [propertyFreeForgery, spreadClone, deserialized, null, "token"]) {
			expectResolutionFailure(
				first.resolver,
				candidate as NetworkCapability,
				subscriptionScope,
			);
		}
		expectResolutionFailure(second.resolver, token, subscriptionScope);
	});

	it("rejects every cross-scope use before exposing resolution data", () => {
		const authority = createNetworkCapabilityAuthority();
		const target = "https://secret.example/audio.mp3?credential=hidden";
		const token = authority.issuer.issue(streamScope, target);
		const wrongScopes: NetworkCapabilityScope[] = [
			{ resourceKind: "episode-stream", feedId: otherFeedId, episodeId },
			{ resourceKind: "episode-stream", feedId, episodeId: otherEpisodeId },
			{ resourceKind: "episode-chapters", feedId, episodeId },
			{ resourceKind: "subscription", feedId },
		];

		for (const wrongScope of wrongScopes) {
			let thrown: unknown;
			try {
				authority.resolver.resolve(token, wrongScope);
			} catch (error) {
				thrown = error;
			}
			expect(thrown).toBeInstanceOf(NetworkCapabilityError);
			expect((thrown as Error).message).not.toContain(target);
		}
	});

	it("rejects malformed issue and expected scopes without invoking accessors", () => {
		const authority = createNetworkCapabilityAuthority();
		const target = "https://secret.example/feed.xml?credential=hidden";
		let accessorRead = false;
		const accessorScope = {
			feedId,
		} as Record<string, unknown>;
		Object.defineProperty(accessorScope, "resourceKind", {
			enumerable: true,
			get: () => {
				accessorRead = true;
				return "subscription";
			},
		});
		const symbolScope = { ...subscriptionScope, [Symbol("hidden")]: true };
		const prototypeKeyScope = { ...subscriptionScope } as Record<string, unknown>;
		Object.defineProperty(prototypeKeyScope, "__proto__", {
			enumerable: true,
			value: { resourceKind: "subscription", feedId },
		});
		const malformedScopes: unknown[] = [
			{},
			[],
			{ resourceKind: "subscription", feedId: "https://example.com/feed.xml" },
			{ resourceKind: "unknown", feedId },
			{ resourceKind: "subscription", feedId, episodeId },
			{ resourceKind: "episode-stream", feedId },
			{ resourceKind: "episode-stream", feedId, episodeId: "episode-title" },
			{ ...subscriptionScope, extra: true },
			Object.create({ resourceKind: "subscription", feedId }),
			accessorScope,
			symbolScope,
			prototypeKeyScope,
		];

		for (const malformedScope of malformedScopes) {
			expect(() =>
				authority.issuer.issue(malformedScope as NetworkCapabilityScope, target),
			).toThrow(NetworkCapabilityError);
		}
		expect(accessorRead).toBe(false);

		const token = authority.issuer.issue(subscriptionScope, target);
		for (const malformedScope of malformedScopes) {
			let thrown: unknown;
			try {
				authority.resolver.resolve(token, malformedScope as NetworkCapabilityScope);
			} catch (error) {
				thrown = error;
			}
			expect(thrown).toBeInstanceOf(NetworkCapabilityError);
			expect((thrown as Error).message).not.toContain(target);
		}
		expect(accessorRead).toBe(false);
	});

	it.each([
		"",
		" https://example.com/feed.xml",
		"https://example.com/feed.xml ",
		"ftp://example.com/feed.xml",
		"file:///tmp/audio.mp3",
		"not a URL",
		"http:example.com/feed.xml",
		"http:///example.com/feed.xml",
		"https://user:password@example.com/feed.xml",
		"https://@example.com/feed.xml",
		"https://example.com/feed.xml#fragment",
		"https:\\example.com\\feed.xml",
		"https://example.com/a\u0000b",
		"https://example.com/a\u202eb",
		`https://example.com/${"a".repeat(MAX_NETWORK_TARGET_BYTES)}`,
	])("rejects an invalid or unbounded target without echoing it: %s", (target) => {
		const authority = createNetworkCapabilityAuthority();
		let thrown: unknown;
		try {
			authority.issuer.issue(subscriptionScope, target);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(NetworkCapabilityError);
		if (target.length > 0) expect((thrown as Error).message).not.toContain(target);
	});

	it("counts target limits in UTF-8 bytes", () => {
		const authority = createNetworkCapabilityAuthority();
		const oversized = `https://example.com/${"\u{1f680}".repeat(MAX_NETWORK_TARGET_BYTES / 2)}`;

		expect(() => authority.issuer.issue(subscriptionScope, oversized)).toThrow(
			NetworkCapabilityError,
		);
	});

	it.each([
		["trailing slash", ["https://private.example/"]],
		["path", ["https://private.example/path"]],
		["query", ["https://private.example?key=value"]],
		["fragment", ["https://private.example#section"]],
		["credentials", ["https://user:pass@private.example"]],
		["non-http", ["ftp://private.example"]],
		["non-canonical host", ["https://PRIVATE.example"]],
		["duplicate", ["https://private.example", "https://private.example"]],
	])("rejects invalid private origins: %s", (_name, privateOrigins) => {
		const authority = createNetworkCapabilityAuthority();
		expect(() =>
			authority.issuer.issue(
				subscriptionScope,
				"https://example.com/feed.xml",
				privateOrigins,
			),
		).toThrow(NetworkCapabilityError);
	});

	it("rejects sparse, accessor-backed, decorated, and over-limit private-origin arrays", () => {
		const authority = createNetworkCapabilityAuthority();
		const sparse = Array.from<string>({ length: 1 });
		delete sparse[0];
		const accessorBacked: string[] = [];
		Object.defineProperty(accessorBacked, "0", {
			enumerable: true,
			get: () => "https://private.example",
		});
		Object.defineProperty(accessorBacked, "length", { value: 1 });
		const decorated = ["https://private.example"];
		Object.defineProperty(decorated, "extra", { value: true, enumerable: true });
		const tooMany = Array.from(
			{ length: MAX_NETWORK_PRIVATE_ORIGINS + 1 },
			(_, index) => `https://private-${index}.example`,
		);
		const revoked = Proxy.revocable<string[]>([], {});
		revoked.revoke();

		for (const privateOrigins of [sparse, accessorBacked, decorated, tooMany, revoked.proxy]) {
			expect(() =>
				authority.issuer.issue(
					subscriptionScope,
					"https://example.com/feed.xml",
					privateOrigins,
				),
			).toThrow(NetworkCapabilityError);
		}
	});

	it("revokes individual tokens and disposes the complete authority", () => {
		const authority = createNetworkCapabilityAuthority();
		const first = authority.issuer.issue(subscriptionScope, "https://example.com/feed.xml");
		const second = authority.issuer.issue(streamScope, "https://example.com/audio.mp3");
		const firstSignal = authority.resolver.resolve(first, subscriptionScope).revocationSignal;
		const secondResolution = authority.resolver.resolve(second, streamScope);
		const secondSignal = secondResolution.revocationSignal;
		const authoritySignal = secondResolution.authoritySignal;

		expect(authority.issuer.revoke(first)).toBe(true);
		expect(firstSignal.aborted).toBe(true);
		expect(secondSignal.aborted).toBe(false);
		expect(authoritySignal.aborted).toBe(false);
		expect(authority.issuer.revoke(first)).toBe(false);
		expect(authority.issuer.revoke(Object.freeze({}))).toBe(false);
		expectResolutionFailure(authority.resolver, first, subscriptionScope);
		expect(authority.resolver.resolve(second, streamScope).target).toBe(
			"https://example.com/audio.mp3",
		);

		authority.dispose();
		expect(secondSignal.aborted).toBe(false);
		expect(authoritySignal.aborted).toBe(true);
		expectResolutionFailure(authority.resolver, second, streamScope);
		expect(authority.issuer.revoke(second)).toBe(false);
		expect(() =>
			authority.issuer.issue(subscriptionScope, "https://example.com/new.xml"),
		).toThrow(NetworkCapabilityError);
	});

	it("never derives resource labels from targets, origins, titles, or handles", () => {
		const authority = createNetworkCapabilityAuthority();
		const target = "https://sensitive.example/private-feed-name.xml";
		const origin = "https://sensitive.example";
		const token = authority.issuer.issue(subscriptionScope, target, [origin]);
		const { resourceLabel } = authority.resolver.resolve(token, subscriptionScope);

		expect(resourceLabel).toBe("podcast subscription");
		expect(resourceLabel).not.toContain(target);
		expect(resourceLabel).not.toContain(origin);
		expect(resourceLabel).not.toContain(feedId);
	});
});
