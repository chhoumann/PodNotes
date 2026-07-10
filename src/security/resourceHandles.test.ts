import { describe, expect, it } from "vitest";
import {
	HANDLE_ALLOCATION_ATTEMPTS,
	HandleAllocationError,
	allocateEpisodeHandle,
	allocateFeedHandle,
	isEpisodeHandle,
	isFeedHandle,
} from "./resourceHandles";

describe("opaque remote resource handles", () => {
	it("allocates kind-specific handles from 256 bits of injected entropy", () => {
		let feedBytes = 0;
		let episodeBytes = 0;
		const feed = allocateFeedHandle({
			fillRandom: (bytes) => {
				feedBytes = bytes.byteLength;
				bytes.fill(0x2a);
			},
		});
		const episode = allocateEpisodeHandle({
			fillRandom: (bytes) => {
				episodeBytes = bytes.byteLength;
				bytes.fill(0x7f);
			},
		});

		expect(feed).toBe(`podnotes-feed-${"2a".repeat(32)}`);
		expect(episode).toBe(`podnotes-episode-${"7f".repeat(32)}`);
		expect(feedBytes).toBe(32);
		expect(episodeBytes).toBe(32);
		expect(isFeedHandle(feed)).toBe(true);
		expect(isEpisodeHandle(episode)).toBe(true);
		expect(isEpisodeHandle(feed)).toBe(false);
		expect(isFeedHandle(episode)).toBe(false);
	});

	it.each([
		"",
		"podnotes-feed-",
		`podnotes-feed-${"a".repeat(63)}`,
		`podnotes-feed-${"a".repeat(65)}`,
		`podnotes-feed-${"A".repeat(64)}`,
		`podnotes-feed-${"g".repeat(64)}`,
		`podnotes-feed-${"a".repeat(64)}-2`,
	])("rejects an invalid feed handle: %s", (candidate) => {
		expect(isFeedHandle(candidate)).toBe(false);
	});

	it("retries a collision and returns the next available handle", () => {
		const unavailable = new Set([`podnotes-feed-${"11".repeat(32)}`]);
		let attempts = 0;
		const handle = allocateFeedHandle({
			unavailable,
			fillRandom: (bytes) => {
				bytes.fill(attempts++ === 0 ? 0x11 : 0x22);
			},
		});

		expect(handle).toBe(`podnotes-feed-${"22".repeat(32)}`);
		expect(attempts).toBe(2);
	});

	it("fails closed after the bounded collision schedule", () => {
		const candidate = `podnotes-episode-${"33".repeat(32)}`;
		let attempts = 0;

		expect(() =>
			allocateEpisodeHandle({
				unavailable: new Set([candidate]),
				fillRandom: (bytes) => {
					attempts += 1;
					bytes.fill(0x33);
				},
			}),
		).toThrow(HandleAllocationError);
		expect(attempts).toBe(HANDLE_ALLOCATION_ATTEMPTS);
	});

	it("does not expose an entropy provider failure as a partially allocated handle", () => {
		expect(() =>
			allocateFeedHandle({
				fillRandom: () => {
					throw new Error("entropy source details");
				},
			}),
		).toThrow(HandleAllocationError);
	});
});
