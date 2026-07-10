import type { SecretStorage } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import type {
	EpisodeResourcesEnvelope,
	FeedCapabilityEnvelope,
} from "src/security/targetEnvelopes";
import type { EpisodeHandle, FeedHandle } from "src/security/resourceHandles";
import {
	MAX_PHYSICAL_PAGE_INDEX,
	encodeFeedCapabilityPageIndex,
	serializePhysicalItem,
} from "src/security/feedCapabilityStorage";
import {
	feedCapabilityReferenceForAttempt,
	getFeedCapabilityReferenceBase,
} from "src/security/feedCapabilityReferences";
import {
	FeedCapabilityRepository,
	MAX_SECRET_STORAGE_ID_CHARACTERS,
	MAX_SECRET_STORAGE_ITEM_BYTES,
	isFeedCapabilityReferenceFor,
} from "./FeedCapabilityRepository";

const feedId = `podnotes-feed-${"11".repeat(32)}` as FeedHandle;
const otherFeedId = `podnotes-feed-${"22".repeat(32)}` as FeedHandle;
const episodeId = `podnotes-episode-${"33".repeat(32)}` as EpisodeHandle;
const otherEpisodeId = `podnotes-episode-${"44".repeat(32)}` as EpisodeHandle;
const referenceBase = getFeedCapabilityReferenceBase(feedId)!;

const bundle: FeedCapabilityEnvelope = {
	schemaVersion: 1,
	kind: "feed-capability-bundle",
	feedId,
	subscriptionUrl: "https://listener:secret@example.com/feed.xml?token=value",
	guid: "podcast:channel:opaque-guid",
	episodeResources: {
		[episodeId]: {
			schemaVersion: 1,
			kind: "episode-resources",
			feedId,
			episodeId,
			streamUrl: "https://media.example.com/audio.mp3?signature=value",
		},
	},
};

type SetAction = "throw-before" | "throw-after" | undefined;

function memoryStorage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	let getUnavailable = false;
	let setInterceptor: ((id: string, value: string) => SetAction) | undefined;
	const storage = {
		getSecret: vi.fn((id: string) => {
			if (getUnavailable) throw new Error("SecretStorage unavailable");
			return values.get(id) ?? null;
		}),
		setSecret: vi.fn((id: string, value: string) => {
			const action = setInterceptor?.(id, value);
			if (action === "throw-before") throw new Error("injected write failure");
			values.set(id, value);
			if (action === "throw-after") throw new Error("injected write failure");
		}),
		listSecrets: vi.fn(() => [...values.keys()]),
	} as unknown as SecretStorage;

	return {
		values,
		storage,
		setGetUnavailable(value: boolean) {
			getUnavailable = value;
		},
		setSetInterceptor(value?: (id: string, serialized: string) => SetAction) {
			setInterceptor = value;
		},
	};
}

function parseItem(values: Map<string, string>, id: string): Record<string, unknown> {
	return JSON.parse(values.get(id)!) as Record<string, unknown>;
}

function manifestAt(values: Map<string, string>, reference: string, slot: "a" | "b") {
	const serialized = values.get(`${reference}-${slot}m`);
	return serialized ? (JSON.parse(serialized) as any) : null;
}

function highestManifest(values: Map<string, string>, reference: string) {
	return [manifestAt(values, reference, "a"), manifestAt(values, reference, "b")]
		.filter(Boolean)
		.sort((left, right) => right.generation - left.generation)[0];
}

function pageKey(reference: string, descriptor: { index: string; slot: "a" | "b" }) {
	return `${reference}-${descriptor.slot}${descriptor.index}`;
}

function physicalKind(value: string): string | undefined {
	try {
		const parsed = JSON.parse(value) as { kind?: unknown };
		return typeof parsed.kind === "string" ? parsed.kind : undefined;
	} catch {
		return undefined;
	}
}

function updatedBundle(): FeedCapabilityEnvelope {
	return { ...bundle, siteUrl: "https://example.com/updated" };
}

function storeAt(
	repository: FeedCapabilityRepository,
	value: unknown,
	reference: unknown = referenceBase,
	expectedFeedId: FeedHandle | string = feedId,
): Promise<string> {
	return repository.storeFeedCapabilitiesAt(expectedFeedId, reference, value);
}

function twoEpisodeBundle(): FeedCapabilityEnvelope {
	return {
		...bundle,
		episodeResources: {
			...bundle.episodeResources,
			[otherEpisodeId]: {
				schemaVersion: 1,
				kind: "episode-resources",
				feedId,
				episodeId: otherEpisodeId,
				guid: "durable-nonplayable-episode",
			},
		},
	};
}

function largeSplitBundle(): FeedCapabilityEnvelope {
	const episodeResources: Partial<Record<EpisodeHandle, EpisodeResourcesEnvelope>> = {};
	for (let index = 0; index < 16; index += 1) {
		const hex = `a${index.toString(16)}${index.toString(16).padStart(62, "0")}`;
		const id = `podnotes-episode-${hex}` as EpisodeHandle;
		episodeResources[id] = {
			schemaVersion: 1,
			kind: "episode-resources",
			feedId,
			episodeId: id,
			streamUrl: `https://media.example.com/${"x".repeat(14_000)}${index}`,
		};
	}
	return { ...bundle, episodeResources };
}

describe("FeedCapabilityRepository", () => {
	it("rejects values that JSON cannot serialize into a physical item", () => {
		expect(serializePhysicalItem(undefined)).toBeNull();
		expect(serializePhysicalItem(Symbol("unsupported"))).toBeNull();
	});

	it("stores and reads a small feed bundle through one feed-bound namespace", async () => {
		const { storage, values } = memoryStorage();
		const repository = new FeedCapabilityRepository(storage);

		const reference = await storeAt(repository, bundle);

		expect(isFeedCapabilityReferenceFor(feedId, reference)).toBe(true);
		expect(parseItem(values, reference).kind).toBe("feed-capability-namespace");
		expect(highestManifest(values, reference).generation).toBe(1);
		expect(await repository.getFeedCapabilities(feedId, reference)).toEqual(bundle);
		expect(await repository.getEpisodeResources(feedId, episodeId, reference)).toEqual(
			bundle.episodeResources[episodeId],
		);
		expect(await repository.feedCapabilitiesStatus(feedId, reference)).toBe("available");
		expect(await repository.episodeResourcesStatus(feedId, episodeId, reference)).toBe(
			"available",
		);
	});

	it("provisions the same persisted suffix across independent SecretStorage instances", async () => {
		const reference = feedCapabilityReferenceForAttempt(feedId, 2)!;
		const first = memoryStorage();
		const second = memoryStorage();
		const firstRepository = new FeedCapabilityRepository(first.storage);
		const secondRepository = new FeedCapabilityRepository(second.storage);

		expect(await storeAt(firstRepository, bundle, reference)).toBe(reference);
		expect(await storeAt(secondRepository, bundle, reference)).toBe(reference);
		expect(first.values.has(referenceBase)).toBe(false);
		expect(second.values.has(referenceBase)).toBe(false);
		expect(await firstRepository.getFeedCapabilities(feedId, reference)).toEqual(bundle);
		expect(await secondRepository.getFeedCapabilities(feedId, reference)).toEqual(bundle);
	});

	it("rejects a mismatched feed or reference before SecretStorage access", async () => {
		const { storage } = memoryStorage();
		const repository = new FeedCapabilityRepository(storage);
		const otherReference = feedCapabilityReferenceForAttempt(otherFeedId, 1)!;

		await expect(
			repository.storeFeedCapabilitiesAt(otherFeedId, otherReference, bundle),
		).rejects.toThrow("Invalid feed capability envelope");
		await expect(
			repository.storeFeedCapabilitiesAt(feedId, otherReference, bundle),
		).rejects.toThrow("Invalid feed capability binding");
		expect(storage.getSecret).not.toHaveBeenCalled();
		expect(storage.setSecret).not.toHaveBeenCalled();
	});

	it("retries a partially reserved exact namespace without reallocating", async () => {
		const { storage, values } = memoryStorage();
		const failing = new FeedCapabilityRepository(storage, {
			validatePhysicalManifest: () => null,
		});

		await expect(storeAt(failing, bundle)).rejects.toThrow(
			"SecretStorage could not commit feed capabilities",
		);
		expect(parseItem(values, referenceBase).kind).toBe("feed-capability-namespace");

		const retry = new FeedCapabilityRepository(storage);
		expect(await storeAt(retry, bundle)).toBe(referenceBase);
		expect(await retry.getFeedCapabilities(feedId, referenceBase)).toEqual(bundle);
	});

	it("accepts an ambiguous exact namespace write when readback proves success", async () => {
		const harness = memoryStorage();
		const repository = new FeedCapabilityRepository(harness.storage);
		let injected = false;
		harness.setSetInterceptor((id, value) => {
			if (
				!injected &&
				id === referenceBase &&
				physicalKind(value) === "feed-capability-namespace"
			) {
				injected = true;
				return "throw-after";
			}
			return undefined;
		});

		expect(await storeAt(repository, bundle)).toBe(referenceBase);
		expect(await repository.getFeedCapabilities(feedId, referenceBase)).toEqual(bundle);
	});

	it("performs an exact-content no-op without rewriting any item", async () => {
		const { storage } = memoryStorage();
		const repository = new FeedCapabilityRepository(storage);
		const reference = await storeAt(repository, bundle);
		vi.mocked(storage.setSecret).mockClear();

		expect(await storeAt(repository, bundle)).toBe(reference);
		expect(storage.setSecret).not.toHaveBeenCalled();
	});

	it("rejects an impossible physical plan before writing any page or manifest", async () => {
		const { storage, values } = memoryStorage();
		const repository = new FeedCapabilityRepository(storage, {
			validatePhysicalManifest: () => null,
		});

		await expect(storeAt(repository, bundle)).rejects.toThrow(
			"SecretStorage could not commit feed capabilities",
		);

		expect(storage.setSecret).toHaveBeenCalledTimes(1);
		expect([...values.values()].map(physicalKind)).toEqual(["feed-capability-namespace"]);
		expect([...values.keys()].some((id) => /-[ab](?:m|[0-9a-z]{3})$/.test(id))).toBe(false);
	});

	it("serializes concurrent commits for the same feed", async () => {
		const { storage, values } = memoryStorage();
		const firstRepository = new FeedCapabilityRepository(storage);
		const secondRepository = new FeedCapabilityRepository(storage);
		const reference = await storeAt(firstRepository, bundle);
		const second = { ...bundle, siteUrl: "https://example.com/concurrent-second" };
		const third = { ...bundle, siteUrl: "https://example.com/concurrent-third" };

		const references = await Promise.all([
			storeAt(firstRepository, second),
			storeAt(secondRepository, third),
		]);

		expect(references).toEqual([reference, reference]);
		expect(highestManifest(values, reference).generation).toBe(3);
		expect(await firstRepository.getFeedCapabilities(feedId, reference)).toEqual(third);
	});

	it("reads a synchronous multi-page snapshot while two later generations commit", async () => {
		const { storage } = memoryStorage();
		const repository = new FeedCapabilityRepository(storage);
		const initial = largeSplitBundle();
		const reference = await storeAt(repository, initial);

		const read = repository.readFeedCapabilities(feedId, reference);
		const commits = Promise.all([
			storeAt(repository, { ...initial, siteUrl: "https://example.com/second" }),
			storeAt(repository, { ...initial, siteUrl: "https://example.com/third" }),
		]);

		expect(await read).toEqual({ status: "available", value: initial });
		await commits;
		expect(await repository.getFeedCapabilities(feedId, reference)).toEqual({
			...initial,
			siteUrl: "https://example.com/third",
		});
	});

	it("alternates slots while retaining the previous complete generation", async () => {
		const { storage, values } = memoryStorage();
		const repository = new FeedCapabilityRepository(storage);
		const reference = await storeAt(repository, bundle);
		const first = highestManifest(values, reference);

		await storeAt(repository, updatedBundle());
		const second = highestManifest(values, reference);

		expect(first.generation).toBe(1);
		expect(second.generation).toBe(2);
		expect(first.pages[0].slot).toBe("a");
		expect(second.pages[0].slot).toBe("b");
		expect(values.get(pageKey(reference, first.pages[0]))).not.toBe("");
		expect(values.get(pageKey(reference, second.pages[0]))).not.toBe("");
		expect(await repository.getFeedCapabilities(feedId, reference)).toEqual(updatedBundle());
	});

	it("recursively splits an oversized first-nibble bucket", async () => {
		const { storage, values } = memoryStorage();
		const repository = new FeedCapabilityRepository(storage);
		const value = largeSplitBundle();

		const reference = await storeAt(repository, value);
		const manifest = highestManifest(values, reference);

		expect(manifest.pages).toHaveLength(16);
		expect(manifest.pages.every((page: any) => /^a[0-9a-f]$/.test(page.bucket))).toBe(true);
		expect(manifest.pages.map((page: any) => page.index)).toEqual(
			Array.from({ length: 16 }, (_, index) => index.toString(36).padStart(3, "0")),
		);
		expect(await repository.getFeedCapabilities(feedId, reference)).toEqual(value);
	});

	it.each(["page", "manifest"] as const)(
		"preserves the prior generation after an injected %s write failure",
		async (kind) => {
			const harness = memoryStorage();
			const repository = new FeedCapabilityRepository(harness.storage);
			const reference = await storeAt(repository, bundle);
			let injected = false;
			harness.setSetInterceptor((id, value) => {
				if (
					!injected &&
					id.length <= MAX_SECRET_STORAGE_ID_CHARACTERS &&
					physicalKind(value) === `feed-capability-${kind}`
				) {
					injected = true;
					return "throw-before";
				}
				return undefined;
			});

			await expect(storeAt(repository, updatedBundle())).rejects.toThrow(
				"SecretStorage could not commit feed capabilities",
			);
			harness.setSetInterceptor();

			expect(await repository.getFeedCapabilities(feedId, reference)).toEqual(bundle);
			expect(highestManifest(harness.values, reference).generation).toBe(1);
		},
	);

	it.each(["page", "manifest"] as const)(
		"accepts an ambiguous %s throw when exact readback proves the write succeeded",
		async (kind) => {
			const harness = memoryStorage();
			const repository = new FeedCapabilityRepository(harness.storage);
			const reference = await storeAt(repository, bundle);
			let injected = false;
			harness.setSetInterceptor((id, value) => {
				if (
					!injected &&
					id.length <= MAX_SECRET_STORAGE_ID_CHARACTERS &&
					physicalKind(value) === `feed-capability-${kind}`
				) {
					injected = true;
					return "throw-after";
				}
				return undefined;
			});

			expect(await storeAt(repository, updatedBundle())).toBe(reference);
			harness.setSetInterceptor();
			expect(await repository.getFeedCapabilities(feedId, reference)).toEqual(
				updatedBundle(),
			);
			expect(highestManifest(harness.values, reference).generation).toBe(2);
		},
	);

	it.each(["page", "manifest"] as const)(
		"keeps generation two readable when a generation-three %s write fails",
		async (kind) => {
			const harness = memoryStorage();
			const repository = new FeedCapabilityRepository(harness.storage);
			const firstBundle = twoEpisodeBundle();
			await storeAt(repository, firstBundle);
			const secondBundle = {
				...firstBundle,
				siteUrl: "https://example.com/second",
			};
			const reference = await storeAt(repository, secondBundle);
			let injected = false;
			harness.setSetInterceptor((id, value) => {
				if (
					!injected &&
					id.length <= MAX_SECRET_STORAGE_ID_CHARACTERS &&
					physicalKind(value) === `feed-capability-${kind}`
				) {
					injected = true;
					return "throw-before";
				}
				return undefined;
			});

			await expect(
				storeAt(repository, {
					...bundle,
					siteUrl: "https://example.com/third",
				}),
			).rejects.toThrow("SecretStorage could not commit feed capabilities");
			harness.setSetInterceptor();
			expect(await repository.getFeedCapabilities(feedId, reference)).toEqual(secondBundle);
			expect(highestManifest(harness.values, reference).generation).toBe(2);
		},
	);

	it("rejects page digest corruption", async () => {
		const { storage, values } = memoryStorage();
		const repository = new FeedCapabilityRepository(storage);
		const reference = await storeAt(repository, bundle);
		const manifest = highestManifest(values, reference);
		const key = pageKey(reference, manifest.pages[0]);
		const page = parseItem(values, key) as any;
		page.episodeResources[episodeId].streamUrl = "https://tampered.example/audio.mp3";
		values.set(key, JSON.stringify(page));

		expect(await repository.getFeedCapabilities(feedId, reference)).toBeNull();
		expect(await repository.feedCapabilitiesStatus(feedId, reference)).toBe("invalid");
	});

	it("does not silently roll back from a higher incomplete generation", async () => {
		const { storage, values } = memoryStorage();
		const repository = new FeedCapabilityRepository(storage);
		const reference = await storeAt(repository, bundle);
		const first = highestManifest(values, reference);
		values.set(
			`${reference}-bm`,
			JSON.stringify({ ...first, generation: first.generation + 1 }),
		);

		expect(await repository.getFeedCapabilities(feedId, reference)).toBeNull();
		expect(await repository.feedCapabilitiesStatus(feedId, reference)).toBe("invalid");
	});

	it("rejects divergent manifests at the same generation", async () => {
		const { storage, values } = memoryStorage();
		const repository = new FeedCapabilityRepository(storage);
		const reference = await storeAt(repository, bundle);
		const first = highestManifest(values, reference);
		values.set(`${reference}-bm`, JSON.stringify({ ...first, contentDigest: "f".repeat(64) }));

		expect(await repository.feedCapabilitiesStatus(feedId, reference)).toBe("invalid");
	});

	it("distinguishes missing, unavailable, and invalid physical state", async () => {
		const harness = memoryStorage();
		const repository = new FeedCapabilityRepository(harness.storage);

		expect(await repository.readFeedCapabilities(feedId, referenceBase)).toEqual({
			status: "missing",
		});
		harness.values.set(referenceBase, "not-json");
		expect(await repository.readFeedCapabilities(feedId, referenceBase)).toEqual({
			status: "invalid",
		});
		harness.setGetUnavailable(true);
		expect(await repository.readFeedCapabilities(feedId, referenceBase)).toEqual({
			status: "unavailable",
		});
	});

	it("rejects cross-feed and foreign references before SecretStorage access", async () => {
		const { storage } = memoryStorage();
		const repository = new FeedCapabilityRepository(storage);
		const reference = await storeAt(repository, bundle);
		vi.mocked(storage.getSecret).mockClear();
		vi.mocked(storage.getSecret).mockImplementation(() => {
			throw new Error("must not read");
		});

		expect(await repository.getFeedCapabilities(otherFeedId, reference)).toBeNull();
		expect(await repository.getFeedCapabilities(feedId, "foreign")).toBeNull();
		expect(await repository.getEpisodeResources(feedId, "malformed", reference)).toBeNull();
		expect(storage.getSecret).not.toHaveBeenCalled();
	});

	it("bounds every nonblank physical SecretStorage item", async () => {
		const { storage, values } = memoryStorage();
		const repository = new FeedCapabilityRepository(storage);

		await storeAt(repository, largeSplitBundle());

		for (const [id, serialized] of values) {
			expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
			expect(id.length).toBeLessThanOrEqual(MAX_SECRET_STORAGE_ID_CHARACTERS);
			if (!serialized) continue;
			expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(
				MAX_SECRET_STORAGE_ITEM_BYTES,
			);
		}
		expect(MAX_SECRET_STORAGE_ITEM_BYTES).toBe(128 * 1024);
	});

	it("keeps maximum suffix and page-index IDs within the live 64-character limit", () => {
		const reference = feedCapabilityReferenceForAttempt(feedId, 999)!;
		const index = encodeFeedCapabilityPageIndex(MAX_PHYSICAL_PAGE_INDEX)!;
		const manifestId = `${reference}-am`;
		const pageId = `${reference}-a${index}`;

		expect(reference).toHaveLength(59);
		expect(index).toBe("zzz");
		expect(encodeFeedCapabilityPageIndex(MAX_PHYSICAL_PAGE_INDEX + 1)).toBeNull();
		expect(manifestId).toHaveLength(62);
		expect(pageId).toHaveLength(64);
		expect([manifestId, pageId].every((id) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))).toBe(
			true,
		);
	});

	it("reuses inactive slots and blanks only stale pages from the overwritten generation", async () => {
		const { storage, values } = memoryStorage();
		const repository = new FeedCapabilityRepository(storage);
		const firstBundle = twoEpisodeBundle();
		const reference = await storeAt(repository, firstBundle);
		const first = highestManifest(values, reference);
		await storeAt(repository, {
			...firstBundle,
			siteUrl: "https://example.com/second",
		});
		const second = highestManifest(values, reference);
		const firstKept = first.pages.find((page: any) => page.bucket === "3");
		const firstStale = first.pages.find((page: any) => page.bucket === "4");
		const secondStale = second.pages.find((page: any) => page.bucket === "4");

		expect(values.get(pageKey(reference, firstKept))).not.toBe("");
		expect(values.get(pageKey(reference, firstStale))).not.toBe("");
		await storeAt(repository, { ...bundle, siteUrl: "https://example.com/third" });
		const third = highestManifest(values, reference);
		const thirdKept = third.pages.find((page: any) => page.bucket === "3");

		expect(third.generation).toBe(3);
		expect(thirdKept.slot).toBe(firstKept.slot);
		expect(values.get(pageKey(reference, thirdKept))).not.toBe("");
		expect(values.get(pageKey(reference, firstStale))).toBe("");
		expect(values.get(pageKey(reference, secondStale))).not.toBe("");
	});

	it("fails closed on a foreign exact namespace without trying another suffix", async () => {
		const foreignMarker = JSON.stringify({
			schemaVersion: 1,
			kind: "feed-capability-namespace",
			feedId: otherFeedId,
		});
		const { storage, values } = memoryStorage({ [referenceBase]: foreignMarker });
		const repository = new FeedCapabilityRepository(storage);

		await expect(storeAt(repository, bundle)).rejects.toThrow(
			"Stored feed capability namespace is invalid",
		);

		expect(values.get(referenceBase)).toBe(foreignMarker);
		expect(values.has(`${referenceBase}-2`)).toBe(false);
	});

	it("uses the requested suffix exactly even when the base is occupied", async () => {
		const reference = feedCapabilityReferenceForAttempt(feedId, 2)!;
		const { storage, values } = memoryStorage({ [referenceBase]: "occupied" });
		const repository = new FeedCapabilityRepository(storage);

		expect(await storeAt(repository, bundle, reference)).toBe(reference);
		expect(values.get(referenceBase)).toBe("occupied");
		expect(await repository.getFeedCapabilities(feedId, reference)).toEqual(bundle);
	});

	it("reports a durable episode absent from the bundle as missing", async () => {
		const { storage } = memoryStorage();
		const repository = new FeedCapabilityRepository(storage);
		const reference = await storeAt(repository, bundle);

		expect(await repository.getEpisodeResources(feedId, otherEpisodeId, reference)).toBeNull();
		expect(await repository.readEpisodeResources(feedId, otherEpisodeId, reference)).toEqual({
			status: "missing",
		});
		expect(await repository.episodeResourcesStatus(feedId, otherEpisodeId, reference)).toBe(
			"missing",
		);
	});
});
