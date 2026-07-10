import {
	MAX_BUFFERED_NETWORK_RESPONSE_BYTES,
	consumeBufferedNetworkBody,
} from "./BufferedNetworkBody";
import {
	NetworkCapabilityError,
	createNetworkCapabilityAuthority,
	isNetworkCapabilityResolver,
	type NetworkCapability,
	type NetworkCapabilityIssuer,
	type NetworkCapabilityResolution,
	type NetworkCapabilityResolver,
	type NetworkCapabilityScope,
	type NetworkResourceKind,
} from "./NetworkCapability";
import {
	classifyResolvedAddress,
	isResolvedAddressLiteral,
	MAX_NETWORK_TARGET_BYTES,
	parseTargetPolicyView,
	type NetworkProtocol,
	type TargetPolicyView,
} from "./LiteralTargetClassifier";
import {
	assertNetworkOperationActive,
	CAPABILITY_TRANSPORT_ERROR_CODES,
	createCapabilityTransportError,
	createNetworkResourceLabel,
	sanitizeCapabilityTransportError,
	type CapabilityTransportError,
	type NetworkResourceLabel,
} from "./NetworkErrors";
import {
	closeInvalidHopResponse,
	manageHopResponse,
	snapshotHopResponse,
	snapshotResolvedAddresses,
	targetRequestParts,
	type NetworkNameResolver,
	type PinnedNetworkHop,
	type PinnedNetworkHopAdapter,
} from "./PinnedNetworkHop";
import type {
	NetworkLane,
	NetworkLaneSnapshot,
	NetworkScheduler,
	NetworkSchedulerSession,
	NetworkSchedulerSnapshot,
} from "./NetworkScheduler";

export {
	MAX_BUFFERED_NETWORK_CHUNKS,
	MAX_BUFFERED_NETWORK_RESPONSE_BYTES,
} from "./BufferedNetworkBody";
export {
	CAPABILITY_TRANSPORT_ERROR_CODES,
	CapabilityTransportError,
	type CapabilityTransportErrorCode,
} from "./NetworkErrors";
export {
	MAX_NETWORK_RESOLVED_ADDRESSES,
	type NetworkNameResolver,
	type PinnedNetworkHopAdapter,
	type PinnedNetworkHopRequest,
	type PinnedNetworkHopResponse,
} from "./PinnedNetworkHop";

export const MAX_NETWORK_REDIRECTS = 5;

export interface BufferedNetworkResourcePolicy {
	readonly lane: NetworkLane;
	readonly acceptedStatuses: readonly number[];
	/** Total enqueue-to-completion deadline. */
	readonly timeoutMs: number;
	readonly maxResponseBytes: number;
}

function bufferedPolicy(
	lane: NetworkLane,
	timeoutMs: number,
	maxResponseBytes: number,
): BufferedNetworkResourcePolicy {
	return Object.freeze({
		lane,
		acceptedStatuses: Object.freeze([200]),
		timeoutMs,
		maxResponseBytes,
	});
}

/**
 * Buffering, status, deadline, and lane policy is fixed by capability purpose.
 * Episode streams deliberately have no buffered operation.
 */
export const NETWORK_BUFFERED_RESOURCE_POLICIES = Object.freeze({
	subscription: bufferedPolicy("metadata", 30_000, 8 * 1024 * 1024),
	"feed-artwork": bufferedPolicy("media", 30_000, MAX_BUFFERED_NETWORK_RESPONSE_BYTES),
	site: bufferedPolicy("metadata", 30_000, 4 * 1024 * 1024),
	"episode-stream": null,
	"episode-chapters": bufferedPolicy("metadata", 20_000, 4 * 1024 * 1024),
	"episode-artwork": bufferedPolicy("media", 30_000, MAX_BUFFERED_NETWORK_RESPONSE_BYTES),
	"episode-item-link": bufferedPolicy("metadata", 30_000, 4 * 1024 * 1024),
} as const satisfies Readonly<Record<NetworkResourceKind, BufferedNetworkResourcePolicy | null>>);

export interface CapabilityBytesResponse {
	readonly status: number;
	readonly bytes: Uint8Array;
}

type TransportOutcome<T> =
	| { readonly ok: true; readonly value: T }
	| {
			readonly ok: false;
			readonly error: CapabilityTransportError | NetworkCapabilityError;
	  };

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function createCapabilityResolutionError(): NetworkCapabilityError {
	return Object.freeze(new NetworkCapabilityError("resolve"));
}

function evaluateTarget(
	target: string,
	privateOrigins: ReadonlySet<string>,
	resourceLabel: NetworkResourceLabel,
	previousProtocol?: NetworkProtocol,
): TargetPolicyView {
	const policy = parseTargetPolicyView(target);
	if (
		!policy.ok ||
		policy.value.hasCredentials ||
		(policy.value.hostClassification === "non-public-or-special-literal" &&
			!privateOrigins.has(policy.value.normalizedOrigin))
	) {
		throw createCapabilityTransportError(
			CAPABILITY_TRANSPORT_ERROR_CODES.targetRejected,
			resourceLabel,
		);
	}
	if (previousProtocol === "https:" && policy.value.protocol === "http:") {
		throw createCapabilityTransportError(
			CAPABILITY_TRANSPORT_ERROR_CODES.redirectRejected,
			resourceLabel,
		);
	}
	return policy.value;
}

function hasUnsafeRelativeLocationCodePoint(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (next < 0xdc00 || next > 0xdfff) return true;
			index += 1;
			continue;
		}
		if (code >= 0xdc00 && code <= 0xdfff) return true;
		if (
			code === 0x061c ||
			(code >= 0x200b && code <= 0x200f) ||
			(code >= 0x2028 && code <= 0x202e) ||
			(code >= 0x2066 && code <= 0x2069) ||
			code === 0xfeff
		) {
			return true;
		}
	}
	return false;
}

function resolveRedirectTarget(
	location: string | undefined,
	currentTarget: string,
	resourceLabel: NetworkResourceLabel,
): string {
	if (
		location === undefined ||
		location.length === 0 ||
		location.length > MAX_NETWORK_TARGET_BYTES ||
		location !== location.trim() ||
		location.includes("\\") ||
		hasUnsafeRelativeLocationCodePoint(location) ||
		new TextEncoder().encode(location).byteLength > MAX_NETWORK_TARGET_BYTES
	) {
		throw createCapabilityTransportError(
			CAPABILITY_TRANSPORT_ERROR_CODES.redirectRejected,
			resourceLabel,
		);
	}
	if (/^[a-z][a-z0-9+.-]*:/i.test(location)) return location;
	try {
		return new URL(location, currentTarget).href;
	} catch {
		throw createCapabilityTransportError(
			CAPABILITY_TRANSPORT_ERROR_CODES.redirectRejected,
			resourceLabel,
		);
	}
}

function combineAbortSignals(...signals: readonly AbortSignal[]): {
	readonly signal: AbortSignal;
	dispose(): void;
} {
	const controller = new AbortController();
	const abort = (): void => controller.abort();
	for (const signal of signals) signal.addEventListener("abort", abort, { once: true });
	if (signals.some((signal) => signal.aborted)) abort();
	return Object.freeze({
		signal: controller.signal,
		dispose(): void {
			for (const signal of signals) signal.removeEventListener("abort", abort);
		},
	});
}

export class CapabilityScopedTransport {
	readonly #capabilityResolver: NetworkCapabilityResolver;
	readonly #nameResolver: NetworkNameResolver;
	readonly #adapter: PinnedNetworkHopAdapter;
	readonly #session: NetworkSchedulerSession;

	constructor(
		capabilityResolver: NetworkCapabilityResolver,
		nameResolver: NetworkNameResolver,
		adapter: PinnedNetworkHopAdapter,
		scheduler: NetworkScheduler,
	) {
		if (!isNetworkCapabilityResolver(capabilityResolver)) {
			throw new TypeError("An authentic network capability resolver is required.");
		}
		if (!scheduler || typeof scheduler.createSession !== "function") {
			throw new TypeError("A shared network scheduler is required.");
		}
		if (typeof nameResolver !== "function") {
			throw new TypeError("A network name resolver is required.");
		}
		if (typeof adapter !== "function") {
			throw new TypeError("A pinned network hop adapter is required.");
		}
		this.#capabilityResolver = capabilityResolver;
		this.#nameResolver = nameResolver;
		this.#adapter = adapter;
		this.#session = scheduler.createSession();
		Object.freeze(this);
	}

	async getBytes<const Scope extends NetworkCapabilityScope>(
		capability: NetworkCapability<Scope>,
		expectedScope: Scope,
	): Promise<CapabilityBytesResponse> {
		let initialResolution: NetworkCapabilityResolution<Scope>;
		try {
			initialResolution = this.#capabilityResolver.resolve(capability, expectedScope);
		} catch {
			throw createCapabilityResolutionError();
		}
		const validatedScope = initialResolution.scope as Scope;
		const resourceLabel = createNetworkResourceLabel(initialResolution.resourceLabel);
		const policy = NETWORK_BUFFERED_RESOURCE_POLICIES[validatedScope.resourceKind];
		if (!policy) {
			throw createCapabilityTransportError(
				CAPABILITY_TRANSPORT_ERROR_CODES.resourceRejected,
				resourceLabel,
			);
		}

		const outcome = await this.#session.schedule<TransportOutcome<CapabilityBytesResponse>>({
			lane: policy.lane,
			resourceLabel,
			timeoutMs: policy.timeoutMs,
			operation: async (signal) => {
				let currentResolution: NetworkCapabilityResolution<Scope>;
				try {
					currentResolution = this.#capabilityResolver.resolve(
						capability,
						validatedScope,
					);
				} catch {
					return { ok: false, error: createCapabilityResolutionError() };
				}
				const combinedSignal = combineAbortSignals(
					signal,
					currentResolution.revocationSignal,
					currentResolution.authoritySignal,
				);
				try {
					const value = await this.#execute(
						currentResolution.target,
						new Set(currentResolution.privateOrigins),
						policy,
						resourceLabel,
						combinedSignal.signal,
					);
					return { ok: true, value };
				} catch (error) {
					return {
						ok: false,
						error: sanitizeCapabilityTransportError(error, resourceLabel),
					};
				} finally {
					combinedSignal.dispose();
				}
			},
		});

		if (!outcome.ok) throw outcome.error;
		return outcome.value;
	}

	dispose(): void {
		this.#session.dispose();
	}

	isDisposed(): boolean {
		return this.#session.isDisposed();
	}

	getLaneSnapshot(lane: NetworkLane): NetworkLaneSnapshot {
		return this.#session.getLaneSnapshot(lane);
	}

	getSnapshot(): NetworkSchedulerSnapshot {
		return this.#session.getSnapshot();
	}

	async #selectConnectAddresses(
		policy: TargetPolicyView,
		privateOrigins: ReadonlySet<string>,
		resourceLabel: NetworkResourceLabel,
		signal: AbortSignal,
	): Promise<readonly string[]> {
		if (isResolvedAddressLiteral(policy.normalizedHostname)) {
			return Object.freeze([policy.normalizedHostname]);
		}

		let rawAddresses: unknown;
		try {
			rawAddresses = await this.#nameResolver(policy.normalizedHostname, signal);
		} catch {
			throw createCapabilityTransportError(
				CAPABILITY_TRANSPORT_ERROR_CODES.addressRejected,
				resourceLabel,
			);
		}
		assertNetworkOperationActive(signal, resourceLabel);
		const addresses = snapshotResolvedAddresses(rawAddresses, resourceLabel);
		const grantsPrivateAddress = privateOrigins.has(policy.normalizedOrigin);
		const selected = addresses.filter(
			(address) =>
				classifyResolvedAddress(address) === "ordinary-public-literal" ||
				grantsPrivateAddress,
		);
		if (selected.length === 0) {
			throw createCapabilityTransportError(
				CAPABILITY_TRANSPORT_ERROR_CODES.addressRejected,
				resourceLabel,
			);
		}
		return Object.freeze(selected);
	}

	async #openHop(
		target: string,
		policy: TargetPolicyView,
		connectAddresses: readonly string[],
		resourceLabel: NetworkResourceLabel,
		signal: AbortSignal,
	): Promise<PinnedNetworkHop> {
		const parts = targetRequestParts(target, policy);
		for (const connectAddress of connectAddresses) {
			assertNetworkOperationActive(signal, resourceLabel);
			const request = Object.freeze({
				protocol: policy.protocol,
				connectAddress,
				port: policy.port,
				...(isResolvedAddressLiteral(policy.normalizedHostname)
					? {}
					: { serverName: policy.normalizedHostname }),
				hostHeader: parts.hostHeader,
				requestTarget: parts.requestTarget,
				method: "GET" as const,
				credentials: "omit" as const,
				redirect: "manual" as const,
				signal,
			});

			let response: unknown;
			try {
				response = await this.#adapter(request);
			} catch {
				assertNetworkOperationActive(signal, resourceLabel);
				continue;
			}
			let prepared: ReturnType<typeof snapshotHopResponse>;
			try {
				prepared = snapshotHopResponse(response, connectAddress, resourceLabel);
			} catch (error) {
				await closeInvalidHopResponse(response);
				throw error;
			}
			const managed = manageHopResponse(prepared, signal);
			if (signal.aborted) {
				await managed.close();
				assertNetworkOperationActive(signal, resourceLabel);
			}
			return managed;
		}
		throw createCapabilityTransportError(
			CAPABILITY_TRANSPORT_ERROR_CODES.operationFailed,
			resourceLabel,
		);
	}

	async #execute(
		initialTarget: string,
		privateOrigins: ReadonlySet<string>,
		resourcePolicy: BufferedNetworkResourcePolicy,
		resourceLabel: NetworkResourceLabel,
		signal: AbortSignal,
	): Promise<CapabilityBytesResponse> {
		let target = initialTarget;
		let previousProtocol: NetworkProtocol | undefined;
		const visitedTargets = new Set<string>();

		for (let redirectCount = 0; ; redirectCount += 1) {
			assertNetworkOperationActive(signal, resourceLabel);
			const targetPolicy = evaluateTarget(
				target,
				privateOrigins,
				resourceLabel,
				previousProtocol,
			);
			if (visitedTargets.has(target)) {
				throw createCapabilityTransportError(
					CAPABILITY_TRANSPORT_ERROR_CODES.redirectRejected,
					resourceLabel,
				);
			}
			visitedTargets.add(target);
			const connectAddresses = await this.#selectConnectAddresses(
				targetPolicy,
				privateOrigins,
				resourceLabel,
				signal,
			);
			assertNetworkOperationActive(signal, resourceLabel);

			const response = await this.#openHop(
				target,
				targetPolicy,
				connectAddresses,
				resourceLabel,
				signal,
			);
			let bodyResult: Uint8Array | undefined;
			let hopError: unknown;
			try {
				assertNetworkOperationActive(signal, resourceLabel);
				if (REDIRECT_STATUSES.has(response.status)) {
					if (redirectCount >= MAX_NETWORK_REDIRECTS) {
						throw createCapabilityTransportError(
							CAPABILITY_TRANSPORT_ERROR_CODES.redirectLimit,
							resourceLabel,
						);
					}
					target = resolveRedirectTarget(response.location, target, resourceLabel);
					previousProtocol = targetPolicy.protocol;
				} else if (!resourcePolicy.acceptedStatuses.includes(response.status)) {
					throw createCapabilityTransportError(
						CAPABILITY_TRANSPORT_ERROR_CODES.statusRejected,
						resourceLabel,
					);
				} else {
					bodyResult = await consumeBufferedNetworkBody(
						response.body,
						resourcePolicy.maxResponseBytes,
						resourceLabel,
						signal,
					);
				}
			} catch (error) {
				hopError = error;
			}

			try {
				await response.close();
			} catch {
				if (!hopError) {
					hopError = createCapabilityTransportError(
						CAPABILITY_TRANSPORT_ERROR_CODES.operationFailed,
						resourceLabel,
					);
				}
			}
			if (hopError) throw hopError;
			assertNetworkOperationActive(signal, resourceLabel);
			if (bodyResult) return Object.freeze({ status: response.status, bytes: bodyResult });
		}
	}
}

export interface CapabilityScopedNetworkRuntime {
	readonly issuer: NetworkCapabilityIssuer;
	readonly transport: CapabilityScopedTransport;
	dispose(): void;
}

/**
 * Application composition entry point. It traps the raw-target resolver inside
 * the transport and distributes only issuance and purpose-scoped operations.
 */
export function createCapabilityScopedNetworkRuntime(
	nameResolver: NetworkNameResolver,
	adapter: PinnedNetworkHopAdapter,
	scheduler: NetworkScheduler,
): CapabilityScopedNetworkRuntime {
	const authority = createNetworkCapabilityAuthority();
	const transport = new CapabilityScopedTransport(
		authority.resolver,
		nameResolver,
		adapter,
		scheduler,
	);
	let disposed = false;
	return Object.freeze({
		issuer: authority.issuer,
		transport,
		dispose(): void {
			if (disposed) return;
			disposed = true;
			transport.dispose();
			authority.dispose();
		},
	});
}
