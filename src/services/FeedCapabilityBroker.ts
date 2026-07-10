import {
	createCapabilityScopedNetworkRuntime,
	type CapabilityBytesResponse,
	type NetworkNameResolver,
	type PinnedNetworkHopAdapter,
} from "src/network/CapabilityScopedTransport";
import {
	EPISODE_NETWORK_RESOURCE_KINDS,
	FEED_NETWORK_RESOURCE_KINDS,
	type EpisodeNetworkResourceKind,
	type FeedNetworkResourceKind,
	type NetworkCapability,
	type NetworkCapabilityScope,
} from "src/network/NetworkCapability";
import type { NetworkScheduler } from "src/network/NetworkScheduler";
import {
	isFeedCapabilityReferenceFor,
	type FeedCapabilityReference,
} from "src/security/feedCapabilityReferences";
import {
	isEpisodeHandle,
	isFeedHandle,
	type EpisodeHandle,
	type FeedHandle,
} from "src/security/resourceHandles";
import {
	validateFeedCapabilityEnvelope,
	type FeedCapabilityEnvelope,
} from "src/security/targetEnvelopes";

import type { CapabilityReadResult } from "./FeedCapabilityRepository";

export interface FeedCapabilityReader {
	readFeedCapabilities(
		feedId: FeedHandle | string,
		reference: unknown,
	): Promise<CapabilityReadResult<FeedCapabilityEnvelope>>;
}

export type IssuedFeedNetworkScope<Kind extends FeedNetworkResourceKind> = Readonly<{
	resourceKind: Kind;
	feedId: FeedHandle;
}>;

export type IssuedEpisodeNetworkScope<Kind extends EpisodeNetworkResourceKind> = Readonly<{
	resourceKind: Kind;
	feedId: FeedHandle;
	episodeId: EpisodeHandle;
}>;

export interface CapabilityUseContext<Scope extends NetworkCapabilityScope> {
	readonly capability: NetworkCapability<Scope>;
	readonly scope: Readonly<Scope>;
}

export type CapabilityUseOperation<Scope extends NetworkCapabilityScope, Value> = (
	context: CapabilityUseContext<Scope>,
) => Value | PromiseLike<Value>;

export type CapabilityUseResult<Value> =
	| { readonly status: "available"; readonly value: Value }
	| { readonly status: "missing" | "invalid" | "unavailable" };

type UnavailableStatus = Exclude<CapabilityUseResult<unknown>["status"], "available">;

export interface FeedCapabilityBroker {
	withFeedResource<Kind extends FeedNetworkResourceKind, Value>(
		feedId: FeedHandle | string,
		reference: FeedCapabilityReference | string,
		resourceKind: Kind,
		operation: CapabilityUseOperation<IssuedFeedNetworkScope<Kind>, Value>,
	): Promise<CapabilityUseResult<Value>>;
	withEpisodeResource<Kind extends EpisodeNetworkResourceKind, Value>(
		feedId: FeedHandle | string,
		episodeId: EpisodeHandle | string,
		reference: FeedCapabilityReference | string,
		resourceKind: Kind,
		operation: CapabilityUseOperation<IssuedEpisodeNetworkScope<Kind>, Value>,
	): Promise<CapabilityUseResult<Value>>;
	invalidateFeed(feedId: FeedHandle | string): number;
	invalidateEpisode(feedId: FeedHandle | string, episodeId: EpisodeHandle | string): number;
	isDisposed(): boolean;
}

export interface FeedCapabilityTransport {
	getBytes<const Scope extends NetworkCapabilityScope>(
		capability: NetworkCapability<Scope>,
		expectedScope: Scope,
	): Promise<CapabilityBytesResponse>;
}

export interface FeedCapabilityNetworkRuntime {
	readonly broker: FeedCapabilityBroker;
	readonly transport: FeedCapabilityTransport;
	dispose(): void;
}

const feedResourceKinds = new Set<string>(FEED_NETWORK_RESOURCE_KINDS);
const episodeResourceKinds = new Set<string>(EPISODE_NETWORK_RESOURCE_KINDS);

const feedTargetFields = Object.freeze({
	subscription: "subscriptionUrl",
	"feed-artwork": "artworkUrl",
	site: "siteUrl",
} as const satisfies Record<FeedNetworkResourceKind, keyof FeedCapabilityEnvelope>);

const episodeTargetFields = Object.freeze({
	"episode-stream": "streamUrl",
	"episode-chapters": "chaptersUrl",
	"episode-artwork": "artworkUrl",
	"episode-item-link": "itemLink",
} as const);

const unavailableResults = Object.freeze({
	missing: Object.freeze({ status: "missing" as const }),
	invalid: Object.freeze({ status: "invalid" as const }),
	unavailable: Object.freeze({ status: "unavailable" as const }),
});

const missingProperty = Symbol("missing-property");
const leaseCancelled = Symbol("lease-cancelled");
const brokerConstructionToken = Object.freeze(Object.create(null) as object);

interface BrokerOperationLease {
	readonly scope: NetworkCapabilityScope;
	readonly cancellation: Promise<typeof leaseCancelled>;
	readonly resolveCancellation: () => void;
	capability?: NetworkCapability;
	cancelled: boolean;
}

function unavailableResult<Value>(status: UnavailableStatus): CapabilityUseResult<Value> {
	return unavailableResults[status];
}

function getOwnDataValue(record: object, property: string): unknown | typeof missingProperty {
	const descriptor = Object.getOwnPropertyDescriptor(record, property);
	return descriptor && "value" in descriptor ? descriptor.value : missingProperty;
}

function snapshotReadResult(
	value: unknown,
	feedId: FeedHandle,
): CapabilityReadResult<FeedCapabilityEnvelope> {
	try {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			return unavailableResults.invalid;
		}
		const keys = Reflect.ownKeys(value);
		if (keys.some((key) => typeof key !== "string")) return unavailableResults.invalid;
		const status = getOwnDataValue(value, "status");
		if (status === "available") {
			if (keys.length !== 2 || !keys.includes("status") || !keys.includes("value")) {
				return unavailableResults.invalid;
			}
			const envelope = validateFeedCapabilityEnvelope(
				getOwnDataValue(value, "value"),
				feedId,
			);
			return envelope ? { status: "available", value: envelope } : unavailableResults.invalid;
		}
		if (
			(status === "missing" || status === "invalid" || status === "unavailable") &&
			keys.length === 1 &&
			keys[0] === "status"
		) {
			return unavailableResults[status];
		}
		return unavailableResults.invalid;
	} catch {
		return unavailableResults.invalid;
	}
}

class FeedCapabilityBrokerImplementation implements FeedCapabilityBroker {
	readonly #reader: FeedCapabilityReader;
	readonly #issuer: ReturnType<typeof createCapabilityScopedNetworkRuntime>["issuer"];
	readonly #leases = new Set<BrokerOperationLease>();
	#disposed = false;

	constructor(
		constructionToken: object,
		reader: FeedCapabilityReader,
		issuer: ReturnType<typeof createCapabilityScopedNetworkRuntime>["issuer"],
	) {
		if (constructionToken !== brokerConstructionToken) {
			throw new TypeError("Feed capability brokers require trusted composition.");
		}
		if (!reader || typeof reader.readFeedCapabilities !== "function") {
			throw new TypeError("A feed capability reader is required.");
		}
		this.#reader = reader;
		this.#issuer = issuer;
		Object.freeze(this);
	}

	async withFeedResource<Kind extends FeedNetworkResourceKind, Value>(
		feedId: FeedHandle | string,
		reference: FeedCapabilityReference | string,
		resourceKind: Kind,
		operation: CapabilityUseOperation<IssuedFeedNetworkScope<Kind>, Value>,
	): Promise<CapabilityUseResult<Value>> {
		if (
			this.#disposed ||
			!isFeedHandle(feedId) ||
			!isFeedCapabilityReferenceFor(feedId, reference) ||
			!feedResourceKinds.has(resourceKind) ||
			typeof operation !== "function"
		) {
			return unavailableResult(this.#disposed ? "unavailable" : "invalid");
		}

		const scope = Object.freeze({ resourceKind, feedId }) as IssuedFeedNetworkScope<Kind>;
		const lease = this.#beginLease(scope);
		if (!lease) return unavailableResult("unavailable");
		try {
			const loaded = await this.#readFeedForLease(lease, feedId, reference);
			if (loaded === leaseCancelled) return unavailableResult("unavailable");
			if (loaded.status !== "available") return unavailableResult(loaded.status);
			const target = loaded.value[feedTargetFields[resourceKind]];
			if (typeof target !== "string") return unavailableResult("missing");

			return await this.#withCapability(
				lease,
				target,
				loaded.value.privateGrants?.[resourceKind],
				operation,
			);
		} finally {
			this.#finishLease(lease);
		}
	}

	async withEpisodeResource<Kind extends EpisodeNetworkResourceKind, Value>(
		feedId: FeedHandle | string,
		episodeId: EpisodeHandle | string,
		reference: FeedCapabilityReference | string,
		resourceKind: Kind,
		operation: CapabilityUseOperation<IssuedEpisodeNetworkScope<Kind>, Value>,
	): Promise<CapabilityUseResult<Value>> {
		if (
			this.#disposed ||
			!isFeedHandle(feedId) ||
			!isEpisodeHandle(episodeId) ||
			!isFeedCapabilityReferenceFor(feedId, reference) ||
			!episodeResourceKinds.has(resourceKind) ||
			typeof operation !== "function"
		) {
			return unavailableResult(this.#disposed ? "unavailable" : "invalid");
		}

		const scope = Object.freeze({
			resourceKind,
			feedId,
			episodeId,
		}) as IssuedEpisodeNetworkScope<Kind>;
		const lease = this.#beginLease(scope);
		if (!lease) return unavailableResult("unavailable");
		try {
			const loaded = await this.#readFeedForLease(lease, feedId, reference);
			if (loaded === leaseCancelled) return unavailableResult("unavailable");
			if (loaded.status !== "available") return unavailableResult(loaded.status);
			const episode = loaded.value.episodeResources[episodeId];
			if (!episode) return unavailableResult("missing");
			const target = episode[episodeTargetFields[resourceKind]];
			if (typeof target !== "string") return unavailableResult("missing");

			return await this.#withCapability(
				lease,
				target,
				loaded.value.privateGrants?.[resourceKind],
				operation,
			);
		} finally {
			this.#finishLease(lease);
		}
	}

	invalidateFeed(feedId: FeedHandle | string): number {
		return !this.#disposed && isFeedHandle(feedId)
			? this.#cancelMatching((scope) => scope.feedId === feedId)
			: 0;
	}

	invalidateEpisode(feedId: FeedHandle | string, episodeId: EpisodeHandle | string): number {
		return !this.#disposed && isFeedHandle(feedId) && isEpisodeHandle(episodeId)
			? this.#cancelMatching(
					(scope) =>
						scope.feedId === feedId &&
						"episodeId" in scope &&
						scope.episodeId === episodeId,
				)
			: 0;
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#cancelMatching(() => true);
	}

	isDisposed(): boolean {
		return this.#disposed;
	}

	async #withCapability<Scope extends NetworkCapabilityScope, Value>(
		lease: BrokerOperationLease & { readonly scope: Scope },
		target: string,
		privateOrigins: readonly string[] | undefined,
		operation: CapabilityUseOperation<Scope, Value>,
	): Promise<CapabilityUseResult<Value>> {
		if (this.#disposed || lease.cancelled) return unavailableResult("unavailable");
		const capability = this.#issuer.issue(lease.scope, target, privateOrigins);
		lease.capability = capability;
		try {
			const outcome = await Promise.race([
				Promise.resolve().then(() =>
					operation(Object.freeze({ capability, scope: lease.scope })),
				),
				lease.cancellation,
			]);
			if (outcome === leaseCancelled) return unavailableResult("unavailable");
			return this.#disposed || lease.cancelled
				? unavailableResult("unavailable")
				: Object.freeze({ status: "available", value: outcome });
		} catch (error) {
			if (this.#disposed || lease.cancelled) return unavailableResult("unavailable");
			throw error;
		}
	}

	#beginLease<Scope extends NetworkCapabilityScope>(
		scope: Scope,
	): (BrokerOperationLease & { readonly scope: Scope }) | null {
		if (this.#disposed) return null;
		let resolveCancellation!: () => void;
		const cancellation = new Promise<typeof leaseCancelled>((resolve) => {
			resolveCancellation = () => resolve(leaseCancelled);
		});
		const lease = {
			scope,
			cancellation,
			resolveCancellation,
			cancelled: false,
		} as BrokerOperationLease & { readonly scope: Scope };
		this.#leases.add(lease);
		return lease;
	}

	#finishLease(lease: BrokerOperationLease): void {
		this.#leases.delete(lease);
		if (lease.capability) this.#issuer.revoke(lease.capability);
	}

	#cancelMatching(predicate: (scope: NetworkCapabilityScope) => boolean): number {
		let revoked = 0;
		for (const lease of this.#leases) {
			if (lease.cancelled || !predicate(lease.scope)) continue;
			lease.cancelled = true;
			if (lease.capability && this.#issuer.revoke(lease.capability)) revoked += 1;
			lease.resolveCancellation();
		}
		return revoked;
	}

	async #readFeedForLease(
		lease: BrokerOperationLease,
		feedId: FeedHandle,
		reference: FeedCapabilityReference,
	): Promise<CapabilityReadResult<FeedCapabilityEnvelope> | typeof leaseCancelled> {
		return Promise.race([this.#readFeed(feedId, reference), lease.cancellation]);
	}

	async #readFeed(
		feedId: FeedHandle,
		reference: FeedCapabilityReference,
	): Promise<CapabilityReadResult<FeedCapabilityEnvelope>> {
		try {
			return snapshotReadResult(
				await this.#reader.readFeedCapabilities(feedId, reference),
				feedId,
			);
		} catch {
			return unavailableResults.unavailable;
		}
	}
}

/**
 * Trusted composition boundary. The low-level issuer and resolver never leave
 * this factory; callers receive only one-shot broker operations and the opaque
 * transport needed inside those operations.
 */
export function createFeedCapabilityNetworkRuntime(
	reader: FeedCapabilityReader,
	nameResolver: NetworkNameResolver,
	adapter: PinnedNetworkHopAdapter,
	scheduler: NetworkScheduler,
): FeedCapabilityNetworkRuntime {
	const network = createCapabilityScopedNetworkRuntime(nameResolver, adapter, scheduler);
	let broker: FeedCapabilityBrokerImplementation;
	try {
		broker = new FeedCapabilityBrokerImplementation(
			brokerConstructionToken,
			reader,
			network.issuer,
		);
	} catch (error) {
		network.dispose();
		throw error;
	}
	const brokerFacade = Object.create(null) as FeedCapabilityBroker;
	Object.defineProperties(brokerFacade, {
		withFeedResource: { value: broker.withFeedResource.bind(broker) },
		withEpisodeResource: { value: broker.withEpisodeResource.bind(broker) },
		invalidateFeed: { value: broker.invalidateFeed.bind(broker) },
		invalidateEpisode: { value: broker.invalidateEpisode.bind(broker) },
		isDisposed: { value: broker.isDisposed.bind(broker) },
	});
	Object.freeze(brokerFacade);

	const transportFacade = Object.create(null) as FeedCapabilityTransport;
	Object.defineProperty(transportFacade, "getBytes", {
		value: network.transport.getBytes.bind(network.transport),
	});
	Object.freeze(transportFacade);

	let disposed = false;
	return Object.freeze({
		broker: brokerFacade,
		transport: transportFacade,
		dispose(): void {
			if (disposed) return;
			disposed = true;
			broker.dispose();
			network.dispose();
		},
	});
}
