import { describe, expect, it, vi } from "vitest";
import {
	CAPABILITY_TRANSPORT_ERROR_CODES,
	CapabilityScopedTransport,
	CapabilityTransportError,
	createCapabilityScopedNetworkRuntime,
	MAX_BUFFERED_NETWORK_CHUNKS,
	MAX_NETWORK_REDIRECTS,
	MAX_NETWORK_RESOLVED_ADDRESSES,
	NETWORK_BUFFERED_RESOURCE_POLICIES,
	type NetworkNameResolver,
	type PinnedNetworkHopAdapter,
	type PinnedNetworkHopRequest,
	type PinnedNetworkHopResponse,
} from "./CapabilityScopedTransport";
import {
	NetworkCapabilityError,
	createNetworkCapabilityAuthority,
	type NetworkCapability,
	type NetworkCapabilityScope,
} from "./NetworkCapability";
import { NetworkDisposedError } from "./NetworkErrors";
import { NetworkScheduler } from "./NetworkScheduler";
import type { EpisodeHandle, FeedHandle } from "src/security/resourceHandles";

const feedId = `podnotes-feed-${"1a".repeat(32)}` as FeedHandle;
const episodeId = `podnotes-episode-${"2b".repeat(32)}` as EpisodeHandle;
const subscriptionScope = Object.freeze({ resourceKind: "subscription", feedId } as const);
const feedArtworkScope = Object.freeze({ resourceKind: "feed-artwork", feedId } as const);
const streamScope = Object.freeze({
	resourceKind: "episode-stream",
	feedId,
	episodeId,
} as const);
const encoder = new TextEncoder();

interface Deferred<T> {
	readonly promise: Promise<T>;
	resolve(value: T): void;
	reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

async function* bytesBody(...chunks: Array<string | Uint8Array>): AsyncIterable<Uint8Array> {
	for (const chunk of chunks) yield typeof chunk === "string" ? encoder.encode(chunk) : chunk;
}

const publicNameResolver: NetworkNameResolver = () => ["93.184.216.34"];

function hopResponse(
	request: PinnedNetworkHopRequest,
	options: {
		status?: number;
		location?: string;
		connectedAddress?: string;
		body?: AsyncIterable<Uint8Array>;
		close?: () => void | PromiseLike<void>;
	} = {},
): PinnedNetworkHopResponse {
	return {
		status: options.status ?? 200,
		body: options.body ?? bytesBody("ok"),
		connectedAddress: options.connectedAddress ?? request.connectAddress,
		close: options.close ?? (() => undefined),
		...(options.location === undefined ? {} : { location: options.location }),
	};
}

function setup<const Scope extends NetworkCapabilityScope>(
	scope: Scope,
	adapter: PinnedNetworkHopAdapter,
	options: {
		target?: string;
		privateOrigins?: readonly string[];
		nameResolver?: NetworkNameResolver;
		scheduler?: NetworkScheduler;
	} = {},
) {
	const authority = createNetworkCapabilityAuthority();
	const capability = authority.issuer.issue(
		scope,
		options.target ?? "https://feeds.example.com/feed.xml",
		options.privateOrigins,
	);
	const scheduler = options.scheduler ?? new NetworkScheduler();
	const nameResolver = options.nameResolver ?? publicNameResolver;
	const transport = new CapabilityScopedTransport(
		authority.resolver,
		nameResolver,
		adapter,
		scheduler,
	);
	return { authority, capability, nameResolver, scheduler, transport };
}

function expectSafeTransportError(
	error: unknown,
	code: (typeof CAPABILITY_TRANSPORT_ERROR_CODES)[keyof typeof CAPABILITY_TRANSPORT_ERROR_CODES],
	sentinel?: string,
): void {
	expect(error).toBeInstanceOf(CapabilityTransportError);
	expect((error as CapabilityTransportError).code).toBe(code);
	expect((error as CapabilityTransportError).resourceLabel).toBe("podcast subscription");
	expect(Object.isFrozen(error)).toBe(true);
	expect(error).not.toHaveProperty("cause");
	if (sentinel) {
		expect(String(error)).not.toContain(sentinel);
		expect(JSON.stringify(error)).not.toContain(sentinel);
	}
}

async function flushOperations(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

describe("CapabilityScopedTransport pinned request boundary", () => {
	it("pins one resolved address and exposes only structured request data to the adapter", async () => {
		const target = "HTTPS://Feeds.Example.COM:443/audio%2fpart?sig=TOP-SECRET%2BVALUE";
		const source = encoder.encode("payload");
		let observed: PinnedNetworkHopRequest | undefined;
		const nameResolver = vi.fn<NetworkNameResolver>(() => ["93.184.216.34"]);
		const adapter = vi.fn<PinnedNetworkHopAdapter>((request) => {
			observed = request;
			return hopResponse(request, { body: bytesBody(source) });
		});
		const { transport, capability } = setup(subscriptionScope, adapter, {
			target,
			nameResolver,
		});

		const response = await transport.getBytes(capability, subscriptionScope);

		expect(nameResolver).toHaveBeenCalledWith("feeds.example.com", expect.any(AbortSignal));
		expect(observed).toEqual({
			protocol: "https:",
			connectAddress: "93.184.216.34",
			port: 443,
			serverName: "feeds.example.com",
			hostHeader: "feeds.example.com",
			requestTarget: "/audio%2fpart?sig=TOP-SECRET%2BVALUE",
			method: "GET",
			credentials: "omit",
			redirect: "manual",
			signal: expect.any(AbortSignal),
		});
		expect(observed).not.toHaveProperty("target");
		expect(Object.isFrozen(observed)).toBe(true);
		expect(Object.keys(transport)).toEqual([]);
		expect(Object.isFrozen(transport)).toBe(true);
		expect(new TextDecoder().decode(response.bytes)).toBe("payload");
		expect(Object.isFrozen(response)).toBe(true);
		expect(JSON.stringify(response)).not.toContain(target);
		source.fill(0);
		expect(new TextDecoder().decode(response.bytes)).toBe("payload");
	});

	it("uses an IP literal directly, requires its exact private grant, and skips DNS", async () => {
		const nameResolver = vi.fn<NetworkNameResolver>();
		const adapter = vi.fn<PinnedNetworkHopAdapter>((request) => hopResponse(request));
		const target = "http://192.168.1.10:8080/feed";
		const blocked = setup(subscriptionScope, adapter, { target, nameResolver });
		const blockedError = await blocked.transport
			.getBytes(blocked.capability, subscriptionScope)
			.catch((caught: unknown) => caught);
		expectSafeTransportError(blockedError, CAPABILITY_TRANSPORT_ERROR_CODES.targetRejected);
		expect(adapter).not.toHaveBeenCalled();

		const allowed = setup(subscriptionScope, adapter, {
			target,
			nameResolver,
			privateOrigins: ["http://192.168.1.10:8080"],
		});
		const response = await allowed.transport.getBytes(allowed.capability, subscriptionScope);
		expect(response.status).toBe(200);
		expect(new TextDecoder().decode(response.bytes)).toBe("ok");
		expect(nameResolver).not.toHaveBeenCalled();
		expect(adapter.mock.calls[0][0].connectAddress).toBe("192.168.1.10");
		expect(adapter.mock.calls[0][0]).not.toHaveProperty("serverName");
	});

	it("selects only an authorized DNS answer and permits private DNS only by exact origin", async () => {
		const addresses = ["192.168.1.20", "93.184.216.34"];
		const publicAdapter = vi.fn<PinnedNetworkHopAdapter>((request) => hopResponse(request));
		const publicSetup = setup(subscriptionScope, publicAdapter, {
			nameResolver: () => addresses,
		});
		await publicSetup.transport.getBytes(publicSetup.capability, subscriptionScope);
		expect(publicAdapter.mock.calls[0][0].connectAddress).toBe("93.184.216.34");

		const privateAdapter = vi.fn<PinnedNetworkHopAdapter>((request) => hopResponse(request));
		const privateSetup = setup(subscriptionScope, privateAdapter, {
			target: "https://private.example/feed",
			privateOrigins: ["https://private.example"],
			nameResolver: () => addresses,
		});
		await privateSetup.transport.getBytes(privateSetup.capability, subscriptionScope);
		expect(privateAdapter.mock.calls[0][0].connectAddress).toBe("192.168.1.20");
	});

	it("falls back to the next pinned DNS address under the same operation deadline", async () => {
		const adapter = vi.fn<PinnedNetworkHopAdapter>((request) => {
			if (request.connectAddress === "2001:4860::1") {
				throw new Error("unreachable first address");
			}
			return hopResponse(request);
		});
		const { transport, capability } = setup(subscriptionScope, adapter, {
			nameResolver: () => ["2001:4860::1", "93.184.216.34"],
		});

		await expect(transport.getBytes(capability, subscriptionScope)).resolves.toMatchObject({
			status: 200,
		});
		expect(adapter.mock.calls.map(([request]) => request.connectAddress)).toEqual([
			"2001:4860::1",
			"93.184.216.34",
		]);
	});

	it("verifies the socket's actual remote address, including mapped IPv4", async () => {
		const mappedAdapter = vi.fn<PinnedNetworkHopAdapter>((request) =>
			hopResponse(request, { connectedAddress: "::ffff:93.184.216.34" }),
		);
		const mapped = setup(subscriptionScope, mappedAdapter);
		await expect(
			mapped.transport.getBytes(mapped.capability, subscriptionScope),
		).resolves.toMatchObject({
			status: 200,
		});

		const close = vi.fn();
		const mismatchedAdapter = vi.fn<PinnedNetworkHopAdapter>((request) =>
			hopResponse(request, { connectedAddress: "169.254.169.254", close }),
		);
		const mismatched = setup(subscriptionScope, mismatchedAdapter);
		const error = await mismatched.transport
			.getBytes(mismatched.capability, subscriptionScope)
			.catch((caught: unknown) => caught);
		expectSafeTransportError(error, CAPABILITY_TRANSPORT_ERROR_CODES.adapterResponseInvalid);
		expect(close).toHaveBeenCalledOnce();
	});

	it.each([
		["empty", []],
		["hostname", ["private.example"]],
		["duplicate", ["8.8.8.8", "::ffff:8.8.8.8"]],
		[
			"over-limit",
			Array.from(
				{ length: MAX_NETWORK_RESOLVED_ADDRESSES + 1 },
				(_, index) => `8.8.8.${index + 1}`,
			),
		],
	] as const)("rejects a malformed %s DNS answer", async (_name, addresses) => {
		const adapter = vi.fn<PinnedNetworkHopAdapter>();
		const { transport, capability } = setup(subscriptionScope, adapter, {
			nameResolver: () => addresses,
		});
		const error = await transport
			.getBytes(capability, subscriptionScope)
			.catch((caught: unknown) => caught);
		expectSafeTransportError(error, CAPABILITY_TRANSPORT_ERROR_CODES.addressRejected);
		expect(adapter).not.toHaveBeenCalled();
	});

	it("sanitizes resolver failures and hostile array traps", async () => {
		const sentinel = "https://private.example/feed?token=DNS-SECRET";
		const adapters = [
			() => {
				throw new Error(sentinel);
			},
			() =>
				new Proxy(["93.184.216.34"], {
					ownKeys: () => {
						throw new Error(sentinel);
					},
				}),
		] satisfies NetworkNameResolver[];

		for (const nameResolver of adapters) {
			const adapter = vi.fn<PinnedNetworkHopAdapter>();
			const { transport, capability } = setup(subscriptionScope, adapter, { nameResolver });
			const error = await transport
				.getBytes(capability, subscriptionScope)
				.catch((caught: unknown) => caught);
			expectSafeTransportError(
				error,
				CAPABILITY_TRANSPORT_ERROR_CODES.addressRejected,
				sentinel,
			);
		}
	});
});

describe("CapabilityScopedTransport redirects and bounded responses", () => {
	it("resolves every redirect through a newly pinned hop", async () => {
		const absolute = "HTTPS://CDN.Example.COM:443/audio%2fpart?sig=A%2BB";
		const requests: PinnedNetworkHopRequest[] = [];
		const closes = [vi.fn(), vi.fn(), vi.fn()];
		const adapter = vi.fn<PinnedNetworkHopAdapter>((request) => {
			requests.push(request);
			if (requests.length === 1) {
				return hopResponse(request, { status: 302, location: absolute, close: closes[0] });
			}
			if (requests.length === 2) {
				return hopResponse(request, {
					status: 307,
					location: "../final?token=still-private",
					close: closes[1],
				});
			}
			return hopResponse(request, { body: bytesBody("done"), close: closes[2] });
		});
		const { transport, capability } = setup(subscriptionScope, adapter);

		const response = await transport.getBytes(capability, subscriptionScope);

		expect(requests.map(({ serverName }) => serverName)).toEqual([
			"feeds.example.com",
			"cdn.example.com",
			"cdn.example.com",
		]);
		expect(requests.map(({ requestTarget }) => requestTarget)).toEqual([
			"/feed.xml",
			"/audio%2fpart?sig=A%2BB",
			"/final?token=still-private",
		]);
		expect(new TextDecoder().decode(response.bytes)).toBe("done");
		expect(closes.every((close) => close.mock.calls.length === 1)).toBe(true);
	});

	it.each([
		["https downgrade", "http://public.example/final"],
		["private redirect", "https://127.0.0.1/private"],
		["credential redirect", "https://user:pass@public.example/final"],
		["unsupported redirect", "file:///etc/passwd"],
		["fragment redirect", "#private-fragment"],
		["backslash redirect", "\\private.example\\feed"],
	] as const)("rejects a %s before opening the redirected hop", async (_name, location) => {
		const close = vi.fn();
		const adapter = vi.fn<PinnedNetworkHopAdapter>((request) =>
			hopResponse(request, { status: 302, location, close }),
		);
		const { transport, capability } = setup(subscriptionScope, adapter);
		const error = await transport
			.getBytes(capability, subscriptionScope)
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(CapabilityTransportError);
		expect(adapter).toHaveBeenCalledOnce();
		expect(close).toHaveBeenCalledOnce();
	});

	it("allows a private redirect only through an exact pre-issued origin grant", async () => {
		const requests: PinnedNetworkHopRequest[] = [];
		const adapter = vi.fn<PinnedNetworkHopAdapter>((request) => {
			requests.push(request);
			return requests.length === 1
				? hopResponse(request, { status: 302, location: "http://127.0.0.1:8080/feed" })
				: hopResponse(request);
		});
		const { transport, capability } = setup(subscriptionScope, adapter, {
			target: "http://public.example/feed",
			privateOrigins: ["http://127.0.0.1:8080"],
		});

		await expect(transport.getBytes(capability, subscriptionScope)).resolves.toMatchObject({
			status: 200,
		});
		expect(requests[1].connectAddress).toBe("127.0.0.1");
	});

	it("rejects redirect loops and chains beyond the fixed limit", async () => {
		const loopAdapter = vi.fn<PinnedNetworkHopAdapter>((request) =>
			hopResponse(request, { status: 302, location: "https://feeds.example.com/feed.xml" }),
		);
		const loop = setup(subscriptionScope, loopAdapter);
		const loopError = await loop.transport
			.getBytes(loop.capability, subscriptionScope)
			.catch((caught: unknown) => caught);
		expectSafeTransportError(loopError, CAPABILITY_TRANSPORT_ERROR_CODES.redirectRejected);
		expect(loopAdapter).toHaveBeenCalledOnce();

		let hop = 0;
		const chainAdapter = vi.fn<PinnedNetworkHopAdapter>((request) => {
			hop += 1;
			return hopResponse(request, {
				status: 302,
				location: `https://redirect-${hop}.example/feed`,
			});
		});
		const chain = setup(subscriptionScope, chainAdapter);
		const chainError = await chain.transport
			.getBytes(chain.capability, subscriptionScope)
			.catch((caught: unknown) => caught);
		expectSafeTransportError(chainError, CAPABILITY_TRANSPORT_ERROR_CODES.redirectLimit);
		expect(chainAdapter).toHaveBeenCalledTimes(MAX_NETWORK_REDIRECTS + 1);
	});

	it("requires the capability's fixed status policy and closes the hop", async () => {
		const close = vi.fn();
		const adapter = vi.fn<PinnedNetworkHopAdapter>((request) =>
			hopResponse(request, { status: 404, body: bytesBody("secret"), close }),
		);
		const { transport, capability } = setup(subscriptionScope, adapter);
		const error = await transport
			.getBytes(capability, subscriptionScope)
			.catch((caught: unknown) => caught);
		expectSafeTransportError(error, CAPABILITY_TRANSPORT_ERROR_CODES.statusRejected);
		expect(close).toHaveBeenCalledOnce();
	});

	it("enforces the capability's byte ceiling incrementally", async () => {
		const limit = NETWORK_BUFFERED_RESOURCE_POLICIES.subscription.maxResponseBytes;
		let iteratorClosed = false;
		async function* oversizedBody(): AsyncIterable<Uint8Array> {
			try {
				yield new Uint8Array(limit);
				yield new Uint8Array(1);
			} finally {
				iteratorClosed = true;
			}
		}
		const close = vi.fn();
		const adapter = vi.fn<PinnedNetworkHopAdapter>((request) =>
			hopResponse(request, { body: oversizedBody(), close }),
		);
		const { transport, capability } = setup(subscriptionScope, adapter);
		const error = await transport
			.getBytes(capability, subscriptionScope)
			.catch((caught: unknown) => caught);
		expectSafeTransportError(error, CAPABILITY_TRANSPORT_ERROR_CODES.responseTooLarge);
		expect(iteratorClosed).toBe(true);
		expect(close).toHaveBeenCalledOnce();
	});

	it("bounds zero-length chunk work independently of byte count", async () => {
		async function* excessiveChunks(): AsyncIterable<Uint8Array> {
			for (let index = 0; index <= MAX_BUFFERED_NETWORK_CHUNKS; index += 1) {
				yield new Uint8Array(0);
			}
		}
		const adapter = vi.fn<PinnedNetworkHopAdapter>((request) =>
			hopResponse(request, { body: excessiveChunks() }),
		);
		const { transport, capability } = setup(subscriptionScope, adapter);
		const error = await transport
			.getBytes(capability, subscriptionScope)
			.catch((caught: unknown) => caught);
		expectSafeTransportError(error, CAPABILITY_TRANSPORT_ERROR_CODES.responseTooLarge);
	});

	it("rejects non-byte views and sanitizes adapter, body, and close failures", async () => {
		const sentinel = "https://user:pass@private.example/audio?token=TOP-SECRET";
		const cases: PinnedNetworkHopAdapter[] = [
			(request) =>
				hopResponse(request, {
					body: bytesBody(new Uint16Array([1]) as unknown as Uint8Array),
				}),
			() => {
				throw new Error(sentinel);
			},
			(request) =>
				hopResponse(request, {
					body: {
						[Symbol.asyncIterator]: () => ({
							next: () => Promise.reject(new Error(sentinel)),
						}),
					},
				}),
			(request) =>
				hopResponse(request, {
					close: () => {
						throw new Error(sentinel);
					},
				}),
		];

		for (const adapter of cases) {
			const { transport, capability } = setup(subscriptionScope, adapter);
			const error = await transport
				.getBytes(capability, subscriptionScope)
				.catch((caught: unknown) => caught);
			expect(error).toBeInstanceOf(CapabilityTransportError);
			expect(String(error)).not.toContain(sentinel);
			expect(JSON.stringify(error)).not.toContain(sentinel);
		}
	});

	it("closes malformed adapter responses without invoking accessor fields", async () => {
		let statusRead = false;
		const close = vi.fn();
		const adapter: PinnedNetworkHopAdapter = (request) => {
			const response = {
				body: bytesBody("ok"),
				connectedAddress: request.connectAddress,
				close,
			} as Record<string, unknown>;
			Object.defineProperty(response, "status", {
				enumerable: true,
				get: () => {
					statusRead = true;
					return 200;
				},
			});
			return response as unknown as PinnedNetworkHopResponse;
		};
		const { transport, capability } = setup(subscriptionScope, adapter);
		const error = await transport
			.getBytes(capability, subscriptionScope)
			.catch((caught: unknown) => caught);
		expectSafeTransportError(error, CAPABILITY_TRANSPORT_ERROR_CODES.adapterResponseInvalid);
		expect(statusRead).toBe(false);
		expect(close).toHaveBeenCalledOnce();
	});

	it("preserves the adapter response receiver when invoking close", async () => {
		let responseObject: PinnedNetworkHopResponse | undefined;
		let usedResponseReceiver = false;
		const adapter: PinnedNetworkHopAdapter = (request) => {
			responseObject = {
				status: 200,
				body: bytesBody("ok"),
				connectedAddress: request.connectAddress,
				close(): void {
					usedResponseReceiver = this === responseObject;
				},
			};
			return responseObject;
		};
		const { transport, capability } = setup(subscriptionScope, adapter);

		await transport.getBytes(capability, subscriptionScope);
		expect(usedResponseReceiver).toBe(true);
	});
});

describe("CapabilityScopedTransport policy, revocation, and lifecycle", () => {
	it("derives immutable buffering and lane policy from the resource kind", async () => {
		expect(Object.isFrozen(NETWORK_BUFFERED_RESOURCE_POLICIES)).toBe(true);
		expect(Object.isFrozen(NETWORK_BUFFERED_RESOURCE_POLICIES.subscription)).toBe(true);
		expect(
			Object.isFrozen(NETWORK_BUFFERED_RESOURCE_POLICIES.subscription.acceptedStatuses),
		).toBe(true);

		const gate = deferred<PinnedNetworkHopResponse>();
		const adapter = vi.fn<PinnedNetworkHopAdapter>(() => gate.promise);
		const artwork = setup(feedArtworkScope, adapter);
		const pending = artwork.transport.getBytes(artwork.capability, feedArtworkScope);
		expect(artwork.transport.getLaneSnapshot("media")).toMatchObject({ active: 1 });
		expect(artwork.transport.getLaneSnapshot("metadata")).toMatchObject({ active: 0 });
		await flushOperations();
		const request = adapter.mock.calls[0][0];
		gate.resolve(hopResponse(request));
		await pending;
	});

	it("rejects buffered episode-stream use before DNS or adapter work", async () => {
		const nameResolver = vi.fn<NetworkNameResolver>();
		const adapter = vi.fn<PinnedNetworkHopAdapter>();
		const { transport, capability } = setup(streamScope, adapter, { nameResolver });
		const error = await transport
			.getBytes(capability, streamScope)
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(CapabilityTransportError);
		expect((error as CapabilityTransportError).code).toBe(
			CAPABILITY_TRANSPORT_ERROR_CODES.resourceRejected,
		);
		expect(nameResolver).not.toHaveBeenCalled();
		expect(adapter).not.toHaveBeenCalled();
	});

	it("revalidates a queued capability before network work starts", async () => {
		const firstGate = deferred<PinnedNetworkHopResponse>();
		let calls = 0;
		const adapter = vi.fn<PinnedNetworkHopAdapter>((request) => {
			calls += 1;
			return calls === 1 ? firstGate.promise : hopResponse(request);
		});
		const scheduler = new NetworkScheduler({
			laneLimits: { metadata: { maxActive: 1, maxQueued: 1 } },
		});
		const authority = createNetworkCapabilityAuthority();
		const firstCapability = authority.issuer.issue(
			subscriptionScope,
			"https://first.example/feed",
		);
		const secondCapability = authority.issuer.issue(
			subscriptionScope,
			"https://second.example/feed",
		);
		const transport = new CapabilityScopedTransport(
			authority.resolver,
			publicNameResolver,
			adapter,
			scheduler,
		);
		const first = transport.getBytes(firstCapability, subscriptionScope);
		const second = transport.getBytes(secondCapability, subscriptionScope);
		expect(transport.getLaneSnapshot("metadata")).toMatchObject({ active: 1, queued: 1 });
		expect(authority.issuer.revoke(secondCapability)).toBe(true);

		await flushOperations();
		firstGate.resolve(hopResponse(adapter.mock.calls[0][0]));
		await first;
		await expect(second).rejects.toBeInstanceOf(NetworkCapabilityError);
		expect(adapter).toHaveBeenCalledOnce();
	});

	it("revocation aborts and closes already-active capability work", async () => {
		const nextGate = deferred<IteratorResult<Uint8Array>>();
		const close = vi.fn(() => nextGate.reject(new Error("closed")));
		const body: AsyncIterable<Uint8Array> = {
			[Symbol.asyncIterator]: () => ({ next: () => nextGate.promise }),
		};
		const adapter = vi.fn<PinnedNetworkHopAdapter>((request) =>
			hopResponse(request, { body, close }),
		);
		const active = setup(subscriptionScope, adapter);
		const pending = active.transport.getBytes(active.capability, subscriptionScope);
		await flushOperations();

		expect(active.authority.issuer.revoke(active.capability)).toBe(true);
		expect(close).toHaveBeenCalledOnce();
		await expect(pending).rejects.toBeInstanceOf(CapabilityTransportError);
		await flushOperations();
		expect(active.transport.getLaneSnapshot("metadata").active).toBe(0);
	});

	it("does not return buffered bytes when revocation occurs during asynchronous close", async () => {
		const closeGate = deferred<void>();
		const close = vi.fn(() => closeGate.promise);
		const adapter = vi.fn<PinnedNetworkHopAdapter>((request) =>
			hopResponse(request, { body: bytesBody("complete"), close }),
		);
		const active = setup(subscriptionScope, adapter);
		const pending = active.transport.getBytes(active.capability, subscriptionScope);
		await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());

		expect(active.authority.issuer.revoke(active.capability)).toBe(true);
		closeGate.resolve();
		await expect(pending).rejects.toBeInstanceOf(CapabilityTransportError);
	});

	it("rejects forged tokens, cross-scope use, and forged resolver facets", async () => {
		const adapter = vi.fn<PinnedNetworkHopAdapter>();
		const { authority, transport, capability, scheduler } = setup(subscriptionScope, adapter);
		const forged = Object.freeze(Object.create(null)) as NetworkCapability;
		await expect(transport.getBytes(forged, subscriptionScope)).rejects.toBeInstanceOf(
			NetworkCapabilityError,
		);
		await expect(
			transport.getBytes(
				capability as unknown as NetworkCapability<typeof streamScope>,
				streamScope,
			),
		).rejects.toBeInstanceOf(NetworkCapabilityError);
		expect(
			() =>
				new CapabilityScopedTransport(
					{ resolve: authority.resolver.resolve },
					publicNameResolver,
					adapter,
					scheduler,
				),
		).toThrow("authentic network capability resolver");
		expect(adapter).not.toHaveBeenCalled();
	});

	it("requires every trusted composition dependency explicitly", () => {
		const authority = createNetworkCapabilityAuthority();
		const scheduler = new NetworkScheduler();
		const adapter = vi.fn<PinnedNetworkHopAdapter>();
		expect(
			() =>
				new CapabilityScopedTransport(
					authority.resolver,
					null as unknown as NetworkNameResolver,
					adapter,
					scheduler,
				),
		).toThrow(TypeError);
		expect(
			() =>
				new CapabilityScopedTransport(
					authority.resolver,
					publicNameResolver,
					adapter,
					undefined as unknown as NetworkScheduler,
				),
		).toThrow("shared network scheduler");
	});

	it("does not export an executable raw pinned-hop client", async () => {
		const hopBoundary = await import("./PinnedNetworkHop");
		const { transport } = setup(subscriptionScope, vi.fn<PinnedNetworkHopAdapter>());

		expect(hopBoundary).not.toHaveProperty("PinnedNetworkHopClient");
		expect(Object.getOwnPropertyNames(Object.getPrototypeOf(transport)).sort()).toEqual([
			"constructor",
			"dispose",
			"getBytes",
			"getLaneSnapshot",
			"getSnapshot",
			"isDisposed",
		]);
	});

	it("composition runtime never distributes the raw-target resolver", async () => {
		const adapter = vi.fn<PinnedNetworkHopAdapter>((request) => hopResponse(request));
		const runtime = createCapabilityScopedNetworkRuntime(
			publicNameResolver,
			adapter,
			new NetworkScheduler(),
		);
		const capability = runtime.issuer.issue(
			subscriptionScope,
			"https://feeds.example.com/feed.xml?token=hidden",
		);

		expect(Object.keys(runtime).sort()).toEqual(["dispose", "issuer", "transport"]);
		expect(runtime).not.toHaveProperty("resolver");
		await expect(
			runtime.transport.getBytes(capability, subscriptionScope),
		).resolves.toMatchObject({
			status: 200,
		});
		runtime.dispose();
		expect(runtime.transport.isDisposed()).toBe(true);
	});

	it("aborts and closes active response work exactly once on disposal", async () => {
		const nextGate = deferred<IteratorResult<Uint8Array>>();
		const close = vi.fn(() => {
			nextGate.reject(new Error("closed"));
		});
		const body: AsyncIterable<Uint8Array> = {
			[Symbol.asyncIterator]: () => ({ next: () => nextGate.promise }),
		};
		let signal: AbortSignal | undefined;
		const adapter = vi.fn<PinnedNetworkHopAdapter>((request) => {
			signal = request.signal;
			return hopResponse(request, { body, close });
		});
		const { transport, capability } = setup(subscriptionScope, adapter);
		const pending = transport.getBytes(capability, subscriptionScope);
		await flushOperations();

		transport.dispose();
		expect(signal?.aborted).toBe(true);
		expect(close).toHaveBeenCalledOnce();
		await expect(pending).rejects.toBeInstanceOf(NetworkDisposedError);
		await flushOperations();
		expect(close).toHaveBeenCalledOnce();
	});

	it("closes a late adapter response without consuming it after disposal", async () => {
		const adapterGate = deferred<PinnedNetworkHopResponse>();
		const close = vi.fn();
		let request: PinnedNetworkHopRequest | undefined;
		let bodyStarted = false;
		const body: AsyncIterable<Uint8Array> = {
			[Symbol.asyncIterator]: () => {
				bodyStarted = true;
				return { next: () => Promise.resolve({ done: true, value: undefined }) };
			},
		};
		const adapter = vi.fn<PinnedNetworkHopAdapter>((nextRequest) => {
			request = nextRequest;
			return adapterGate.promise;
		});
		const { transport, capability } = setup(subscriptionScope, adapter);
		const pending = transport.getBytes(capability, subscriptionScope);
		await flushOperations();
		transport.dispose();
		await expect(pending).rejects.toBeInstanceOf(NetworkDisposedError);

		if (!request) throw new Error("adapter request was not captured");
		adapterGate.resolve(hopResponse(request, { body, close }));
		await flushOperations();
		expect(close).toHaveBeenCalledOnce();
		expect(bodyStarted).toBe(false);
	});
});
