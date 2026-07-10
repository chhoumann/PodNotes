import {
	isEpisodeHandle,
	isFeedHandle,
	type EpisodeHandle,
	type FeedHandle,
} from "src/security/resourceHandles";

import { parseTargetPolicyView } from "./LiteralTargetClassifier";

export { MAX_NETWORK_TARGET_BYTES } from "./LiteralTargetClassifier";
export const MAX_NETWORK_PRIVATE_ORIGINS = 16;

export const FEED_NETWORK_RESOURCE_KINDS = ["subscription", "feed-artwork", "site"] as const;
export const EPISODE_NETWORK_RESOURCE_KINDS = [
	"episode-stream",
	"episode-chapters",
	"episode-artwork",
	"episode-item-link",
] as const;

export type FeedNetworkResourceKind = (typeof FEED_NETWORK_RESOURCE_KINDS)[number];
export type EpisodeNetworkResourceKind = (typeof EPISODE_NETWORK_RESOURCE_KINDS)[number];
export type NetworkResourceKind = FeedNetworkResourceKind | EpisodeNetworkResourceKind;

export interface FeedNetworkCapabilityScope {
	readonly resourceKind: FeedNetworkResourceKind;
	readonly feedId: FeedHandle;
}

export interface EpisodeNetworkCapabilityScope {
	readonly resourceKind: EpisodeNetworkResourceKind;
	readonly feedId: FeedHandle;
	readonly episodeId: EpisodeHandle;
}

export type NetworkCapabilityScope = FeedNetworkCapabilityScope | EpisodeNetworkCapabilityScope;

export const NETWORK_RESOURCE_LABELS = Object.freeze({
	subscription: "podcast subscription",
	"feed-artwork": "podcast artwork",
	site: "podcast site",
	"episode-stream": "episode audio",
	"episode-chapters": "episode chapters",
	"episode-artwork": "episode artwork",
	"episode-item-link": "episode page",
} as const satisfies Record<NetworkResourceKind, string>);

export type NetworkResourceLabel = (typeof NETWORK_RESOURCE_LABELS)[NetworkResourceKind];

declare const networkCapabilityBrand: unique symbol;

/**
 * An opaque authority token. The brand exists only to help TypeScript. Runtime
 * tokens are frozen, null-prototype objects with no own properties or symbols.
 */
export interface NetworkCapability<Scope extends NetworkCapabilityScope = NetworkCapabilityScope> {
	readonly [networkCapabilityBrand]: Scope;
}

export interface NetworkCapabilityResolution<
	Scope extends NetworkCapabilityScope = NetworkCapabilityScope,
> {
	readonly scope: Readonly<Scope>;
	readonly target: string;
	readonly privateOrigins: readonly string[];
	readonly resourceLabel: NetworkResourceLabel;
	readonly revocationSignal: AbortSignal;
	readonly authoritySignal: AbortSignal;
}

export interface NetworkCapabilityIssuer {
	issue<const Scope extends NetworkCapabilityScope>(
		scope: Scope,
		target: string,
		privateOrigins?: readonly string[],
	): NetworkCapability<Scope>;
	revoke(capability: unknown): boolean;
}

export interface NetworkCapabilityResolver {
	resolve<const Scope extends NetworkCapabilityScope>(
		capability: NetworkCapability,
		expectedScope: Scope,
	): NetworkCapabilityResolution<Scope>;
}

/**
 * Construction-only object. Application composition should distribute the
 * issuer and resolver facets independently to keep target issuance separate
 * from transport resolution.
 */
export interface NetworkCapabilityAuthority {
	readonly issuer: NetworkCapabilityIssuer;
	readonly resolver: NetworkCapabilityResolver;
	dispose(): void;
}

export class NetworkCapabilityError extends Error {
	constructor(operation: "issue" | "resolve") {
		super(
			operation === "issue"
				? "Invalid network capability request."
				: "Network capability is invalid or unavailable.",
		);
		this.name = "NetworkCapabilityError";
	}
}

type UnknownRecord = Record<string, unknown>;

const feedResourceKinds = new Set<string>(FEED_NETWORK_RESOURCE_KINDS);
const episodeResourceKinds = new Set<string>(EPISODE_NETWORK_RESOURCE_KINDS);
const authenticResolvers = new WeakSet<object>();

function isBoundedHttpTarget(value: unknown): value is string {
	const policy = parseTargetPolicyView(value);
	return policy.ok && !policy.value.hasCredentials;
}

function isExactPrivateOrigin(value: unknown): value is string {
	if (!isBoundedHttpTarget(value)) return false;
	try {
		const parsed = new URL(value);
		return (
			!parsed.username &&
			!parsed.password &&
			parsed.pathname === "/" &&
			!parsed.search &&
			!parsed.hash &&
			parsed.origin === value
		);
	} catch {
		return false;
	}
}

function copyPrivateOrigins(value: unknown): readonly string[] | null {
	if (value === undefined) return Object.freeze([] as string[]);
	try {
		if (!Array.isArray(value)) return null;
		const length = value.length;
		if (length > MAX_NETWORK_PRIVATE_ORIGINS) return null;
		const ownKeys = Reflect.ownKeys(value);
		if (ownKeys.length !== length + 1 || !ownKeys.includes("length")) return null;

		const origins: string[] = [];
		for (let index = 0; index < length; index += 1) {
			const key = String(index);
			if (!ownKeys.includes(key)) return null;
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor?.enumerable || !("value" in descriptor)) return null;
			if (!isExactPrivateOrigin(descriptor.value)) return null;
			origins.push(descriptor.value);
		}
		if (new Set(origins).size !== origins.length) return null;
		return Object.freeze(origins);
	} catch {
		return null;
	}
}

function strictDataRecord(value: unknown): UnknownRecord | null {
	try {
		if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) return null;

		const record = Object.create(null) as UnknownRecord;
		for (const key of Reflect.ownKeys(value)) {
			if (typeof key !== "string") return null;
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor?.enumerable || !("value" in descriptor)) return null;
			record[key] = descriptor.value;
		}
		return record;
	} catch {
		return null;
	}
}

function hasExactKeys(record: UnknownRecord, expected: readonly string[]): boolean {
	const keys = Object.keys(record);
	return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function copyScope(value: unknown): NetworkCapabilityScope | null {
	const record = strictDataRecord(value);
	if (!record || typeof record.resourceKind !== "string" || !isFeedHandle(record.feedId)) {
		return null;
	}

	if (feedResourceKinds.has(record.resourceKind)) {
		if (!hasExactKeys(record, ["resourceKind", "feedId"])) return null;
		return Object.freeze({
			resourceKind: record.resourceKind as FeedNetworkResourceKind,
			feedId: record.feedId,
		});
	}

	if (episodeResourceKinds.has(record.resourceKind)) {
		if (
			!hasExactKeys(record, ["resourceKind", "feedId", "episodeId"]) ||
			!isEpisodeHandle(record.episodeId)
		) {
			return null;
		}
		return Object.freeze({
			resourceKind: record.resourceKind as EpisodeNetworkResourceKind,
			feedId: record.feedId,
			episodeId: record.episodeId,
		});
	}

	return null;
}

function scopesMatch(left: NetworkCapabilityScope, right: NetworkCapabilityScope): boolean {
	if (left.resourceKind !== right.resourceKind || left.feedId !== right.feedId) return false;
	if (episodeResourceKinds.has(left.resourceKind)) {
		return "episodeId" in left && "episodeId" in right && left.episodeId === right.episodeId;
	}
	return !("episodeId" in left) && !("episodeId" in right);
}

function isObject(value: unknown): value is object {
	return (typeof value === "object" && value !== null) || typeof value === "function";
}

/** Runtime authentication for the resolver facet issued by this module. */
export function isNetworkCapabilityResolver(value: unknown): value is NetworkCapabilityResolver {
	return isObject(value) && authenticResolvers.has(value);
}

/**
 * Low-level composition primitive. Never distribute the returned aggregate;
 * application code must trap its resolver inside the network runtime and expose
 * only the issuer plus purpose-scoped operations.
 */
export function createNetworkCapabilityAuthority(): NetworkCapabilityAuthority {
	const resolutions = new WeakMap<
		object,
		{
			readonly resolution: NetworkCapabilityResolution;
			readonly revocation: AbortController;
		}
	>();
	const authorityRevocation = new AbortController();
	let disposed = false;

	const issuer: NetworkCapabilityIssuer = Object.freeze({
		issue<const Scope extends NetworkCapabilityScope>(
			scope: Scope,
			target: string,
			privateOrigins?: readonly string[],
		): NetworkCapability<Scope> {
			const copiedScope = copyScope(scope);
			if (disposed || !copiedScope || !isBoundedHttpTarget(target)) {
				throw new NetworkCapabilityError("issue");
			}
			const copiedPrivateOrigins = copyPrivateOrigins(privateOrigins);
			if (!copiedPrivateOrigins) throw new NetworkCapabilityError("issue");

			const token = Object.freeze(Object.create(null) as object);
			const revocation = new AbortController();
			const resolution = Object.freeze({
				scope: copiedScope,
				target,
				privateOrigins: copiedPrivateOrigins,
				resourceLabel: NETWORK_RESOURCE_LABELS[copiedScope.resourceKind],
				revocationSignal: revocation.signal,
				authoritySignal: authorityRevocation.signal,
			});
			resolutions.set(token, { resolution, revocation });
			return token as NetworkCapability<Scope>;
		},
		revoke(capability: unknown): boolean {
			if (disposed || !isObject(capability)) return false;
			const entry = resolutions.get(capability);
			if (!entry || !resolutions.delete(capability)) return false;
			entry.revocation.abort();
			return true;
		},
	});

	const resolver: NetworkCapabilityResolver = Object.freeze({
		resolve<const Scope extends NetworkCapabilityScope>(
			capability: NetworkCapability,
			expectedScope: Scope,
		): NetworkCapabilityResolution<Scope> {
			const copiedExpectedScope = copyScope(expectedScope);
			if (!copiedExpectedScope || disposed || !isObject(capability)) {
				throw new NetworkCapabilityError("resolve");
			}

			const entry = resolutions.get(capability);
			if (!entry || !scopesMatch(entry.resolution.scope, copiedExpectedScope)) {
				throw new NetworkCapabilityError("resolve");
			}
			return entry.resolution as NetworkCapabilityResolution<Scope>;
		},
	});
	authenticResolvers.add(resolver);

	return Object.freeze({
		issuer,
		resolver,
		dispose(): void {
			if (disposed) return;
			disposed = true;
			authorityRevocation.abort();
		},
	});
}
