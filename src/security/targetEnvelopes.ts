import {
	isEpisodeHandle,
	isFeedHandle,
	type EpisodeHandle,
	type FeedHandle,
} from "./resourceHandles";

export const TARGET_ENVELOPE_SCHEMA_VERSION = 1;
export const MAX_TARGET_URL_BYTES = 16 * 1024;
export const MAX_GUID_BYTES = 8 * 1024;
export const MAX_EPISODE_RESOURCES_ENVELOPE_BYTES = 64 * 1024;
export const MAX_FEED_CAPABILITY_ENVELOPE_BYTES = 1024 * 1024;
export const MAX_FEED_CAPABILITY_METADATA_BYTES = 64 * 1024;
export const MAX_EPISODE_RESOURCES_PER_FEED = 4096;
export const MAX_PRIVATE_GRANTS_PER_KIND = 16;

export const PRIVATE_TARGET_GRANT_KINDS = [
	"subscription",
	"feed-artwork",
	"site",
	"episode-stream",
	"episode-chapters",
	"episode-artwork",
	"episode-item-link",
] as const;

export type PrivateTargetGrantKind = (typeof PRIVATE_TARGET_GRANT_KINDS)[number];
export type PrivateTargetGrants = Partial<Record<PrivateTargetGrantKind, string[]>>;

export interface EpisodeResourcesEnvelope {
	schemaVersion: typeof TARGET_ENVELOPE_SCHEMA_VERSION;
	kind: "episode-resources";
	feedId: FeedHandle;
	episodeId: EpisodeHandle;
	streamUrl?: string;
	chaptersUrl?: string;
	artworkUrl?: string;
	itemLink?: string;
	guid?: string;
}

export type EpisodeResourcesById = Readonly<
	Partial<Record<EpisodeHandle, EpisodeResourcesEnvelope>>
>;

export interface FeedCapabilityEnvelope {
	schemaVersion: typeof TARGET_ENVELOPE_SCHEMA_VERSION;
	kind: "feed-capability-bundle";
	feedId: FeedHandle;
	subscriptionUrl: string;
	artworkUrl?: string;
	siteUrl?: string;
	guid?: string;
	privateGrants?: PrivateTargetGrants;
	episodeResources: EpisodeResourcesById;
}

const textEncoder = new TextEncoder();
const FEED_CAPABILITY_KEYS = new Set([
	"schemaVersion",
	"kind",
	"feedId",
	"subscriptionUrl",
	"artworkUrl",
	"siteUrl",
	"guid",
	"privateGrants",
	"episodeResources",
]);
const EPISODE_KEYS = new Set([
	"schemaVersion",
	"kind",
	"feedId",
	"episodeId",
	"streamUrl",
	"chaptersUrl",
	"artworkUrl",
	"itemLink",
	"guid",
]);
const PRIVATE_GRANT_KEYS = new Set<string>(PRIVATE_TARGET_GRANT_KINDS);

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

function hasUnsafeUnicode(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 0x1f || code === 0x7f) return true;
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
			index += 1;
		} else if (code >= 0xdc00 && code <= 0xdfff) {
			return true;
		}
	}
	return false;
}

function isBoundedString(value: unknown, maximumBytes: number): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.trim() === value &&
		!hasUnsafeUnicode(value) &&
		textEncoder.encode(value).byteLength <= maximumBytes
	);
}

function normalizeHttpTarget(value: unknown): string | undefined {
	if (!isBoundedString(value, MAX_TARGET_URL_BYTES)) return undefined;
	try {
		const url = new URL(value);
		if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
		// Validate with URL, but preserve the exact configured bytes. Normalizing a
		// signed URL can change its host casing, default port, or encoded path and
		// invalidate a signature even when the resulting URL is otherwise equivalent.
		return value;
	} catch {
		return undefined;
	}
}

function normalizePrivateOrigin(value: unknown): string | undefined {
	const normalized = normalizeHttpTarget(value);
	if (!normalized) return undefined;
	const url = new URL(normalized);
	if (
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash ||
		value !== url.origin
	) {
		return undefined;
	}
	return url.origin;
}

function normalizePrivateGrants(value: unknown): PrivateTargetGrants | null | undefined {
	if (value === undefined) return undefined;
	if (!isStrictRecord(value, PRIVATE_GRANT_KEYS)) return null;

	const normalized: PrivateTargetGrants = {};
	for (const kind of PRIVATE_TARGET_GRANT_KINDS) {
		if (!Object.prototype.hasOwnProperty.call(value, kind)) continue;
		const grants = value[kind];
		if (
			!Array.isArray(grants) ||
			grants.length === 0 ||
			grants.length > MAX_PRIVATE_GRANTS_PER_KIND
		) {
			return null;
		}
		for (let index = 0; index < grants.length; index += 1) {
			if (!Object.prototype.hasOwnProperty.call(grants, index)) return null;
		}
		const origins = grants.map(normalizePrivateOrigin);
		if (origins.some((origin) => origin === undefined)) return null;
		const concrete = origins as string[];
		if (new Set(concrete).size !== concrete.length) return null;
		normalized[kind] = concrete;
	}
	return normalized;
}

function readOptionalTarget(record: UnknownRecord, key: string): string | null | undefined {
	if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined;
	return normalizeHttpTarget(record[key]) ?? null;
}

function serializedFits(value: unknown, maximumBytes: number): boolean {
	try {
		return textEncoder.encode(JSON.stringify(value)).byteLength <= maximumBytes;
	} catch {
		return false;
	}
}

function validateEpisodeResourcesEnvelopeUnchecked(
	value: unknown,
	expectedFeedId?: unknown,
	expectedEpisodeId?: unknown,
): EpisodeResourcesEnvelope | null {
	if (!isStrictRecord(value, EPISODE_KEYS)) return null;
	if (
		value.schemaVersion !== TARGET_ENVELOPE_SCHEMA_VERSION ||
		value.kind !== "episode-resources" ||
		!isFeedHandle(value.feedId) ||
		!isEpisodeHandle(value.episodeId) ||
		(expectedFeedId !== undefined && value.feedId !== expectedFeedId) ||
		(expectedEpisodeId !== undefined && value.episodeId !== expectedEpisodeId)
	) {
		return null;
	}

	const streamUrl = readOptionalTarget(value, "streamUrl");
	const chaptersUrl = readOptionalTarget(value, "chaptersUrl");
	const artworkUrl = readOptionalTarget(value, "artworkUrl");
	const itemLink = readOptionalTarget(value, "itemLink");
	if (streamUrl === null || chaptersUrl === null || artworkUrl === null || itemLink === null) {
		return null;
	}
	if (
		Object.prototype.hasOwnProperty.call(value, "guid") &&
		!isBoundedString(value.guid, MAX_GUID_BYTES)
	) {
		return null;
	}
	if (!streamUrl && !chaptersUrl && !artworkUrl && !itemLink && typeof value.guid !== "string") {
		return null;
	}

	const normalized: EpisodeResourcesEnvelope = {
		schemaVersion: TARGET_ENVELOPE_SCHEMA_VERSION,
		kind: "episode-resources",
		feedId: value.feedId,
		episodeId: value.episodeId,
		...(streamUrl ? { streamUrl } : {}),
		...(chaptersUrl ? { chaptersUrl } : {}),
		...(artworkUrl ? { artworkUrl } : {}),
		...(itemLink ? { itemLink } : {}),
		...(typeof value.guid === "string" ? { guid: value.guid } : {}),
	};
	return serializedFits(normalized, MAX_EPISODE_RESOURCES_ENVELOPE_BYTES) ? normalized : null;
}

export function validateEpisodeResourcesEnvelope(
	value: unknown,
	expectedFeedId?: unknown,
	expectedEpisodeId?: unknown,
): EpisodeResourcesEnvelope | null {
	try {
		return validateEpisodeResourcesEnvelopeUnchecked(value, expectedFeedId, expectedEpisodeId);
	} catch {
		return null;
	}
}

function validateFeedCapabilityEnvelopeUnchecked(
	value: unknown,
	expectedFeedId?: unknown,
): FeedCapabilityEnvelope | null {
	if (!isStrictRecord(value, FEED_CAPABILITY_KEYS)) return null;
	if (
		value.schemaVersion !== TARGET_ENVELOPE_SCHEMA_VERSION ||
		value.kind !== "feed-capability-bundle" ||
		!isFeedHandle(value.feedId) ||
		(expectedFeedId !== undefined && value.feedId !== expectedFeedId) ||
		!isPlainDataRecord(value.episodeResources)
	) {
		return null;
	}

	const episodeIds = Object.keys(value.episodeResources);
	if (episodeIds.length > MAX_EPISODE_RESOURCES_PER_FEED) return null;

	const subscriptionUrl = normalizeHttpTarget(value.subscriptionUrl);
	const artworkUrl = readOptionalTarget(value, "artworkUrl");
	const siteUrl = readOptionalTarget(value, "siteUrl");
	const privateGrants = normalizePrivateGrants(value.privateGrants);
	if (!subscriptionUrl || artworkUrl === null || siteUrl === null || privateGrants === null) {
		return null;
	}
	if (
		Object.prototype.hasOwnProperty.call(value, "guid") &&
		!isBoundedString(value.guid, MAX_GUID_BYTES)
	) {
		return null;
	}
	const normalizedMetadata: Omit<FeedCapabilityEnvelope, "episodeResources"> = {
		schemaVersion: TARGET_ENVELOPE_SCHEMA_VERSION,
		kind: "feed-capability-bundle" as const,
		feedId: value.feedId,
		subscriptionUrl,
		...(artworkUrl ? { artworkUrl } : {}),
		...(siteUrl ? { siteUrl } : {}),
		...(typeof value.guid === "string" ? { guid: value.guid } : {}),
		...(privateGrants ? { privateGrants } : {}),
	};
	if (!serializedFits(normalizedMetadata, MAX_FEED_CAPABILITY_METADATA_BYTES)) return null;

	const episodeResources: Partial<Record<EpisodeHandle, EpisodeResourcesEnvelope>> = {};
	for (const episodeId of episodeIds.sort()) {
		if (!isEpisodeHandle(episodeId)) return null;
		const entry = validateEpisodeResourcesEnvelope(
			value.episodeResources[episodeId],
			value.feedId,
			episodeId,
		);
		if (!entry) return null;
		episodeResources[episodeId] = entry;
	}

	const normalized: FeedCapabilityEnvelope = {
		...normalizedMetadata,
		episodeResources,
	};
	return serializedFits(normalized, MAX_FEED_CAPABILITY_ENVELOPE_BYTES) ? normalized : null;
}

export function validateFeedCapabilityEnvelope(
	value: unknown,
	expectedFeedId?: unknown,
): FeedCapabilityEnvelope | null {
	try {
		return validateFeedCapabilityEnvelopeUnchecked(value, expectedFeedId);
	} catch {
		return null;
	}
}
