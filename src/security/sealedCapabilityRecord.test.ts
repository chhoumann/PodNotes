import { describe, expect, it } from "vitest";
import { createCapabilityVaultKey, type CapabilityVaultRandomFill } from "./capabilityVaultKey";
import { feedCapabilityReferenceForAttempt } from "./feedCapabilityReferences";
import type { EpisodeHandle, FeedHandle } from "./resourceHandles";
import {
	FeedCapabilitySealingError,
	MAX_SEALED_CAPABILITY_RECORD_BYTES,
	createCapabilityVaultKeyCheck,
	decodeCapabilityVaultKeyCheck,
	decodeSealedFeedCapabilityRecord,
	encodeCapabilityVaultKeyCheck,
	encodeSealedFeedCapabilityRecord,
	openSealedFeedCapabilityEnvelope,
	sealFeedCapabilityEnvelope,
	verifyCapabilityVaultKey,
} from "./sealedCapabilityRecord";
import type { FeedCapabilityEnvelope } from "./targetEnvelopes";

const feedId = `podnotes-feed-${"11".repeat(32)}` as FeedHandle;
const otherFeedId = `podnotes-feed-${"22".repeat(32)}` as FeedHandle;
const episodeId = `podnotes-episode-${"33".repeat(32)}` as EpisodeHandle;
const capabilityRef = feedCapabilityReferenceForAttempt(feedId, 1)!;
const otherCapabilityRef = feedCapabilityReferenceForAttempt(otherFeedId, 1)!;
const bundle: FeedCapabilityEnvelope = {
	schemaVersion: 1,
	kind: "feed-capability-bundle",
	feedId,
	subscriptionUrl: "https://secret.example/feed%2fmain.xml?token=signed-value",
	artworkUrl: "https://secret.example/private-artwork.jpg?token=artwork-value",
	guid: "private-feed-guid",
	privateGrants: {
		subscription: ["https://secret.example"],
	},
	episodeResources: {
		[episodeId]: {
			schemaVersion: 1,
			kind: "episode-resources",
			feedId,
			episodeId,
			streamUrl: "https://media.example/private.mp3?signature=episode-value",
			guid: "private-episode-guid",
		},
	},
};

function sequentialFill(start = 0): CapabilityVaultRandomFill {
	let next = start;
	return (bytes) => {
		for (let index = 0; index < bytes.length; index += 1) bytes[index] = next++ % 256;
	};
}

async function fixture() {
	const key = await createCapabilityVaultKey(sequentialFill());
	const record = await sealFeedCapabilityEnvelope(bundle, {
		key: key.importedKey,
		feedId,
		capabilityRef,
		fillRandom: sequentialFill(64),
	});
	return { key, record };
}

describe("sealed feed capability records", () => {
	it("seals and opens a fixed immutable record without clear targets", async () => {
		const { key, record } = await fixture();
		const serialized = encodeSealedFeedCapabilityRecord(record)!;

		expect(record.recordId).toBe("pncr-404142434445464748494a4b4c4d4e4f");
		expect(record.nonce).toBe("UFFSU1RVVldYWVpb");
		expect(decodeSealedFeedCapabilityRecord(serialized)).toEqual(record);
		expect(await openSealedFeedCapabilityEnvelope(record, key.importedKey)).toEqual({
			status: "available",
			value: bundle,
		});
		for (const targetFragment of [
			"secret.example",
			"media.example",
			"signed-value",
			"episode-value",
			"private-feed-guid",
		]) {
			expect(serialized).not.toContain(targetFragment);
		}
	});

	it("randomizes record identity, nonce, and ciphertext for the same plaintext", async () => {
		const key = await createCapabilityVaultKey(sequentialFill());
		const first = await sealFeedCapabilityEnvelope(bundle, {
			key: key.importedKey,
			feedId,
			capabilityRef,
			fillRandom: sequentialFill(64),
		});
		const second = await sealFeedCapabilityEnvelope(bundle, {
			key: key.importedKey,
			feedId,
			capabilityRef,
			fillRandom: sequentialFill(96),
		});

		expect(second.recordId).not.toBe(first.recordId);
		expect(second.nonce).not.toBe(first.nonce);
		expect(second.ciphertext).not.toBe(first.ciphertext);
	});

	it("seals a stable descriptor snapshot without rereading hostile proxy getters", async () => {
		const key = await createCapabilityVaultKey(sequentialFill());
		let guidReads = 0;
		const changing = new Proxy(bundle, {
			get(target, property, receiver) {
				if (property === "guid") {
					guidReads += 1;
					return "x".repeat(9_000);
				}
				return Reflect.get(target, property, receiver);
			},
		});

		const record = await sealFeedCapabilityEnvelope(changing, {
			key: key.importedKey,
			feedId,
			capabilityRef,
			fillRandom: sequentialFill(64),
		});
		expect(guidReads).toBe(0);
		expect(await openSealedFeedCapabilityEnvelope(record, key.importedKey)).toEqual({
			status: "available",
			value: bundle,
		});
	});

	it("authenticates every mutable clear binding", async () => {
		const { key, record } = await fixture();
		const otherRecordId = `pncr-${"aa".repeat(16)}`;
		const parentRecordId = `pncr-${"bb".repeat(16)}`;
		const suffixReference = feedCapabilityReferenceForAttempt(feedId, 2)!;
		const changedNonce = record.nonce.startsWith("A")
			? `B${record.nonce.slice(1)}`
			: `A${record.nonce.slice(1)}`;
		const variants = [
			{ ...record, recordId: otherRecordId },
			{ ...record, capabilityRef: suffixReference },
			{ ...record, feedId: otherFeedId, capabilityRef: otherCapabilityRef },
			{ ...record, generation: 2, parentRecordId },
			{ ...record, nonce: changedNonce },
		] as const;

		for (const variant of variants) {
			expect(await openSealedFeedCapabilityEnvelope(variant, key.importedKey)).toEqual({
				status: "invalid",
			});
		}
	});

	it("rejects wrong keys, ciphertext swaps, bit changes, truncation, and extension", async () => {
		const { key, record } = await fixture();
		const wrongKey = await createCapabilityVaultKey(sequentialFill(150));
		const other = await sealFeedCapabilityEnvelope(bundle, {
			key: key.importedKey,
			feedId,
			capabilityRef,
			fillRandom: sequentialFill(180),
		});
		const changed = `${record.ciphertext.startsWith("A") ? "B" : "A"}${record.ciphertext.slice(1)}`;
		const variants = [
			{ ...record, ciphertext: other.ciphertext },
			{ ...record, ciphertext: changed },
			{ ...record, ciphertext: record.ciphertext.slice(0, -1) },
			{ ...record, ciphertext: `${record.ciphertext}A` },
		];

		expect(await openSealedFeedCapabilityEnvelope(record, wrongKey.importedKey)).toEqual({
			status: "invalid",
		});
		for (const variant of variants) {
			expect(await openSealedFeedCapabilityEnvelope(variant, key.importedKey)).toEqual({
				status: "invalid",
			});
		}
	});

	it("requires a parent exactly when the immutable generation advances", async () => {
		const { key, record } = await fixture();
		const second = await sealFeedCapabilityEnvelope(bundle, {
			key: key.importedKey,
			feedId,
			capabilityRef,
			parentRecord: record,
			fillRandom: sequentialFill(96),
		});
		expect(second.parentRecordId).toBe(record.recordId);
		expect(second.generation).toBe(2);
		expect(await openSealedFeedCapabilityEnvelope(second, key.importedKey, record)).toEqual({
			status: "available",
			value: bundle,
		});
		expect(await openSealedFeedCapabilityEnvelope(second, key.importedKey)).toEqual({
			status: "invalid",
		});

		const otherFeedParent = await sealFeedCapabilityEnvelope(
			{
				schemaVersion: 1,
				kind: "feed-capability-bundle",
				feedId: otherFeedId,
				subscriptionUrl: "https://other.example/feed.xml",
				episodeResources: {},
			},
			{
				key: key.importedKey,
				feedId: otherFeedId,
				capabilityRef: otherCapabilityRef,
				fillRandom: sequentialFill(120),
			},
		);
		const otherKey = await createCapabilityVaultKey(sequentialFill(150));
		const otherKeyParent = await sealFeedCapabilityEnvelope(bundle, {
			key: otherKey.importedKey,
			feedId,
			capabilityRef,
			fillRandom: sequentialFill(190),
		});
		for (const parentRecord of [otherFeedParent, otherKeyParent]) {
			await expect(
				sealFeedCapabilityEnvelope(bundle, {
					key: key.importedKey,
					feedId,
					capabilityRef,
					parentRecord,
					fillRandom: sequentialFill(220),
				}),
			).rejects.toEqual(new FeedCapabilitySealingError());
		}
	});

	it("uses an authenticated key check even when the vault has no feed records", async () => {
		const key = await createCapabilityVaultKey(sequentialFill());
		const check = await createCapabilityVaultKeyCheck(key.importedKey, sequentialFill(200));
		const serialized = encodeCapabilityVaultKeyCheck(check)!;

		expect(check.ciphertext).toHaveLength(72);
		expect(decodeCapabilityVaultKeyCheck(serialized)).toEqual(check);
		expect(await verifyCapabilityVaultKey(check, key.importedKey)).toEqual({
			status: "available",
		});

		const wrongKey = await createCapabilityVaultKey(sequentialFill(30));
		expect(await verifyCapabilityVaultKey(check, wrongKey.importedKey)).toEqual({
			status: "invalid",
		});
		const changedCiphertext = `${check.ciphertext.startsWith("A") ? "B" : "A"}${check.ciphertext.slice(1)}`;
		expect(
			await verifyCapabilityVaultKey(
				{ ...check, ciphertext: changedCiphertext },
				key.importedKey,
			),
		).toEqual({ status: "invalid" });
	});

	it("accepts only strict canonical record and key-check JSON", async () => {
		const { key, record } = await fixture();
		const check = await createCapabilityVaultKeyCheck(key.importedKey, sequentialFill(200));
		const recordJson = encodeSealedFeedCapabilityRecord(record)!;
		const checkJson = encodeCapabilityVaultKeyCheck(check)!;

		expect(decodeSealedFeedCapabilityRecord(` ${recordJson}`)).toBeNull();
		expect(decodeSealedFeedCapabilityRecord(`${recordJson}\n`)).toBeNull();
		expect(
			decodeSealedFeedCapabilityRecord(JSON.stringify({ ...record, extra: true })),
		).toBeNull();
		expect(decodeCapabilityVaultKeyCheck(` ${checkJson}`)).toBeNull();
		expect(decodeCapabilityVaultKeyCheck(JSON.stringify({ ...check, extra: true }))).toBeNull();
		expect(
			decodeSealedFeedCapabilityRecord("A".repeat(MAX_SEALED_CAPABILITY_RECORD_BYTES + 1)),
		).toBeNull();
	});

	it("does not invoke ciphertext accessors and sanitizes invalid envelope errors", async () => {
		const { key, record } = await fixture();
		let accessed = false;
		const hostile = Object.defineProperty({ ...record }, "ciphertext", {
			enumerable: true,
			get() {
				accessed = true;
				return record.ciphertext;
			},
		});
		expect(encodeSealedFeedCapabilityRecord(hostile)).toBeNull();
		expect(accessed).toBe(false);

		await expect(
			sealFeedCapabilityEnvelope(
				{ ...bundle, subscriptionUrl: "https://sensitive.invalid/\n" },
				{
					key: key.importedKey,
					feedId,
					capabilityRef,
					fillRandom: sequentialFill(),
				},
			),
		).rejects.toEqual(new FeedCapabilitySealingError());
	});
});
