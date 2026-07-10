import {
	CAPABILITY_VAULT_ALGORITHM,
	CapabilityVaultCryptoError,
	isCapabilityVaultId,
	isCapabilityVaultKeyId,
	isImportedCapabilityVaultKey,
	type CapabilityVaultId,
	type CapabilityVaultKeyId,
	type CapabilityVaultRandomFill,
	type ImportedCapabilityVaultKey,
} from "./capabilityVaultKey";
import { decodeBase64Url, encodeBase64Url } from "./base64Url";
import {
	isFeedCapabilityReferenceFor,
	type FeedCapabilityReference,
} from "./feedCapabilityReferences";
import { isFeedHandle, type FeedHandle } from "./resourceHandles";
import { snapshotStrictDataRecord, utf8ByteLength } from "./strictData";
import {
	MAX_FEED_CAPABILITY_ENVELOPE_BYTES,
	TARGET_ENVELOPE_SCHEMA_VERSION,
	validateFeedCapabilityEnvelope,
	type FeedCapabilityEnvelope,
} from "./targetEnvelopes";

/**
 * Pure, storage-agnostic recovery primitives. Persist each sealed record as an
 * immutable revision and retain divergent heads. A mutable last-writer-wins map
 * is not a safe storage implementation for this format.
 */

export const SEALED_CAPABILITY_RECORD_SCHEMA_VERSION = 1;
export const CAPABILITY_VAULT_KEY_CHECK_SCHEMA_VERSION = 1;
export const MAX_SEALED_CAPABILITY_RECORD_BYTES = 2 * 1024 * 1024;
export const MAX_SEALED_CAPABILITY_CIPHERTEXT_BYTES = MAX_FEED_CAPABILITY_ENVELOPE_BYTES + 16;
export const MAX_CAPABILITY_RECORD_GENERATION = Number.MAX_SAFE_INTEGER;

const RECORD_ID_PATTERN = /^pncr-[0-9a-f]{32}$/;
const NONCE_BYTES = 12;
const RECORD_ID_BYTES = 16;
const GCM_TAG_BYTES = 16;
const KEY_CHECK_PLAINTEXT = "podnotes-capability-vault-key-check-v1";
const KEY_CHECK_PLAINTEXT_BYTES = 38;
const KEY_CHECK_CIPHERTEXT_BYTES = KEY_CHECK_PLAINTEXT_BYTES + GCM_TAG_BYTES;
const RECORD_AAD_DOMAIN = "podnotes/feed-capability";
const KEY_CHECK_AAD_DOMAIN = "podnotes/capability-vault/key-check";
const textEncoder = new TextEncoder();
const fatalTextDecoder = new TextDecoder("utf-8", { fatal: true });

declare const sealedCapabilityRecordIdBrand: unique symbol;
export type SealedCapabilityRecordId = string & {
	readonly [sealedCapabilityRecordIdBrand]: true;
};

export interface SealedFeedCapabilityRecordV1 {
	readonly schemaVersion: typeof SEALED_CAPABILITY_RECORD_SCHEMA_VERSION;
	readonly kind: "sealed-feed-capability";
	readonly algorithm: typeof CAPABILITY_VAULT_ALGORITHM;
	readonly vaultId: CapabilityVaultId;
	readonly keyId: CapabilityVaultKeyId;
	readonly recordId: SealedCapabilityRecordId;
	readonly feedId: FeedHandle;
	readonly capabilityRef: FeedCapabilityReference;
	readonly envelopeSchemaVersion: typeof TARGET_ENVELOPE_SCHEMA_VERSION;
	readonly generation: number;
	readonly parentRecordId?: SealedCapabilityRecordId;
	readonly nonce: string;
	readonly ciphertext: string;
}

export interface CapabilityVaultKeyCheckV1 {
	readonly schemaVersion: typeof CAPABILITY_VAULT_KEY_CHECK_SCHEMA_VERSION;
	readonly kind: "capability-vault-key-check";
	readonly algorithm: typeof CAPABILITY_VAULT_ALGORITHM;
	readonly vaultId: CapabilityVaultId;
	readonly keyId: CapabilityVaultKeyId;
	readonly nonce: string;
	readonly ciphertext: string;
}

export interface SealFeedCapabilityOptions {
	readonly key: ImportedCapabilityVaultKey;
	readonly feedId: FeedHandle | string;
	readonly capabilityRef: unknown;
	readonly parentRecord?: unknown;
	readonly fillRandom?: CapabilityVaultRandomFill;
}

export type OpenSealedFeedCapabilityResult =
	| { readonly status: "available"; readonly value: FeedCapabilityEnvelope }
	| { readonly status: "invalid" | "unavailable" };

export type VerifyCapabilityVaultKeyResult =
	| { readonly status: "available" }
	| { readonly status: "invalid" | "unavailable" };

export class FeedCapabilitySealingError extends Error {
	constructor() {
		super("Feed capabilities could not be sealed.");
		this.name = "FeedCapabilitySealingError";
	}
}

function fillWithWebCrypto(bytes: Uint8Array): void {
	// oxlint-disable-next-line obsidianmd/no-global-this -- Web Crypto is the shared desktop/mobile runtime primitive.
	const crypto = globalThis.crypto;
	if (!crypto || typeof crypto.getRandomValues !== "function")
		throw new CapabilityVaultCryptoError();
	crypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>);
}

function getSubtle(): SubtleCrypto {
	// oxlint-disable-next-line obsidianmd/no-global-this -- Web Crypto is the shared desktop/mobile runtime primitive.
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) throw new CapabilityVaultCryptoError();
	return subtle;
}

function encodeHex(bytes: Uint8Array): string {
	let result = "";
	for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
	return result;
}

function allocateRecordId(fillRandom: CapabilityVaultRandomFill): SealedCapabilityRecordId {
	const bytes = new Uint8Array(RECORD_ID_BYTES);
	fillRandom(bytes);
	return `pncr-${encodeHex(bytes)}` as SealedCapabilityRecordId;
}

function isGeneration(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value >= 1 &&
		value <= MAX_CAPABILITY_RECORD_GENERATION
	);
}

export function isSealedCapabilityRecordId(value: unknown): value is SealedCapabilityRecordId {
	return typeof value === "string" && RECORD_ID_PATTERN.test(value);
}

function normalizeSealedRecord(value: unknown): SealedFeedCapabilityRecordV1 | null {
	const baseKeys = [
		"schemaVersion",
		"kind",
		"algorithm",
		"vaultId",
		"keyId",
		"recordId",
		"feedId",
		"capabilityRef",
		"envelopeSchemaVersion",
		"generation",
		"nonce",
		"ciphertext",
	] as const;
	const withParent = snapshotStrictDataRecord(value, [...baseKeys, "parentRecordId"]);
	const record = withParent ?? snapshotStrictDataRecord(value, baseKeys);
	if (
		!record ||
		record.schemaVersion !== SEALED_CAPABILITY_RECORD_SCHEMA_VERSION ||
		record.kind !== "sealed-feed-capability" ||
		record.algorithm !== CAPABILITY_VAULT_ALGORITHM ||
		!isCapabilityVaultId(record.vaultId) ||
		!isCapabilityVaultKeyId(record.keyId) ||
		!isSealedCapabilityRecordId(record.recordId) ||
		!isFeedHandle(record.feedId) ||
		!isFeedCapabilityReferenceFor(record.feedId, record.capabilityRef) ||
		record.envelopeSchemaVersion !== TARGET_ENVELOPE_SCHEMA_VERSION ||
		!isGeneration(record.generation) ||
		typeof record.nonce !== "string" ||
		!decodeBase64Url(record.nonce, NONCE_BYTES, NONCE_BYTES) ||
		typeof record.ciphertext !== "string"
	) {
		return null;
	}

	const ciphertext = decodeBase64Url(record.ciphertext, MAX_SEALED_CAPABILITY_CIPHERTEXT_BYTES);
	if (!ciphertext || ciphertext.byteLength <= GCM_TAG_BYTES) return null;

	let parentRecordId: SealedCapabilityRecordId | undefined;
	if (withParent) {
		if (
			!isSealedCapabilityRecordId(record.parentRecordId) ||
			record.parentRecordId === record.recordId ||
			record.generation === 1
		) {
			return null;
		}
		parentRecordId = record.parentRecordId;
	} else if (record.generation !== 1) {
		return null;
	}

	const normalized: SealedFeedCapabilityRecordV1 = {
		schemaVersion: SEALED_CAPABILITY_RECORD_SCHEMA_VERSION,
		kind: "sealed-feed-capability",
		algorithm: CAPABILITY_VAULT_ALGORITHM,
		vaultId: record.vaultId,
		keyId: record.keyId,
		recordId: record.recordId,
		feedId: record.feedId,
		capabilityRef: record.capabilityRef,
		envelopeSchemaVersion: TARGET_ENVELOPE_SCHEMA_VERSION,
		generation: record.generation,
		...(parentRecordId ? { parentRecordId } : {}),
		nonce: record.nonce,
		ciphertext: record.ciphertext,
	};
	return utf8ByteLength(JSON.stringify(normalized)) <= MAX_SEALED_CAPABILITY_RECORD_BYTES
		? normalized
		: null;
}

function recordAad(
	record: Omit<SealedFeedCapabilityRecordV1, "ciphertext">,
): Uint8Array<ArrayBuffer> {
	return textEncoder.encode(
		JSON.stringify({
			domain: RECORD_AAD_DOMAIN,
			version: SEALED_CAPABILITY_RECORD_SCHEMA_VERSION,
			algorithm: record.algorithm,
			vaultId: record.vaultId,
			keyId: record.keyId,
			recordId: record.recordId,
			feedId: record.feedId,
			capabilityRef: record.capabilityRef,
			envelopeSchemaVersion: record.envelopeSchemaVersion,
			generation: record.generation,
			parentRecordId: record.parentRecordId ?? null,
			nonce: record.nonce,
		}),
	) as Uint8Array<ArrayBuffer>;
}

function normalizeKeyCheck(value: unknown): CapabilityVaultKeyCheckV1 | null {
	const record = snapshotStrictDataRecord(value, [
		"schemaVersion",
		"kind",
		"algorithm",
		"vaultId",
		"keyId",
		"nonce",
		"ciphertext",
	]);
	if (
		!record ||
		record.schemaVersion !== CAPABILITY_VAULT_KEY_CHECK_SCHEMA_VERSION ||
		record.kind !== "capability-vault-key-check" ||
		record.algorithm !== CAPABILITY_VAULT_ALGORITHM ||
		!isCapabilityVaultId(record.vaultId) ||
		!isCapabilityVaultKeyId(record.keyId) ||
		typeof record.nonce !== "string" ||
		!decodeBase64Url(record.nonce, NONCE_BYTES, NONCE_BYTES) ||
		typeof record.ciphertext !== "string" ||
		!decodeBase64Url(record.ciphertext, KEY_CHECK_CIPHERTEXT_BYTES, KEY_CHECK_CIPHERTEXT_BYTES)
	) {
		return null;
	}
	return {
		schemaVersion: CAPABILITY_VAULT_KEY_CHECK_SCHEMA_VERSION,
		kind: "capability-vault-key-check",
		algorithm: CAPABILITY_VAULT_ALGORITHM,
		vaultId: record.vaultId,
		keyId: record.keyId,
		nonce: record.nonce,
		ciphertext: record.ciphertext,
	};
}

function keyCheckAad(
	value: Pick<CapabilityVaultKeyCheckV1, "vaultId" | "keyId" | "nonce">,
): Uint8Array<ArrayBuffer> {
	return textEncoder.encode(
		JSON.stringify({
			domain: KEY_CHECK_AAD_DOMAIN,
			version: CAPABILITY_VAULT_KEY_CHECK_SCHEMA_VERSION,
			algorithm: CAPABILITY_VAULT_ALGORITHM,
			vaultId: value.vaultId,
			keyId: value.keyId,
			nonce: value.nonce,
		}),
	) as Uint8Array<ArrayBuffer>;
}

function directParentMatches(
	record: SealedFeedCapabilityRecordV1,
	parent: SealedFeedCapabilityRecordV1,
): boolean {
	return (
		record.generation === parent.generation + 1 &&
		record.parentRecordId === parent.recordId &&
		record.vaultId === parent.vaultId &&
		record.keyId === parent.keyId &&
		record.feedId === parent.feedId &&
		record.capabilityRef === parent.capabilityRef
	);
}

async function decryptNormalizedRecord(
	record: SealedFeedCapabilityRecordV1,
	key: ImportedCapabilityVaultKey,
): Promise<OpenSealedFeedCapabilityResult> {
	const nonce = decodeBase64Url(record.nonce, NONCE_BYTES, NONCE_BYTES);
	const ciphertext = decodeBase64Url(record.ciphertext, MAX_SEALED_CAPABILITY_CIPHERTEXT_BYTES);
	if (!nonce || !ciphertext) return { status: "invalid" };

	let plaintextBytes: ArrayBuffer;
	try {
		plaintextBytes = await getSubtle().decrypt(
			{
				name: "AES-GCM",
				iv: nonce,
				additionalData: recordAad(record),
				tagLength: 128,
			},
			key.cryptoKey,
			ciphertext,
		);
	} catch (error) {
		return error instanceof CapabilityVaultCryptoError
			? { status: "unavailable" }
			: { status: "invalid" };
	}

	try {
		const plaintext = fatalTextDecoder.decode(plaintextBytes);
		if (utf8ByteLength(plaintext) > MAX_FEED_CAPABILITY_ENVELOPE_BYTES) {
			return { status: "invalid" };
		}
		const envelope = validateFeedCapabilityEnvelope(JSON.parse(plaintext), record.feedId);
		return envelope && JSON.stringify(envelope) === plaintext
			? { status: "available", value: envelope }
			: { status: "invalid" };
	} catch {
		return { status: "invalid" };
	}
}

export function encodeSealedFeedCapabilityRecord(value: unknown): string | null {
	const normalized = normalizeSealedRecord(value);
	return normalized ? JSON.stringify(normalized) : null;
}

export function validateSealedFeedCapabilityRecord(
	value: unknown,
): SealedFeedCapabilityRecordV1 | null {
	return normalizeSealedRecord(value);
}

export function decodeSealedFeedCapabilityRecord(
	serialized: unknown,
): SealedFeedCapabilityRecordV1 | null {
	if (
		typeof serialized !== "string" ||
		serialized.length === 0 ||
		serialized.length > MAX_SEALED_CAPABILITY_RECORD_BYTES ||
		utf8ByteLength(serialized) > MAX_SEALED_CAPABILITY_RECORD_BYTES
	) {
		return null;
	}
	try {
		const normalized = normalizeSealedRecord(JSON.parse(serialized));
		return normalized && JSON.stringify(normalized) === serialized ? normalized : null;
	} catch {
		return null;
	}
}

export function encodeCapabilityVaultKeyCheck(value: unknown): string | null {
	const normalized = normalizeKeyCheck(value);
	return normalized ? JSON.stringify(normalized) : null;
}

export function validateCapabilityVaultKeyCheck(value: unknown): CapabilityVaultKeyCheckV1 | null {
	return normalizeKeyCheck(value);
}

export function decodeCapabilityVaultKeyCheck(
	serialized: unknown,
): CapabilityVaultKeyCheckV1 | null {
	if (typeof serialized !== "string" || serialized.length === 0 || serialized.length > 1024) {
		return null;
	}
	try {
		const normalized = normalizeKeyCheck(JSON.parse(serialized));
		return normalized && JSON.stringify(normalized) === serialized ? normalized : null;
	} catch {
		return null;
	}
}

export async function sealFeedCapabilityEnvelope(
	value: unknown,
	options: SealFeedCapabilityOptions,
): Promise<SealedFeedCapabilityRecordV1> {
	try {
		const key = options.key;
		const feedId = options.feedId;
		const capabilityRef = options.capabilityRef;
		const parentRecordValue = options.parentRecord;
		const configuredFillRandom = options.fillRandom;
		if (
			!isImportedCapabilityVaultKey(key) ||
			!isFeedHandle(feedId) ||
			!isFeedCapabilityReferenceFor(feedId, capabilityRef)
		) {
			throw new FeedCapabilitySealingError();
		}
		const envelope = validateFeedCapabilityEnvelope(value, feedId);
		if (!envelope) throw new FeedCapabilitySealingError();
		const parentRecord =
			parentRecordValue === undefined ? undefined : normalizeSealedRecord(parentRecordValue);
		if (
			parentRecordValue !== undefined &&
			(!parentRecord ||
				parentRecord.vaultId !== key.vaultId ||
				parentRecord.keyId !== key.keyId ||
				parentRecord.feedId !== feedId ||
				parentRecord.capabilityRef !== capabilityRef ||
				parentRecord.generation >= MAX_CAPABILITY_RECORD_GENERATION)
		) {
			throw new FeedCapabilitySealingError();
		}
		if (parentRecord) {
			const openedParent = await decryptNormalizedRecord(parentRecord, key);
			if (openedParent.status !== "available") throw new FeedCapabilitySealingError();
		}
		const generation = parentRecord ? parentRecord.generation + 1 : 1;

		const fillRandom = configuredFillRandom ?? fillWithWebCrypto;
		const nonceBytes = new Uint8Array(NONCE_BYTES);
		const recordId = allocateRecordId(fillRandom);
		fillRandom(nonceBytes);
		const clearRecord: Omit<SealedFeedCapabilityRecordV1, "ciphertext"> = {
			schemaVersion: SEALED_CAPABILITY_RECORD_SCHEMA_VERSION,
			kind: "sealed-feed-capability" as const,
			algorithm: CAPABILITY_VAULT_ALGORITHM,
			vaultId: key.vaultId,
			keyId: key.keyId,
			recordId,
			feedId,
			capabilityRef,
			envelopeSchemaVersion: TARGET_ENVELOPE_SCHEMA_VERSION,
			generation,
			...(parentRecord ? { parentRecordId: parentRecord.recordId } : {}),
			nonce: encodeBase64Url(nonceBytes),
		};
		const plaintext = textEncoder.encode(JSON.stringify(envelope));
		const ciphertext = await getSubtle().encrypt(
			{
				name: "AES-GCM",
				iv: nonceBytes,
				additionalData: recordAad(clearRecord),
				tagLength: 128,
			},
			key.cryptoKey,
			plaintext,
		);
		const record = normalizeSealedRecord({
			...clearRecord,
			ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
		});
		if (!record) throw new FeedCapabilitySealingError();
		return record;
	} catch (error) {
		if (error instanceof FeedCapabilitySealingError) throw error;
		throw new FeedCapabilitySealingError();
	}
}

export async function openSealedFeedCapabilityEnvelope(
	value: unknown,
	key: ImportedCapabilityVaultKey,
	parentValue?: unknown,
): Promise<OpenSealedFeedCapabilityResult> {
	const record = normalizeSealedRecord(value);
	if (
		!record ||
		!isImportedCapabilityVaultKey(key) ||
		record.vaultId !== key.vaultId ||
		record.keyId !== key.keyId
	) {
		return { status: "invalid" };
	}

	if (record.generation === 1) {
		if (parentValue !== undefined) return { status: "invalid" };
	} else {
		const parent = normalizeSealedRecord(parentValue);
		if (!parent || !directParentMatches(record, parent)) return { status: "invalid" };
		const openedParent = await decryptNormalizedRecord(parent, key);
		if (openedParent.status !== "available") return openedParent;
	}

	return decryptNormalizedRecord(record, key);
}

export async function createCapabilityVaultKeyCheck(
	key: ImportedCapabilityVaultKey,
	fillRandom: CapabilityVaultRandomFill = fillWithWebCrypto,
): Promise<CapabilityVaultKeyCheckV1> {
	try {
		if (!isImportedCapabilityVaultKey(key)) throw new CapabilityVaultCryptoError();
		const nonceBytes = new Uint8Array(NONCE_BYTES);
		fillRandom(nonceBytes);
		const clear = {
			vaultId: key.vaultId,
			keyId: key.keyId,
			nonce: encodeBase64Url(nonceBytes),
		};
		const ciphertext = await getSubtle().encrypt(
			{
				name: "AES-GCM",
				iv: nonceBytes,
				additionalData: keyCheckAad(clear),
				tagLength: 128,
			},
			key.keyCheckCryptoKey,
			textEncoder.encode(KEY_CHECK_PLAINTEXT),
		);
		const result = normalizeKeyCheck({
			schemaVersion: CAPABILITY_VAULT_KEY_CHECK_SCHEMA_VERSION,
			kind: "capability-vault-key-check",
			algorithm: CAPABILITY_VAULT_ALGORITHM,
			...clear,
			ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
		});
		if (!result) throw new CapabilityVaultCryptoError();
		return result;
	} catch {
		throw new CapabilityVaultCryptoError();
	}
}

export async function verifyCapabilityVaultKey(
	value: unknown,
	key: ImportedCapabilityVaultKey,
): Promise<VerifyCapabilityVaultKeyResult> {
	const check = normalizeKeyCheck(value);
	if (
		!check ||
		!isImportedCapabilityVaultKey(key) ||
		check.vaultId !== key.vaultId ||
		check.keyId !== key.keyId
	) {
		return { status: "invalid" };
	}
	const nonce = decodeBase64Url(check.nonce, NONCE_BYTES, NONCE_BYTES);
	const ciphertext = decodeBase64Url(
		check.ciphertext,
		KEY_CHECK_CIPHERTEXT_BYTES,
		KEY_CHECK_CIPHERTEXT_BYTES,
	);
	if (!nonce || !ciphertext) return { status: "invalid" };

	try {
		const plaintext = await getSubtle().decrypt(
			{
				name: "AES-GCM",
				iv: nonce,
				additionalData: keyCheckAad(check),
				tagLength: 128,
			},
			key.keyCheckCryptoKey,
			ciphertext,
		);
		return fatalTextDecoder.decode(plaintext) === KEY_CHECK_PLAINTEXT
			? { status: "available" }
			: { status: "invalid" };
	} catch (error) {
		return error instanceof CapabilityVaultCryptoError
			? { status: "unavailable" }
			: { status: "invalid" };
	}
}
