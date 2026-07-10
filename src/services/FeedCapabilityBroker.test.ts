import { describe, expect, it, vi } from "vitest";

import type { PinnedNetworkHopRequest } from "src/network/CapabilityScopedTransport";
import {
	NetworkCapabilityError,
	type EpisodeNetworkResourceKind,
	type FeedNetworkResourceKind,
	type NetworkCapabilityScope,
} from "src/network/NetworkCapability";
import { NetworkScheduler } from "src/network/NetworkScheduler";
import { feedCapabilityReferenceForAttempt } from "src/security/feedCapabilityReferences";
import type { EpisodeHandle, FeedHandle } from "src/security/resourceHandles";
import {
	TARGET_ENVELOPE_SCHEMA_VERSION,
	type EpisodeResourcesEnvelope,
	type FeedCapabilityEnvelope,
} from "src/security/targetEnvelopes";

import {
	createFeedCapabilityNetworkRuntime,
	type CapabilityUseContext,
	type FeedCapabilityNetworkRuntime,
	type FeedCapabilityReader,
} from "./FeedCapabilityBroker";

const feedId = `podnotes-feed-${"1a".repeat(32)}` as FeedHandle;
const otherFeedId = `podnotes-feed-${"2b".repeat(32)}` as FeedHandle;
const episodeId = `podnotes-episode-${"3c".repeat(32)}` as EpisodeHandle;
const otherEpisodeId = `podnotes-episode-${"4d".repeat(32)}` as EpisodeHandle;
const reference = feedCapabilityReferenceForAttempt(feedId, 1)!;
const foreignReference = feedCapabilityReferenceForAttempt(otherFeedId, 1)!;
const encoder = new TextEncoder();

const targets = Object.freeze({
	subscription: "HTTPS://Feeds.Example.COM:443/feed%2fmain.xml?Signature=A%2BB",
	"feed-artwork": "https://cdn.example.com/feed.jpg?signature=feed",
	site: "https://www.example.com/podcast",
	"episode-stream": "https://media.example.com/audio%2fepisode.mp3?Signature=C%2BD",
	"episode-chapters": "https://media.example.com/chapters.json?signature=chapters",
	"episode-artwork": "https://cdn.example.com/episode.jpg?signature=episode",
	"episode-item-link": "https://www.example.com/episodes/one?signature=item",
});

const grants = Object.freeze({
	subscription: ["http://10.0.0.1:8001"],
	"feed-artwork": ["http://10.0.0.2:8002"],
	site: ["http://10.0.0.3:8003"],
	"episode-stream": ["http://10.0.0.4:8004"],
	"episode-chapters": ["http://10.0.0.5:8005"],
	"episode-artwork": ["http://10.0.0.6:8006"],
	"episode-item-link": ["http://10.0.0.7:8007"],
});

function episodeResources(id: EpisodeHandle = episodeId): EpisodeResourcesEnvelope {
	return {
		schemaVersion: TARGET_ENVELOPE_SCHEMA_VERSION,
		kind: "episode-resources" as const,
		feedId,
		episodeId: id,
		streamUrl: targets["episode-stream"],
		chaptersUrl: targets["episode-chapters"],
		artworkUrl: targets["episode-artwork"],
		itemLink: targets["episode-item-link"],
		guid: `guid-${id}`,
	};
}

function episodeResourceMap(
	...resources: EpisodeResourcesEnvelope[]
): FeedCapabilityEnvelope["episodeResources"] {
	const result: Partial<Record<EpisodeHandle, EpisodeResourcesEnvelope>> = {};
	for (const resource of resources) result[resource.episodeId] = resource;
	return result;
}

function envelope(overrides: Partial<FeedCapabilityEnvelope> = {}): FeedCapabilityEnvelope {
	return {
		schemaVersion: TARGET_ENVELOPE_SCHEMA_VERSION,
		kind: "feed-capability-bundle",
		feedId,
		subscriptionUrl: targets.subscription,
		artworkUrl: targets["feed-artwork"],
		siteUrl: targets.site,
		privateGrants: grants,
		episodeResources: episodeResourceMap(episodeResources()),
		...overrides,
	};
}

function readerWith(result: unknown): FeedCapabilityReader & {
	readFeedCapabilities: ReturnType<typeof vi.fn>;
} {
	return { readFeedCapabilities: vi.fn().mockResolvedValue(result) };
}

function availableReader(value: FeedCapabilityEnvelope = envelope()) {
	return readerWith({ status: "available", value });
}

function deferred<Value>(): {
	readonly promise: Promise<Value>;
	readonly resolve: (value: Value) => void;
} {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

async function* bytesBody(value = "ok"): AsyncIterable<Uint8Array> {
	yield encoder.encode(value);
}

function makeRuntime(
	reader: FeedCapabilityReader = availableReader(),
	adapterImplementation?: (request: PinnedNetworkHopRequest) => unknown,
): {
	runtime: FeedCapabilityNetworkRuntime;
	requests: PinnedNetworkHopRequest[];
} {
	const requests: PinnedNetworkHopRequest[] = [];
	const runtime = createFeedCapabilityNetworkRuntime(
		reader,
		() => ["93.184.216.34"],
		(request) => {
			requests.push(request);
			if (adapterImplementation) return adapterImplementation(request) as never;
			return {
				status: 200,
				body: bytesBody(),
				connectedAddress: request.connectAddress,
				close: () => undefined,
			};
		},
		new NetworkScheduler(),
	);
	return { runtime, requests };
}

async function useFeedBytes(
	runtime: FeedCapabilityNetworkRuntime,
	resourceKind: FeedNetworkResourceKind,
) {
	return runtime.broker.withFeedResource(
		feedId,
		reference,
		resourceKind,
		({ capability, scope }) => runtime.transport.getBytes(capability, scope),
	);
}

async function useEpisodeBytes(
	runtime: FeedCapabilityNetworkRuntime,
	resourceKind: Exclude<EpisodeNetworkResourceKind, "episode-stream">,
	episode = episodeId,
) {
	return runtime.broker.withEpisodeResource(
		feedId,
		episode,
		reference,
		resourceKind,
		({ capability, scope }) => runtime.transport.getBytes(capability, scope),
	);
}

describe("FeedCapabilityBroker", () => {
	it.each([
		["subscription", "feeds.example.com", "/feed%2fmain.xml?Signature=A%2BB"],
		["feed-artwork", "cdn.example.com", "/feed.jpg?signature=feed"],
		["site", "www.example.com", "/podcast"],
	] as const)(
		"executes only the %s feed target through the trapped transport",
		async (resourceKind, hostHeader, requestTarget) => {
			const reader = availableReader();
			const { runtime, requests } = makeRuntime(reader);

			const result = await useFeedBytes(runtime, resourceKind);

			expect(result).toMatchObject({ status: "available" });
			expect(requests).toHaveLength(1);
			expect(requests[0]).toMatchObject({ hostHeader, requestTarget });
			expect(reader.readFeedCapabilities).toHaveBeenCalledOnce();
			expect(reader.readFeedCapabilities).toHaveBeenCalledWith(feedId, reference);
			runtime.dispose();
		},
	);

	it.each([
		["episode-chapters", "media.example.com", "/chapters.json?signature=chapters"],
		["episode-artwork", "cdn.example.com", "/episode.jpg?signature=episode"],
		["episode-item-link", "www.example.com", "/episodes/one?signature=item"],
	] as const)(
		"executes only the %s episode target through the trapped transport",
		async (resourceKind, hostHeader, requestTarget) => {
			const reader = availableReader();
			const { runtime, requests } = makeRuntime(reader);

			const result = await useEpisodeBytes(runtime, resourceKind);

			expect(result).toMatchObject({ status: "available" });
			expect(requests).toHaveLength(1);
			expect(requests[0]).toMatchObject({ hostHeader, requestTarget });
			expect(reader.readFeedCapabilities).toHaveBeenCalledOnce();
			runtime.dispose();
		},
	);

	it("selects the episode-stream field but never buffers it", async () => {
		const unsafeStream = "https://user:password@secret.example/audio.mp3?token=raw";
		const streamEnvelope = envelope({
			episodeResources: episodeResourceMap({
				...episodeResources(),
				streamUrl: unsafeStream,
			}),
		});
		const operation = vi.fn();
		const { runtime, requests } = makeRuntime(availableReader(streamEnvelope));

		const error = await runtime.broker
			.withEpisodeResource(feedId, episodeId, reference, "episode-stream", operation)
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NetworkCapabilityError);
		expect(String(error)).not.toContain(unsafeStream);
		expect(operation).not.toHaveBeenCalled();
		expect(requests).toEqual([]);
		runtime.dispose();
	});

	it("applies private grants only to their matching resource kind", async () => {
		const privateTarget = "http://192.168.1.10:8080/resource";
		const privateEnvelope = envelope({
			subscriptionUrl: privateTarget,
			artworkUrl: privateTarget,
			privateGrants: { subscription: ["http://192.168.1.10:8080"] },
		});
		const { runtime, requests } = makeRuntime(availableReader(privateEnvelope));

		await expect(useFeedBytes(runtime, "subscription")).resolves.toMatchObject({
			status: "available",
		});
		await expect(useFeedBytes(runtime, "feed-artwork")).rejects.toMatchObject({
			code: "NETWORK_TARGET_REJECTED",
		});
		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({
			connectAddress: "192.168.1.10",
			hostHeader: "192.168.1.10:8080",
		});
		runtime.dispose();
	});

	it("traps issuer and resolver authority behind a factory-only runtime", async () => {
		const module = await import("./FeedCapabilityBroker");
		const { runtime } = makeRuntime();

		expect(module).not.toHaveProperty("FeedCapabilityBroker");
		expect(Object.keys(runtime).sort()).toEqual(["broker", "dispose", "transport"]);
		expect(runtime).not.toHaveProperty("issuer");
		expect(runtime).not.toHaveProperty("resolver");
		expect(Object.keys(runtime.broker)).toEqual([]);
		expect(Object.getPrototypeOf(runtime.broker)).toBeNull();
		expect(Reflect.get(runtime.broker, "constructor")).toBeUndefined();
		expect(Reflect.get(runtime.broker, "dispose")).toBeUndefined();
		expect(Object.getPrototypeOf(runtime.transport)).toBeNull();
		expect(Reflect.get(runtime.transport, "dispose")).toBeUndefined();
		expect(Object.isFrozen(runtime)).toBe(true);
		expect(Object.isFrozen(runtime.broker)).toBe(true);
		expect(Object.isFrozen(runtime.transport)).toBe(true);
		runtime.dispose();
	});

	it("cancels a feed lease while its repository read is still pending", async () => {
		const read = deferred<unknown>();
		const reader: FeedCapabilityReader & {
			readFeedCapabilities: ReturnType<typeof vi.fn>;
		} = { readFeedCapabilities: vi.fn().mockReturnValue(read.promise) };
		const operation = vi.fn();
		const { runtime, requests } = makeRuntime(reader);

		const pending = runtime.broker.withFeedResource(
			feedId,
			reference,
			"subscription",
			operation,
		);
		await vi.waitFor(() => expect(reader.readFeedCapabilities).toHaveBeenCalledOnce());

		expect(runtime.broker.invalidateFeed(feedId)).toBe(0);
		await expect(pending).resolves.toEqual({ status: "unavailable" });
		read.resolve({ status: "available", value: envelope() });
		await Promise.resolve();
		expect(operation).not.toHaveBeenCalled();
		expect(requests).toEqual([]);
		runtime.dispose();
	});

	it("cancels an episode lease while its repository read is still pending", async () => {
		const read = deferred<unknown>();
		const reader: FeedCapabilityReader & {
			readFeedCapabilities: ReturnType<typeof vi.fn>;
		} = { readFeedCapabilities: vi.fn().mockReturnValue(read.promise) };
		const operation = vi.fn();
		const { runtime, requests } = makeRuntime(reader);

		const pending = runtime.broker.withEpisodeResource(
			feedId,
			episodeId,
			reference,
			"episode-chapters",
			operation,
		);
		await vi.waitFor(() => expect(reader.readFeedCapabilities).toHaveBeenCalledOnce());

		expect(runtime.broker.invalidateEpisode(feedId, episodeId)).toBe(0);
		await expect(pending).resolves.toEqual({ status: "unavailable" });
		read.resolve({ status: "available", value: envelope() });
		await Promise.resolve();
		expect(operation).not.toHaveBeenCalled();
		expect(requests).toEqual([]);
		runtime.dispose();
	});

	it("revokes a retained capability as soon as its operation settles", async () => {
		const { runtime } = makeRuntime();
		let retained: CapabilityUseContext<NetworkCapabilityScope> | undefined;

		const result = await runtime.broker.withFeedResource(
			feedId,
			reference,
			"subscription",
			(context) => {
				retained = context as CapabilityUseContext<NetworkCapabilityScope>;
				expect(Object.isFrozen(context)).toBe(true);
				expect(Object.isFrozen(context.scope)).toBe(true);
				expect(JSON.stringify(context)).not.toContain(targets.subscription);
				return "complete";
			},
		);

		expect(result).toEqual({ status: "available", value: "complete" });
		expect(retained).toBeDefined();
		await expect(
			runtime.transport.getBytes(retained!.capability, retained!.scope),
		).rejects.toBeInstanceOf(NetworkCapabilityError);
		runtime.dispose();
	});

	it("revokes a retained capability when its operation throws", async () => {
		const { runtime } = makeRuntime();
		let retained: CapabilityUseContext<NetworkCapabilityScope> | undefined;
		const sentinel = new Error("consumer failed");

		await expect(
			runtime.broker.withFeedResource(feedId, reference, "subscription", (context) => {
				retained = context as CapabilityUseContext<NetworkCapabilityScope>;
				throw sentinel;
			}),
		).rejects.toBe(sentinel);
		await expect(
			runtime.transport.getBytes(retained!.capability, retained!.scope),
		).rejects.toBeInstanceOf(NetworkCapabilityError);
		runtime.dispose();
	});

	it("invalidates active feed capabilities and suppresses their late result", async () => {
		const { runtime } = makeRuntime();
		let resolveOperation!: () => void;
		const operationGate = new Promise<void>((resolve) => {
			resolveOperation = resolve;
		});
		let retained: CapabilityUseContext<NetworkCapabilityScope> | undefined;
		const pending = runtime.broker.withFeedResource(
			feedId,
			reference,
			"subscription",
			async (context) => {
				retained = context as CapabilityUseContext<NetworkCapabilityScope>;
				await operationGate;
				return "late";
			},
		);
		await vi.waitFor(() => expect(retained).toBeDefined());

		expect(runtime.broker.invalidateFeed(feedId)).toBe(1);
		resolveOperation();
		await expect(pending).resolves.toEqual({ status: "unavailable" });
		await expect(
			runtime.transport.getBytes(retained!.capability, retained!.scope),
		).rejects.toBeInstanceOf(NetworkCapabilityError);
		expect(runtime.broker.invalidateFeed(feedId)).toBe(0);
		runtime.dispose();
	});

	it("settles invalidated work even when its callback never cooperates", async () => {
		const { runtime } = makeRuntime();
		let retained: CapabilityUseContext<NetworkCapabilityScope> | undefined;
		const never = new Promise<never>(() => undefined);
		const pending = runtime.broker.withFeedResource(
			feedId,
			reference,
			"subscription",
			(context) => {
				retained = context as CapabilityUseContext<NetworkCapabilityScope>;
				return never;
			},
		);
		await vi.waitFor(() => expect(retained).toBeDefined());

		expect(runtime.broker.invalidateFeed(feedId)).toBe(1);
		await expect(pending).resolves.toEqual({ status: "unavailable" });
		await expect(
			runtime.transport.getBytes(retained!.capability, retained!.scope),
		).rejects.toBeInstanceOf(NetworkCapabilityError);
		runtime.dispose();
	});

	it("suppresses a real transport rejection caused by revocation", async () => {
		const { runtime, requests } = makeRuntime(availableReader(), (request) => ({
			status: 200,
			body: (async function* () {
				yield encoder.encode("partial");
				await new Promise<void>((resolve) => {
					request.signal.addEventListener("abort", () => resolve(), { once: true });
				});
				throw new Error("adapter aborted");
			})(),
			connectedAddress: request.connectAddress,
			close: () => undefined,
		}));
		const pending = useFeedBytes(runtime, "subscription");
		await vi.waitFor(() => expect(requests).toHaveLength(1));

		expect(runtime.broker.invalidateFeed(feedId)).toBe(1);
		await expect(pending).resolves.toEqual({ status: "unavailable" });
		runtime.dispose();
	});

	it("invalidates only the selected episode and leaves other work available", async () => {
		const twoEpisodes = envelope({
			episodeResources: episodeResourceMap(
				episodeResources(),
				episodeResources(otherEpisodeId),
			),
		});
		const { runtime } = makeRuntime(availableReader(twoEpisodes));
		let resolveFirst!: () => void;
		let resolveSecond!: () => void;
		let firstStarted = false;
		let secondStarted = false;
		const firstGate = new Promise<void>((resolve) => (resolveFirst = resolve));
		const secondGate = new Promise<void>((resolve) => (resolveSecond = resolve));
		const first = runtime.broker.withEpisodeResource(
			feedId,
			episodeId,
			reference,
			"episode-chapters",
			async () => {
				firstStarted = true;
				await firstGate;
				return "first";
			},
		);
		const second = runtime.broker.withEpisodeResource(
			feedId,
			otherEpisodeId,
			reference,
			"episode-chapters",
			async () => {
				secondStarted = true;
				await secondGate;
				return "second";
			},
		);
		await vi.waitFor(() => {
			expect(firstStarted).toBe(true);
			expect(secondStarted).toBe(true);
		});
		expect(runtime.broker.invalidateEpisode(feedId, episodeId)).toBe(1);

		resolveFirst();
		resolveSecond();
		await expect(first).resolves.toEqual({ status: "unavailable" });
		await expect(second).resolves.toEqual({ status: "available", value: "second" });
		runtime.dispose();
	});

	it("disposal revokes active work, suppresses late values, and rejects new reads", async () => {
		const reader = availableReader();
		const { runtime } = makeRuntime(reader);
		let resolveOperation!: () => void;
		let operationStarted = false;
		const operationGate = new Promise<void>((resolve) => (resolveOperation = resolve));
		const pending = runtime.broker.withFeedResource(
			feedId,
			reference,
			"subscription",
			async () => {
				operationStarted = true;
				await operationGate;
				return "late";
			},
		);
		await vi.waitFor(() => expect(operationStarted).toBe(true));

		runtime.dispose();
		runtime.dispose();
		resolveOperation();
		await expect(pending).resolves.toEqual({ status: "unavailable" });
		expect(runtime.broker.isDisposed()).toBe(true);
		const callsBefore = reader.readFeedCapabilities.mock.calls.length;
		await expect(
			runtime.broker.withFeedResource(feedId, reference, "subscription", () => "never"),
		).resolves.toEqual({ status: "unavailable" });
		expect(reader.readFeedCapabilities).toHaveBeenCalledTimes(callsBefore);
	});

	it("returns missing without starting an operation for absent resources", async () => {
		const noOptionalTargets = envelope({
			episodeResources: episodeResourceMap({
				...episodeResources(),
				chaptersUrl: undefined,
			}),
		});
		delete noOptionalTargets.artworkUrl;
		delete noOptionalTargets.episodeResources[episodeId]!.chaptersUrl;
		const operation = vi.fn();
		const { runtime } = makeRuntime(availableReader(noOptionalTargets));

		await expect(
			runtime.broker.withFeedResource(feedId, reference, "feed-artwork", operation),
		).resolves.toEqual({ status: "missing" });
		await expect(
			runtime.broker.withEpisodeResource(
				feedId,
				episodeId,
				reference,
				"episode-chapters",
				operation,
			),
		).resolves.toEqual({ status: "missing" });
		await expect(
			runtime.broker.withEpisodeResource(
				feedId,
				otherEpisodeId,
				reference,
				"episode-stream",
				operation,
			),
		).resolves.toEqual({ status: "missing" });
		expect(operation).not.toHaveBeenCalled();
		runtime.dispose();
	});

	it.each(["missing", "invalid", "unavailable"] as const)(
		"preserves reader %s status without starting an operation",
		async (status) => {
			const operation = vi.fn();
			const { runtime } = makeRuntime(readerWith({ status }));
			await expect(
				runtime.broker.withFeedResource(feedId, reference, "subscription", operation),
			).resolves.toEqual({ status });
			expect(operation).not.toHaveBeenCalled();
			runtime.dispose();
		},
	);

	it("rejects invalid handles, kinds, references, operations, and cross-feed data", async () => {
		const reader = availableReader();
		const { runtime } = makeRuntime(reader);
		const operation = vi.fn();
		await expect(
			runtime.broker.withFeedResource("not-a-feed", reference, "subscription", operation),
		).resolves.toEqual({ status: "invalid" });
		await expect(
			runtime.broker.withFeedResource(feedId, foreignReference, "subscription", operation),
		).resolves.toEqual({ status: "invalid" });
		await expect(
			runtime.broker.withFeedResource(
				feedId,
				reference,
				"episode-stream" as FeedNetworkResourceKind,
				operation,
			),
		).resolves.toEqual({ status: "invalid" });
		await expect(
			runtime.broker.withEpisodeResource(
				feedId,
				"not-an-episode",
				reference,
				"episode-stream",
				operation,
			),
		).resolves.toEqual({ status: "invalid" });
		await expect(
			runtime.broker.withEpisodeResource(
				feedId,
				episodeId,
				reference,
				"subscription" as EpisodeNetworkResourceKind,
				operation,
			),
		).resolves.toEqual({ status: "invalid" });
		await expect(
			runtime.broker.withFeedResource(feedId, reference, "subscription", null as never),
		).resolves.toEqual({ status: "invalid" });
		expect(reader.readFeedCapabilities).not.toHaveBeenCalled();
		runtime.dispose();

		const crossFeedReader = availableReader(envelope({ feedId: otherFeedId }));
		const crossFeed = makeRuntime(crossFeedReader).runtime;
		await expect(
			crossFeed.broker.withFeedResource(feedId, reference, "subscription", operation),
		).resolves.toEqual({ status: "invalid" });
		crossFeed.dispose();
	});

	it("sanitizes reader throws, accessors, proxies, and malformed result shapes", async () => {
		const sentinel = "https://secret.example/feed?token=do-not-log";
		const operation = vi.fn();
		const throwingReader: FeedCapabilityReader = {
			readFeedCapabilities: vi.fn().mockRejectedValue(new Error(sentinel)),
		};
		const throwing = makeRuntime(throwingReader).runtime;
		await expect(
			throwing.broker.withFeedResource(feedId, reference, "subscription", operation),
		).resolves.toEqual({ status: "unavailable" });
		throwing.dispose();

		let getterRead = false;
		const accessorResult = {};
		Object.defineProperty(accessorResult, "status", {
			enumerable: true,
			get: () => {
				getterRead = true;
				throw new Error(sentinel);
			},
		});
		const accessor = makeRuntime(readerWith(accessorResult)).runtime;
		await expect(
			accessor.broker.withFeedResource(feedId, reference, "subscription", operation),
		).resolves.toEqual({ status: "invalid" });
		expect(getterRead).toBe(false);
		accessor.dispose();

		const proxy = makeRuntime(
			readerWith(
				new Proxy(
					{},
					{
						ownKeys: () => {
							throw new Error(sentinel);
						},
					},
				),
			),
		).runtime;
		await expect(
			proxy.broker.withFeedResource(feedId, reference, "subscription", operation),
		).resolves.toEqual({ status: "invalid" });
		proxy.dispose();
	});
});
