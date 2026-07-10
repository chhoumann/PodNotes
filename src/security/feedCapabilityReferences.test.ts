import { describe, expect, it } from "vitest";
import type { FeedHandle } from "./resourceHandles";
import {
	feedCapabilityReferenceForAttempt,
	getFeedCapabilityReferenceBase,
	getFeedCapabilityManifestStorageId,
	getFeedCapabilityPageStorageId,
	isFeedCapabilityReferenceFor,
} from "./feedCapabilityReferences";

const feedId = `podnotes-feed-${"11".repeat(32)}` as FeedHandle;
const otherFeedId = `podnotes-feed-${"22".repeat(32)}` as FeedHandle;
const base = `pnfc-${BigInt(`0x${"11".repeat(32)}`)
	.toString(36)
	.padStart(50, "0")}`;

describe("feed capability references", () => {
	it("derives the feed-bound base without using a target", () => {
		expect(getFeedCapabilityReferenceBase(feedId)).toBe(base);
		expect(
			getFeedCapabilityReferenceBase(`podnotes-feed-${"0".repeat(64)}` as FeedHandle),
		).toBe(`pnfc-${"0".repeat(50)}`);
		expect(
			getFeedCapabilityReferenceBase(`podnotes-feed-${"0".repeat(63)}1` as FeedHandle),
		).toBe(`pnfc-${"0".repeat(49)}1`);
		expect(getFeedCapabilityReferenceBase("https://secret.example/feed.xml")).toBeUndefined();
	});

	it("allocates the bounded base and collision suffix grammar", () => {
		expect(feedCapabilityReferenceForAttempt(feedId, 1)).toBe(base);
		expect(feedCapabilityReferenceForAttempt(feedId, 2)).toBe(`${base}-2`);
		expect(feedCapabilityReferenceForAttempt(feedId, 999)).toBe(`${base}-999`);
		expect(feedCapabilityReferenceForAttempt(feedId, 999)).toHaveLength(59);
		expect(feedCapabilityReferenceForAttempt(feedId, 0)).toBeNull();
		expect(feedCapabilityReferenceForAttempt(feedId, 1000)).toBeNull();
	});

	it.each([
		`${base}-1`,
		`${base}-02`,
		`${base}-1000`,
		`${base}-2-extra`,
		`${base.toUpperCase()}`,
	])("rejects a malformed reference: %s", (candidate) => {
		expect(isFeedCapabilityReferenceFor(feedId, candidate)).toBe(false);
	});

	it("rejects a valid reference when it is bound to another feed", () => {
		expect(isFeedCapabilityReferenceFor(feedId, base)).toBe(true);
		expect(isFeedCapabilityReferenceFor(feedId, `${base}-2`)).toBe(true);
		expect(isFeedCapabilityReferenceFor(otherFeedId, base)).toBe(false);
	});

	it("builds only grammar-valid physical IDs within the 64-character limit", () => {
		const maximumReference = feedCapabilityReferenceForAttempt(feedId, 999)!;

		expect(getFeedCapabilityManifestStorageId(maximumReference, "b")).toHaveLength(62);
		expect(getFeedCapabilityPageStorageId(maximumReference, "b", "zzz")).toHaveLength(64);
		expect(getFeedCapabilityPageStorageId(maximumReference, "b", "zzzz")).toBeNull();
		expect(getFeedCapabilityManifestStorageId(`${maximumReference}9`, "a")).toBeNull();
		expect(getFeedCapabilityPageStorageId(`${maximumReference}9`, "a", "000")).toBeNull();
	});
});
