import { getFeedHandleHex } from "./resourceHandles";

const FEED_CAPABILITY_REFERENCE_PREFIX = "pnfc-";
const FEED_CAPABILITY_TOKEN_LENGTH = 50;
const FEED_CAPABILITY_REFERENCE_PATTERN = /^pnfc-[0-9a-z]{50}(?:-(?:[2-9]|[1-9]\d|[1-9]\d{2}))?$/;
const PHYSICAL_PAGE_INDEX_PATTERN = /^[0-9a-z]{3}$/;
export const MAX_FEED_CAPABILITY_REFERENCE_ATTEMPTS = 999;
export const MAX_SECRET_STORAGE_ID_CHARACTERS = 64;

declare const feedCapabilityReferenceBrand: unique symbol;

export type FeedCapabilityReference = string & {
	readonly [feedCapabilityReferenceBrand]: true;
};

export function getFeedCapabilityReferenceBase(feedId: unknown): string | undefined {
	const feedHex = getFeedHandleHex(feedId);
	if (!feedHex) return undefined;
	const token = BigInt(`0x${feedHex}`).toString(36).padStart(FEED_CAPABILITY_TOKEN_LENGTH, "0");
	return token.length === FEED_CAPABILITY_TOKEN_LENGTH
		? `${FEED_CAPABILITY_REFERENCE_PREFIX}${token}`
		: undefined;
}

export function feedCapabilityReferenceForAttempt(
	feedId: unknown,
	attempt: number,
): FeedCapabilityReference | null {
	const base = getFeedCapabilityReferenceBase(feedId);
	if (
		!base ||
		!Number.isSafeInteger(attempt) ||
		attempt < 1 ||
		attempt > MAX_FEED_CAPABILITY_REFERENCE_ATTEMPTS
	) {
		return null;
	}
	return (attempt === 1 ? base : `${base}-${attempt}`) as FeedCapabilityReference;
}

export function isFeedCapabilityReferenceFor(
	feedId: unknown,
	value: unknown,
): value is FeedCapabilityReference {
	const base = getFeedCapabilityReferenceBase(feedId);
	if (!base || typeof value !== "string") return false;
	if (value === base) return true;
	if (!value.startsWith(`${base}-`)) return false;
	const suffix = value.slice(base.length + 1);
	if (!/^[1-9]\d*$/.test(suffix)) return false;
	const number = Number(suffix);
	return (
		Number.isSafeInteger(number) &&
		number >= 2 &&
		number <= MAX_FEED_CAPABILITY_REFERENCE_ATTEMPTS
	);
}

export function getFeedCapabilityManifestStorageId(
	reference: FeedCapabilityReference | string,
	slot: "a" | "b",
): string | null {
	if (!FEED_CAPABILITY_REFERENCE_PATTERN.test(reference)) return null;
	const id = `${reference}-${slot}m`;
	return id.length <= MAX_SECRET_STORAGE_ID_CHARACTERS ? id : null;
}

export function getFeedCapabilityPageStorageId(
	reference: FeedCapabilityReference | string,
	slot: "a" | "b",
	index: string,
): string | null {
	if (
		!FEED_CAPABILITY_REFERENCE_PATTERN.test(reference) ||
		!PHYSICAL_PAGE_INDEX_PATTERN.test(index)
	) {
		return null;
	}
	const id = `${reference}-${slot}${index}`;
	return id.length <= MAX_SECRET_STORAGE_ID_CHARACTERS ? id : null;
}
