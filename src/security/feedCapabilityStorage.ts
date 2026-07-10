import {
	MAX_EPISODE_RESOURCES_PER_FEED,
	TARGET_ENVELOPE_SCHEMA_VERSION,
	validateEpisodeResourcesEnvelope,
	validateFeedCapabilityEnvelope,
	type EpisodeResourcesEnvelope,
	type FeedCapabilityEnvelope,
	type PrivateTargetGrants,
} from "./targetEnvelopes";
import {
	getEpisodeHandleHex,
	isEpisodeHandle,
	isFeedHandle,
	type EpisodeHandle,
	type FeedHandle,
} from "./resourceHandles";

export const MAX_SECRET_STORAGE_ITEM_BYTES = 128 * 1024;
export const FEED_CAPABILITY_STORAGE_SCHEMA_VERSION = 1;
export const MAX_PHYSICAL_PAGE_INDEX = 36 ** 3 - 1;

export type PhysicalSlot = "a" | "b";

export interface FeedCapabilityNamespaceMarker {
	schemaVersion: typeof FEED_CAPABILITY_STORAGE_SCHEMA_VERSION;
	kind: "feed-capability-namespace";
	feedId: FeedHandle;
}

export interface FeedCapabilityPageDescriptor {
	index: string;
	bucket: string;
	slot: PhysicalSlot;
	digest: string;
	byteLength: number;
	episodeCount: number;
}

export interface FeedCapabilityManifest {
	schemaVersion: typeof FEED_CAPABILITY_STORAGE_SCHEMA_VERSION;
	kind: "feed-capability-manifest";
	feedId: FeedHandle;
	generation: number;
	contentDigest: string;
	subscriptionUrl: string;
	artworkUrl?: string;
	siteUrl?: string;
	guid?: string;
	privateGrants?: PrivateTargetGrants;
	pages: FeedCapabilityPageDescriptor[];
}

export interface FeedCapabilityPage {
	schemaVersion: typeof FEED_CAPABILITY_STORAGE_SCHEMA_VERSION;
	kind: "feed-capability-page";
	feedId: FeedHandle;
	generation: number;
	index: string;
	bucket: string;
	episodeResources: Readonly<Partial<Record<EpisodeHandle, EpisodeResourcesEnvelope>>>;
}

export interface PreparedFeedCapabilityPage {
	page: FeedCapabilityPage;
	serialized: string;
	digest: string;
	byteLength: number;
	episodeCount: number;
}

const textEncoder = new TextEncoder();
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const BUCKET_PATTERN = /^[0-9a-f]{1,64}$/;
const PAGE_INDEX_PATTERN = /^[0-9a-z]{3}$/;
const MARKER_KEYS = new Set(["schemaVersion", "kind", "feedId"]);
const MANIFEST_KEYS = new Set([
	"schemaVersion",
	"kind",
	"feedId",
	"generation",
	"contentDigest",
	"subscriptionUrl",
	"artworkUrl",
	"siteUrl",
	"guid",
	"privateGrants",
	"pages",
]);
const PAGE_DESCRIPTOR_KEYS = new Set([
	"index",
	"bucket",
	"slot",
	"digest",
	"byteLength",
	"episodeCount",
]);
const PAGE_KEYS = new Set([
	"schemaVersion",
	"kind",
	"feedId",
	"generation",
	"index",
	"bucket",
	"episodeResources",
]);

type UnknownRecord = Record<string, unknown>;

function isPlainDataRecord(value: unknown): value is UnknownRecord {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return false;
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== "string") return false;
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !("value" in descriptor)) return false;
	}
	return true;
}

function isStrictRecord(value: unknown, allowedKeys: ReadonlySet<string>): value is UnknownRecord {
	return isPlainDataRecord(value) && Object.keys(value).every((key) => allowedKeys.has(key));
}

function isGeneration(value: unknown): value is number {
	return Number.isSafeInteger(value) && typeof value === "number" && value >= 1;
}

function isBoundedCount(value: unknown, maximum: number): value is number {
	return (
		Number.isSafeInteger(value) && typeof value === "number" && value >= 0 && value <= maximum
	);
}

function isSortedUnique(values: readonly string[]): boolean {
	for (let index = 1; index < values.length; index += 1) {
		if (values[index - 1] >= values[index]) return false;
	}
	return true;
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function metadataEnvelope(value: UnknownRecord): FeedCapabilityEnvelope | null {
	return validateFeedCapabilityEnvelope({
		schemaVersion: TARGET_ENVELOPE_SCHEMA_VERSION,
		kind: "feed-capability-bundle",
		feedId: value.feedId,
		subscriptionUrl: value.subscriptionUrl,
		...(Object.prototype.hasOwnProperty.call(value, "artworkUrl")
			? { artworkUrl: value.artworkUrl }
			: {}),
		...(Object.prototype.hasOwnProperty.call(value, "siteUrl")
			? { siteUrl: value.siteUrl }
			: {}),
		...(Object.prototype.hasOwnProperty.call(value, "guid") ? { guid: value.guid } : {}),
		...(Object.prototype.hasOwnProperty.call(value, "privateGrants")
			? { privateGrants: value.privateGrants }
			: {}),
		episodeResources: {},
	});
}

function normalizedMetadata(value: FeedCapabilityEnvelope) {
	return {
		subscriptionUrl: value.subscriptionUrl,
		...(value.artworkUrl ? { artworkUrl: value.artworkUrl } : {}),
		...(value.siteUrl ? { siteUrl: value.siteUrl } : {}),
		...(value.guid ? { guid: value.guid } : {}),
		...(value.privateGrants ? { privateGrants: value.privateGrants } : {}),
	};
}

export function serializedByteLength(value: string): number {
	return textEncoder.encode(value).byteLength;
}

export function encodeFeedCapabilityPageIndex(index: number): string | null {
	if (!Number.isSafeInteger(index) || index < 0 || index > MAX_PHYSICAL_PAGE_INDEX) return null;
	return index.toString(36).padStart(3, "0");
}

export function serializePhysicalItem(value: unknown): string | null {
	try {
		const serialized = JSON.stringify(value);
		return typeof serialized === "string" &&
			serializedByteLength(serialized) <= MAX_SECRET_STORAGE_ITEM_BYTES
			? serialized
			: null;
	} catch {
		return null;
	}
}

export async function sha256Hex(value: string): Promise<string> {
	// oxlint-disable-next-line obsidianmd/no-global-this -- Web Crypto is runtime-global in browser and Node verification environments.
	const crypto = globalThis.crypto;
	if (!crypto?.subtle) throw new Error("Web Crypto is unavailable");
	const digest = await crypto.subtle.digest(
		"SHA-256",
		textEncoder.encode(value) as Uint8Array<ArrayBuffer>,
	);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function validateNamespaceMarker(
	value: unknown,
	expectedFeedId?: unknown,
): FeedCapabilityNamespaceMarker | null {
	try {
		if (!isStrictRecord(value, MARKER_KEYS)) return null;
		if (
			value.schemaVersion !== FEED_CAPABILITY_STORAGE_SCHEMA_VERSION ||
			value.kind !== "feed-capability-namespace" ||
			!isFeedHandle(value.feedId) ||
			(expectedFeedId !== undefined && value.feedId !== expectedFeedId)
		) {
			return null;
		}
		return {
			schemaVersion: FEED_CAPABILITY_STORAGE_SCHEMA_VERSION,
			kind: "feed-capability-namespace",
			feedId: value.feedId,
		};
	} catch {
		return null;
	}
}

function validatePageDescriptor(value: unknown): FeedCapabilityPageDescriptor | null {
	if (!isStrictRecord(value, PAGE_DESCRIPTOR_KEYS)) return null;
	if (
		typeof value.index !== "string" ||
		!PAGE_INDEX_PATTERN.test(value.index) ||
		typeof value.bucket !== "string" ||
		!BUCKET_PATTERN.test(value.bucket) ||
		(value.slot !== "a" && value.slot !== "b") ||
		typeof value.digest !== "string" ||
		!DIGEST_PATTERN.test(value.digest) ||
		!isBoundedCount(value.byteLength, MAX_SECRET_STORAGE_ITEM_BYTES) ||
		value.byteLength === 0 ||
		!isBoundedCount(value.episodeCount, MAX_EPISODE_RESOURCES_PER_FEED) ||
		value.episodeCount === 0
	) {
		return null;
	}
	return {
		index: value.index,
		bucket: value.bucket,
		slot: value.slot,
		digest: value.digest,
		byteLength: value.byteLength,
		episodeCount: value.episodeCount,
	};
}

export function validateManifest(
	value: unknown,
	expectedFeedId?: unknown,
): FeedCapabilityManifest | null {
	try {
		if (!isStrictRecord(value, MANIFEST_KEYS)) return null;
		if (
			value.schemaVersion !== FEED_CAPABILITY_STORAGE_SCHEMA_VERSION ||
			value.kind !== "feed-capability-manifest" ||
			!isFeedHandle(value.feedId) ||
			(expectedFeedId !== undefined && value.feedId !== expectedFeedId) ||
			!isGeneration(value.generation) ||
			typeof value.contentDigest !== "string" ||
			!DIGEST_PATTERN.test(value.contentDigest) ||
			!Array.isArray(value.pages) ||
			value.pages.length > MAX_EPISODE_RESOURCES_PER_FEED
		) {
			return null;
		}

		const metadata = metadataEnvelope(value);
		if (!metadata) return null;
		const pages: FeedCapabilityPageDescriptor[] = [];
		let totalEpisodeCount = 0;
		for (let index = 0; index < value.pages.length; index += 1) {
			const candidate = value.pages[index];
			const descriptor = validatePageDescriptor(candidate);
			if (!descriptor || descriptor.index !== encodeFeedCapabilityPageIndex(index))
				return null;
			totalEpisodeCount += descriptor.episodeCount;
			if (totalEpisodeCount > MAX_EPISODE_RESOURCES_PER_FEED) return null;
			pages.push(descriptor);
		}
		const buckets = pages.map((page) => page.bucket);
		if (!isSortedUnique(buckets)) return null;
		for (let index = 1; index < buckets.length; index += 1) {
			if (buckets[index].startsWith(buckets[index - 1])) return null;
		}

		const normalized: FeedCapabilityManifest = {
			schemaVersion: FEED_CAPABILITY_STORAGE_SCHEMA_VERSION,
			kind: "feed-capability-manifest",
			feedId: value.feedId,
			generation: value.generation,
			contentDigest: value.contentDigest,
			...normalizedMetadata(metadata),
			pages,
		};
		return serializePhysicalItem(normalized) ? normalized : null;
	} catch {
		return null;
	}
}

export function validatePage(
	value: unknown,
	expectedFeedId?: unknown,
	expectedGeneration?: unknown,
	expectedIndex?: unknown,
	expectedBucket?: unknown,
): FeedCapabilityPage | null {
	try {
		if (!isStrictRecord(value, PAGE_KEYS)) return null;
		if (
			value.schemaVersion !== FEED_CAPABILITY_STORAGE_SCHEMA_VERSION ||
			value.kind !== "feed-capability-page" ||
			!isFeedHandle(value.feedId) ||
			(expectedFeedId !== undefined && value.feedId !== expectedFeedId) ||
			!isGeneration(value.generation) ||
			(expectedGeneration !== undefined && value.generation !== expectedGeneration) ||
			typeof value.index !== "string" ||
			!PAGE_INDEX_PATTERN.test(value.index) ||
			(expectedIndex !== undefined && value.index !== expectedIndex) ||
			typeof value.bucket !== "string" ||
			!BUCKET_PATTERN.test(value.bucket) ||
			(expectedBucket !== undefined && value.bucket !== expectedBucket) ||
			!isPlainDataRecord(value.episodeResources)
		) {
			return null;
		}

		const episodeIds = Object.keys(value.episodeResources);
		if (
			episodeIds.length === 0 ||
			episodeIds.length > MAX_EPISODE_RESOURCES_PER_FEED ||
			!isSortedUnique(episodeIds)
		) {
			return null;
		}
		const episodeResources: Partial<Record<EpisodeHandle, EpisodeResourcesEnvelope>> = {};
		for (const episodeId of episodeIds) {
			const hex = getEpisodeHandleHex(episodeId);
			if (!hex || !hex.startsWith(value.bucket) || !isEpisodeHandle(episodeId)) return null;
			const entry = validateEpisodeResourcesEnvelope(
				value.episodeResources[episodeId],
				value.feedId,
				episodeId,
			);
			if (!entry) return null;
			episodeResources[episodeId] = entry;
		}

		const normalized: FeedCapabilityPage = {
			schemaVersion: FEED_CAPABILITY_STORAGE_SCHEMA_VERSION,
			kind: "feed-capability-page",
			feedId: value.feedId,
			generation: value.generation,
			index: value.index,
			bucket: value.bucket,
			episodeResources,
		};
		return serializePhysicalItem(normalized) ? normalized : null;
	} catch {
		return null;
	}
}

function makePage(
	envelope: FeedCapabilityEnvelope,
	generation: number,
	index: string,
	bucket: string,
	episodeIds: readonly EpisodeHandle[],
): FeedCapabilityPage {
	const episodeResources: Partial<Record<EpisodeHandle, EpisodeResourcesEnvelope>> = {};
	for (const episodeId of episodeIds) {
		const entry = envelope.episodeResources[episodeId];
		if (entry) episodeResources[episodeId] = entry;
	}
	return {
		schemaVersion: FEED_CAPABILITY_STORAGE_SCHEMA_VERSION,
		kind: "feed-capability-page",
		feedId: envelope.feedId,
		generation,
		index,
		bucket,
		episodeResources,
	};
}

interface PagePartition {
	bucket: string;
	episodeIds: readonly EpisodeHandle[];
}

function partitionBucket(
	envelope: FeedCapabilityEnvelope,
	generation: number,
	bucket: string,
	episodeIds: readonly EpisodeHandle[],
): PagePartition[] {
	const page = makePage(envelope, generation, "000", bucket, episodeIds);
	const serialized = serializePhysicalItem(page);
	if (serialized) return [{ bucket, episodeIds }];
	if (bucket.length >= 64) throw new Error("Episode resource cannot fit a physical page");

	const groups = new Map<string, EpisodeHandle[]>();
	for (const episodeId of episodeIds) {
		const hex = getEpisodeHandleHex(episodeId);
		if (!hex) throw new Error("Invalid episode handle");
		const childBucket = hex.slice(0, bucket.length + 1);
		const group = groups.get(childBucket) ?? [];
		group.push(episodeId);
		groups.set(childBucket, group);
	}

	return [...groups.entries()]
		.sort(([left], [right]) => compareStrings(left, right))
		.flatMap(([childBucket, childIds]) =>
			partitionBucket(envelope, generation, childBucket, childIds),
		);
}

export async function preparePages(
	envelope: FeedCapabilityEnvelope,
	generation: number,
): Promise<PreparedFeedCapabilityPage[]> {
	const groups = new Map<string, EpisodeHandle[]>();
	for (const rawEpisodeId of Object.keys(envelope.episodeResources).sort()) {
		if (!isEpisodeHandle(rawEpisodeId)) throw new Error("Invalid episode handle");
		const hex = getEpisodeHandleHex(rawEpisodeId);
		if (!hex) throw new Error("Invalid episode handle");
		const bucket = hex.slice(0, 1);
		const group = groups.get(bucket) ?? [];
		group.push(rawEpisodeId);
		groups.set(bucket, group);
	}

	const partitions = [...groups.entries()]
		.sort(([left], [right]) => compareStrings(left, right))
		.flatMap(([bucket, episodeIds]) =>
			partitionBucket(envelope, generation, bucket, episodeIds),
		);
	return Promise.all(
		partitions.map(async ({ bucket, episodeIds }, ordinal) => {
			const index = encodeFeedCapabilityPageIndex(ordinal);
			if (!index) throw new Error("Physical page index is exhausted");
			const page = makePage(envelope, generation, index, bucket, episodeIds);
			const serialized = serializePhysicalItem(page);
			if (!serialized) throw new Error("Episode resources cannot fit a physical page");
			return {
				page,
				serialized,
				digest: await sha256Hex(serialized),
				byteLength: serializedByteLength(serialized),
				episodeCount: Object.keys(page.episodeResources).length,
			};
		}),
	);
}

export function makeManifest(
	envelope: FeedCapabilityEnvelope,
	generation: number,
	contentDigest: string,
	pages: FeedCapabilityPageDescriptor[],
): FeedCapabilityManifest {
	return {
		schemaVersion: FEED_CAPABILITY_STORAGE_SCHEMA_VERSION,
		kind: "feed-capability-manifest",
		feedId: envelope.feedId,
		generation,
		contentDigest,
		...normalizedMetadata(envelope),
		pages: [...pages].sort((left, right) => compareStrings(left.bucket, right.bucket)),
	};
}

export function reconstructEnvelope(
	manifest: FeedCapabilityManifest,
	pages: readonly FeedCapabilityPage[],
): FeedCapabilityEnvelope | null {
	const episodeResources: Partial<Record<EpisodeHandle, EpisodeResourcesEnvelope>> = {};
	for (const page of pages) {
		for (const rawEpisodeId of Object.keys(page.episodeResources)) {
			if (!isEpisodeHandle(rawEpisodeId) || episodeResources[rawEpisodeId]) return null;
			const entry = page.episodeResources[rawEpisodeId];
			if (!entry) return null;
			episodeResources[rawEpisodeId] = entry;
		}
	}
	return validateFeedCapabilityEnvelope({
		schemaVersion: TARGET_ENVELOPE_SCHEMA_VERSION,
		kind: "feed-capability-bundle",
		feedId: manifest.feedId,
		subscriptionUrl: manifest.subscriptionUrl,
		...(manifest.artworkUrl ? { artworkUrl: manifest.artworkUrl } : {}),
		...(manifest.siteUrl ? { siteUrl: manifest.siteUrl } : {}),
		...(manifest.guid ? { guid: manifest.guid } : {}),
		...(manifest.privateGrants ? { privateGrants: manifest.privateGrants } : {}),
		episodeResources,
	});
}
