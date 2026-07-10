import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

const FEED_ID_PREFIX = "pnf1_";
const EPISODE_ID_PREFIX = "pne1_";
const SHA256_BASE64URL_LENGTH = 43;
const CANONICAL_ID_LENGTH = FEED_ID_PREFIX.length + SHA256_BASE64URL_LENGTH;
const CANONICAL_ID_BODY = /^[A-Za-z0-9_-]{43}$/;

/**
 * Identity inputs come from untrusted feeds and imports. The digest is fixed
 * length, but bounding its preimage also prevents oversized input from causing
 * avoidable allocation or hashing work.
 */
export const MAX_IDENTITY_COMPONENT_BYTES = 16 * 1024;
export const MAX_IDENTITY_PREIMAGE_BYTES = 64 * 1024;
export const MAX_EPISODE_IDENTITY_ALIASES = 32;

const IDENTITY_NAMESPACE = "com.chhoumann.podnotes.identity";
const IDENTITY_VERSION = 1;
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export type CanonicalFeedId = string & { readonly __feedId: unique symbol };
export type CanonicalEpisodeId = string & { readonly __episodeId: unique symbol };

type IdentityDomain =
	| "feed-url"
	| "episode-guid"
	| "episode-media"
	| "episode-item-link"
	| "episode-source-tuple"
	| "local-vault-path";

export type EpisodeIdentityCandidateKind = "guid" | "media" | "itemLink" | "source";

export interface EpisodeIdentitySource {
	feedId: string;
	guid?: string;
	enclosureUrl: string;
	itemLink?: string;
	publishedAt?: string;
	title: string;
}

export interface EpisodeIdentityCandidate {
	kind: EpisodeIdentityCandidateKind;
	id: CanonicalEpisodeId;
}

export interface AssignedEpisodeIdentity {
	episodeId?: CanonicalEpisodeId;
	/** Current strong locators plus bounded, trusted history after reconciliation. */
	aliases: readonly CanonicalEpisodeId[];
}

export interface PreviousEpisodeIdentity {
	episodeId: unknown;
	source: unknown;
	aliases?: unknown;
}

function encodeBase64Url(bytes: Uint8Array): string {
	let encoded = "";
	for (let index = 0; index < bytes.length; index += 3) {
		const first = bytes[index] ?? 0;
		const second = bytes[index + 1];
		const third = bytes[index + 2];
		const block = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);

		encoded += BASE64URL_ALPHABET[(block >>> 18) & 63];
		encoded += BASE64URL_ALPHABET[(block >>> 12) & 63];
		if (second !== undefined) encoded += BASE64URL_ALPHABET[(block >>> 6) & 63];
		if (third !== undefined) encoded += BASE64URL_ALPHABET[block & 63];
	}
	return encoded;
}

function componentIsBounded(value: unknown): value is string {
	if (typeof value !== "string") return false;
	if (value.length > MAX_IDENTITY_COMPONENT_BYTES) return false;
	return utf8ToBytes(JSON.stringify(value)).length <= MAX_IDENTITY_COMPONENT_BYTES;
}

function hasLoneSurrogate(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
			index++;
		} else if (code >= 0xdc00 && code <= 0xdfff) {
			return true;
		}
	}
	return false;
}

function hasAsciiControl(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code <= 0x1f || code === 0x7f) return true;
	}
	return false;
}

function createCanonicalId(
	prefix: typeof FEED_ID_PREFIX | typeof EPISODE_ID_PREFIX,
	domain: IdentityDomain,
	parts: readonly string[],
): string | undefined {
	if (!parts.every(componentIsBounded)) return undefined;

	// Arrays give a canonical, length-delimited representation. JSON.stringify
	// also escapes control characters and lone surrogates before UTF-8 encoding.
	const preimage = utf8ToBytes(
		JSON.stringify([IDENTITY_NAMESPACE, IDENTITY_VERSION, domain, ...parts]),
	);
	if (preimage.length > MAX_IDENTITY_PREIMAGE_BYTES) return undefined;

	return `${prefix}${encodeBase64Url(sha256(preimage))}`;
}

/**
 * Apply WHATWG URL canonicalization and remove only the fragment. Query order,
 * credentials, and every query parameter remain part of the strong identity.
 */
export function normalizeStrongIdentityUrl(value: unknown): string | undefined {
	// WHATWG URL parsing replaces lone surrogates and discards raw ASCII control
	// characters. Reject them first so distinct hostile inputs cannot normalize to
	// the same otherwise-strong locator.
	if (
		typeof value !== "string" ||
		!componentIsBounded(value) ||
		hasLoneSurrogate(value) ||
		hasAsciiControl(value)
	) {
		return undefined;
	}
	try {
		const url = new URL(value);
		url.hash = "";
		const normalized = url.href;
		return componentIsBounded(normalized) ? normalized : undefined;
	} catch {
		return undefined;
	}
}

export function isCanonicalFeedId(value: unknown): value is CanonicalFeedId {
	return (
		typeof value === "string" &&
		value.length === CANONICAL_ID_LENGTH &&
		value.startsWith(FEED_ID_PREFIX) &&
		CANONICAL_ID_BODY.test(value.slice(FEED_ID_PREFIX.length))
	);
}

export function isCanonicalEpisodeId(value: unknown): value is CanonicalEpisodeId {
	return (
		typeof value === "string" &&
		value.length === CANONICAL_ID_LENGTH &&
		value.startsWith(EPISODE_ID_PREFIX) &&
		CANONICAL_ID_BODY.test(value.slice(EPISODE_ID_PREFIX.length))
	);
}

/** Derive the immutable first-observation feed ID from its subscription URL. */
export function createFeedId(subscriptionUrl: unknown): CanonicalFeedId | undefined {
	const normalizedUrl = normalizeStrongIdentityUrl(subscriptionUrl);
	if (!normalizedUrl) return undefined;
	return createCanonicalId(FEED_ID_PREFIX, "feed-url", [normalizedUrl]) as
		| CanonicalFeedId
		| undefined;
}

/**
 * Deterministic migration helper for local files. The caller must provide an
 * Obsidian-normalized vault path. This function deliberately does not trim or
 * reduce the path to a basename.
 */
export function createLocalEpisodeId(
	feedId: unknown,
	normalizedVaultPath: unknown,
): CanonicalEpisodeId | undefined {
	if (
		!isCanonicalFeedId(feedId) ||
		typeof normalizedVaultPath !== "string" ||
		!normalizedVaultPath ||
		normalizedVaultPath.includes("\u0000")
	) {
		return undefined;
	}
	return createCanonicalId(EPISODE_ID_PREFIX, "local-vault-path", [
		feedId,
		normalizedVaultPath,
	]) as CanonicalEpisodeId | undefined;
}

function normalizeOpaqueGuid(value: unknown): string | undefined {
	const guid = typeof value === "string" ? value : undefined;
	return guid && componentIsBounded(guid) ? guid : undefined;
}

function createEpisodeCandidate(
	feedId: CanonicalFeedId,
	kind: Exclude<EpisodeIdentityCandidateKind, "source">,
	value: string,
): EpisodeIdentityCandidate | undefined {
	const domain: IdentityDomain =
		kind === "guid" ? "episode-guid" : kind === "media" ? "episode-media" : "episode-item-link";
	const id = createCanonicalId(EPISODE_ID_PREFIX, domain, [feedId, value]);
	return id ? { kind, id: id as CanonicalEpisodeId } : undefined;
}

interface NormalizedEpisodeIdentitySource {
	feedId?: CanonicalFeedId;
	guid?: string;
	media?: string;
	itemLink?: string;
	publishedAt: string;
	title: string;
	rawMedia: string;
	rawItemLink: string;
}

function createSourceTupleCandidate(
	feedId: CanonicalFeedId,
	source: NormalizedEpisodeIdentitySource,
): EpisodeIdentityCandidate | undefined {
	const id = createCanonicalId(EPISODE_ID_PREFIX, "episode-source-tuple", [
		feedId,
		source.guid ?? "",
		source.media ?? source.rawMedia,
		source.itemLink ?? source.rawItemLink,
		source.publishedAt,
		source.title,
	]);
	return id ? { kind: "source", id: id as CanonicalEpisodeId } : undefined;
}

function normalizedIdentitySource(source: unknown): NormalizedEpisodeIdentitySource | undefined {
	if (!source || typeof source !== "object" || Array.isArray(source)) return undefined;

	try {
		const candidate = source as Record<string, unknown>;
		const feedId = candidate.feedId;
		const enclosureUrl = candidate.enclosureUrl;
		const title = candidate.title;
		const guid = candidate.guid;
		const itemLink = candidate.itemLink;
		const publishedAt = candidate.publishedAt;
		if (
			typeof feedId !== "string" ||
			typeof enclosureUrl !== "string" ||
			typeof title !== "string" ||
			(guid !== undefined && typeof guid !== "string") ||
			(itemLink !== undefined && typeof itemLink !== "string") ||
			(publishedAt !== undefined && typeof publishedAt !== "string")
		) {
			return undefined;
		}

		return {
			feedId: isCanonicalFeedId(feedId) ? feedId : undefined,
			guid: normalizeOpaqueGuid(guid),
			media: normalizeStrongIdentityUrl(enclosureUrl),
			itemLink: itemLink ? normalizeStrongIdentityUrl(itemLink) : undefined,
			publishedAt: publishedAt ?? "",
			title,
			rawMedia: enclosureUrl,
			rawItemLink: itemLink ?? "",
		};
	} catch {
		return undefined;
	}
}

export function getEpisodeIdentityCandidates(source: unknown): readonly EpisodeIdentityCandidate[] {
	const normalized = normalizedIdentitySource(source);
	if (!normalized?.feedId) return [];

	const candidates: EpisodeIdentityCandidate[] = [];
	if (normalized.guid) {
		const candidate = createEpisodeCandidate(normalized.feedId, "guid", normalized.guid);
		if (candidate) candidates.push(candidate);
	}
	if (normalized.media) {
		const candidate = createEpisodeCandidate(normalized.feedId, "media", normalized.media);
		if (candidate) candidates.push(candidate);
	}
	if (normalized.itemLink) {
		const candidate = createEpisodeCandidate(
			normalized.feedId,
			"itemLink",
			normalized.itemLink,
		);
		if (candidate) candidates.push(candidate);
	}

	const fallback = createSourceTupleCandidate(normalized.feedId, normalized);
	if (fallback) candidates.push(fallback);

	return candidates;
}

/**
 * Choose identities only after examining the complete feed. GUID, enclosure,
 * and item-link candidates shared by distinct source tuples are excluded. An
 * exact repeated tuple is treated as the same logical source and may share an
 * ID; a distinct tuple falls through to its own source-derived ID.
 */
export function assignEpisodeIdentities(sources: unknown): readonly AssignedEpisodeIdentity[] {
	if (!Array.isArray(sources)) return [];
	const candidatesBySource = Array.from(sources, getEpisodeIdentityCandidates);
	const sourceTupleIds = candidatesBySource.map(
		(candidates) => candidates.find((candidate) => candidate.kind === "source")?.id,
	);
	const distinctSourcesByCandidate = new Map<string, Set<string>>();

	for (let index = 0; index < candidatesBySource.length; index++) {
		// Oversized/malformed tuples fail closed: they never make a candidate look
		// unique merely because two unidentifiable records happen to share an alias.
		const sourceKey = sourceTupleIds[index] ?? `unidentified:${index}`;
		for (const candidate of candidatesBySource[index]) {
			const sourceKeys = distinctSourcesByCandidate.get(candidate.id) ?? new Set<string>();
			sourceKeys.add(sourceKey);
			distinctSourcesByCandidate.set(candidate.id, sourceKeys);
		}
	}

	return candidatesBySource.map((candidates) => {
		const uniqueCandidates = candidates.filter(
			(candidate) => distinctSourcesByCandidate.get(candidate.id)?.size === 1,
		);
		return {
			episodeId: uniqueCandidates[0]?.id,
			aliases: uniqueCandidates
				.filter((candidate) => candidate.kind !== "source")
				.map((candidate) => candidate.id),
		};
	});
}

function validateExplicitPriorAliases(
	value: unknown,
	previousId: CanonicalEpisodeId,
): Set<CanonicalEpisodeId> {
	try {
		if (!Array.isArray(value) || value.length > MAX_EPISODE_IDENTITY_ALIASES) {
			return new Set<CanonicalEpisodeId>();
		}
		const validated: CanonicalEpisodeId[] = [];
		for (let index = 0; index < value.length; index++) {
			const alias = value[index];
			if (!isCanonicalEpisodeId(alias)) return new Set<CanonicalEpisodeId>();
			validated.push(alias);
		}
		const aliases = new Set(validated);
		if (aliases.size !== validated.length || !aliases.has(previousId)) {
			return new Set<CanonicalEpisodeId>();
		}
		return aliases;
	} catch {
		return new Set<CanonicalEpisodeId>();
	}
}

/**
 * Reconcile two complete feed observations without display-title fallback.
 * Prior IDs survive only across a one-to-one edge between independently
 * ambiguity-vetted candidate sets. Splits, merges, malformed prior IDs, and
 * duplicate prior IDs all fail closed to the current source-derived identity.
 */
export function reconcileEpisodeIdentities(
	previous: unknown,
	currentSources: unknown,
): readonly AssignedEpisodeIdentity[] {
	const current = assignEpisodeIdentities(currentSources);
	if (!Array.isArray(previous) || !Array.isArray(currentSources)) return current;

	const previousRecords = previous.map((entry) => {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
		try {
			const record = entry as Record<string, unknown>;
			return {
				episodeId: record.episodeId,
				source: record.source,
				aliases: Object.prototype.hasOwnProperty.call(record, "aliases")
					? record.aliases
					: undefined,
			};
		} catch {
			return undefined;
		}
	});
	const previousSources = previousRecords.map((record) => record?.source);
	const previousAssigned = assignEpisodeIdentities(previousSources);
	const previousIds = previousRecords.map((record) =>
		isCanonicalEpisodeId(record?.episodeId) ? record.episodeId : undefined,
	);
	const priorIdCounts = new Map<string, number>();
	for (const id of previousIds) {
		if (id) priorIdCounts.set(id, (priorIdCounts.get(id) ?? 0) + 1);
	}
	const trustedPreviousAliases = previousRecords.map((record, index) => {
		const previousId = previousIds[index];
		if (!record || !previousId) return new Set<CanonicalEpisodeId>();

		if (record.aliases !== undefined) {
			return validateExplicitPriorAliases(record.aliases, previousId);
		}

		const recomputed = previousAssigned[index];
		if (recomputed?.episodeId !== previousId && !recomputed?.aliases.includes(previousId)) {
			return new Set<CanonicalEpisodeId>();
		}
		return new Set(recomputed.aliases);
	});

	const currentEdges = current.map(() => new Set<number>());
	const previousEdges = previousAssigned.map(() => new Set<number>());
	for (let previousIndex = 0; previousIndex < previousAssigned.length; previousIndex++) {
		const previousAliases = trustedPreviousAliases[previousIndex];
		if (previousAliases.size === 0) continue;
		for (let currentIndex = 0; currentIndex < current.length; currentIndex++) {
			if (current[currentIndex]?.aliases.some((alias) => previousAliases.has(alias))) {
				previousEdges[previousIndex]?.add(currentIndex);
				currentEdges[currentIndex]?.add(previousIndex);
			}
		}
	}

	return current.map((identity, currentIndex) => {
		const priorIndexes = currentEdges[currentIndex];
		if (priorIndexes?.size !== 1) return identity;
		const [previousIndex] = priorIndexes;
		if (previousEdges[previousIndex]?.size !== 1) return identity;
		const previousId = previousIds[previousIndex];
		if (!previousId || priorIdCounts.get(previousId) !== 1) return identity;
		const aliases = new Set<CanonicalEpisodeId>();
		aliases.add(previousId);
		for (const alias of identity.aliases) aliases.add(alias);
		for (const alias of trustedPreviousAliases[previousIndex]) aliases.add(alias);

		return {
			episodeId: previousId,
			aliases: [...aliases].slice(0, MAX_EPISODE_IDENTITY_ALIASES),
		};
	});
}
