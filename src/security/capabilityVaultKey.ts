import { decodeBase64Url, encodeBase64Url } from "./base64Url";
import { snapshotStrictDataRecord, utf8ByteLength } from "./strictData";

export const CAPABILITY_VAULT_KEY_SCHEMA_VERSION = 1;
export const CAPABILITY_VAULT_ALGORITHM = "A256GCM";
export const CAPABILITY_VAULT_RECOVERY_FORMAT = "PNCV1";
export const MAX_LOCAL_CAPABILITY_VAULT_KEY_BYTES = 512;

const VAULT_ID_PATTERN = /^pncv-[0-9a-f]{32}$/;
const KEY_ID_PATTERN = /^pnck-[0-9a-f]{32}$/;
const RECOVERY_CODE_PATTERN =
	/^PNCV1\.([0-9a-f]{32})\.([0-9a-f]{32})\.([A-Za-z0-9_-]{43})\.([0-9a-f]{16})$/;
const RECOVERY_CHECKSUM_DOMAIN = "podnotes-capability-vault-recovery-v1";
const KEY_ID_INFO = "podnotes/capability-vault/v1/key-id";
const ENCRYPTION_KEY_INFO = "podnotes/capability-vault/v1/feed-capabilities";
const KEY_CHECK_KEY_INFO = "podnotes/capability-vault/v1/key-check";
const VAULT_ID_BYTES = 16;
const ROOT_KEY_BYTES = 32;
const RECOVERY_CODE_LENGTH = 132;
const textEncoder = new TextEncoder();
const authenticImportedKeys = new WeakSet<object>();

declare const capabilityVaultIdBrand: unique symbol;
declare const capabilityVaultKeyIdBrand: unique symbol;

export type CapabilityVaultId = string & { readonly [capabilityVaultIdBrand]: true };
export type CapabilityVaultKeyId = string & { readonly [capabilityVaultKeyIdBrand]: true };
export type CapabilityVaultRandomFill = (bytes: Uint8Array) => void;

export interface LocalCapabilityVaultKeyV1 {
	readonly schemaVersion: typeof CAPABILITY_VAULT_KEY_SCHEMA_VERSION;
	readonly kind: "capability-vault-key";
	readonly algorithm: typeof CAPABILITY_VAULT_ALGORITHM;
	readonly vaultId: CapabilityVaultId;
	readonly keyId: CapabilityVaultKeyId;
	readonly keyMaterial: string;
}

export interface ImportedCapabilityVaultKey {
	readonly vaultId: CapabilityVaultId;
	readonly keyId: CapabilityVaultKeyId;
	readonly cryptoKey: CryptoKey;
	readonly keyCheckCryptoKey: CryptoKey;
}

export interface CreatedCapabilityVaultKey {
	readonly localKey: LocalCapabilityVaultKeyV1;
	readonly importedKey: ImportedCapabilityVaultKey;
	/** Sensitive copy/paste recovery material. Never persist or log this string. */
	readonly recoveryCode: string;
}

export class CapabilityVaultCryptoError extends Error {
	constructor() {
		super("Capability vault cryptography is unavailable.");
		this.name = "CapabilityVaultCryptoError";
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

function decodeHex(value: string, expectedBytes: number): Uint8Array<ArrayBuffer> | null {
	if (value.length !== expectedBytes * 2 || !/^[0-9a-f]+$/.test(value)) return null;
	const bytes = new Uint8Array(expectedBytes);
	for (let index = 0; index < expectedBytes; index += 1) {
		bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
	}
	return bytes;
}

function vaultIdBytes(vaultId: CapabilityVaultId): Uint8Array<ArrayBuffer> | null {
	return decodeHex(vaultId.slice("pncv-".length), VAULT_ID_BYTES);
}

function normalizeLocalCapabilityVaultKey(value: unknown): LocalCapabilityVaultKeyV1 | null {
	const record = snapshotStrictDataRecord(value, [
		"schemaVersion",
		"kind",
		"algorithm",
		"vaultId",
		"keyId",
		"keyMaterial",
	]);
	if (
		!record ||
		record.schemaVersion !== CAPABILITY_VAULT_KEY_SCHEMA_VERSION ||
		record.kind !== "capability-vault-key" ||
		record.algorithm !== CAPABILITY_VAULT_ALGORITHM ||
		typeof record.vaultId !== "string" ||
		!VAULT_ID_PATTERN.test(record.vaultId) ||
		typeof record.keyId !== "string" ||
		!KEY_ID_PATTERN.test(record.keyId) ||
		typeof record.keyMaterial !== "string"
	) {
		return null;
	}
	const decodedKeyMaterial = decodeBase64Url(record.keyMaterial, ROOT_KEY_BYTES, ROOT_KEY_BYTES);
	if (!decodedKeyMaterial) return null;
	decodedKeyMaterial.fill(0);

	return {
		schemaVersion: CAPABILITY_VAULT_KEY_SCHEMA_VERSION,
		kind: "capability-vault-key",
		algorithm: CAPABILITY_VAULT_ALGORITHM,
		vaultId: record.vaultId as CapabilityVaultId,
		keyId: record.keyId as CapabilityVaultKeyId,
		keyMaterial: record.keyMaterial,
	};
}

async function deriveImportedKey(
	localKey: LocalCapabilityVaultKeyV1,
): Promise<ImportedCapabilityVaultKey | null> {
	const rootKey = decodeBase64Url(localKey.keyMaterial, ROOT_KEY_BYTES, ROOT_KEY_BYTES);
	const salt = vaultIdBytes(localKey.vaultId);
	if (!rootKey || !salt) return null;

	try {
		const subtle = getSubtle();
		const hkdfKey = await subtle.importKey("raw", rootKey, "HKDF", false, [
			"deriveBits",
			"deriveKey",
		]);
		const keyIdBits = await subtle.deriveBits(
			{
				name: "HKDF",
				hash: "SHA-256",
				salt,
				info: textEncoder.encode(KEY_ID_INFO),
			},
			hkdfKey,
			128,
		);
		const derivedKeyId = `pnck-${encodeHex(new Uint8Array(keyIdBits))}`;
		if (derivedKeyId !== localKey.keyId) return null;

		const cryptoKey = await subtle.deriveKey(
			{
				name: "HKDF",
				hash: "SHA-256",
				salt,
				info: textEncoder.encode(ENCRYPTION_KEY_INFO),
			},
			hkdfKey,
			{ name: "AES-GCM", length: 256 },
			false,
			["encrypt", "decrypt"],
		);
		const keyCheckCryptoKey = await subtle.deriveKey(
			{
				name: "HKDF",
				hash: "SHA-256",
				salt,
				info: textEncoder.encode(KEY_CHECK_KEY_INFO),
			},
			hkdfKey,
			{ name: "AES-GCM", length: 256 },
			false,
			["encrypt", "decrypt"],
		);
		const imported = Object.freeze({
			vaultId: localKey.vaultId,
			keyId: localKey.keyId,
			cryptoKey,
			keyCheckCryptoKey,
		});
		authenticImportedKeys.add(imported);
		return imported;
	} catch (error) {
		if (error instanceof CapabilityVaultCryptoError) throw error;
		throw new CapabilityVaultCryptoError();
	} finally {
		rootKey.fill(0);
	}
}

async function recoveryChecksum(
	vaultPayload: string,
	keyPayload: string,
	keyMaterial: string,
): Promise<string> {
	const message = `${RECOVERY_CHECKSUM_DOMAIN}\0${vaultPayload}\0${keyPayload}\0${keyMaterial}`;
	try {
		const digest = await getSubtle().digest("SHA-256", textEncoder.encode(message));
		return encodeHex(new Uint8Array(digest).subarray(0, 8));
	} catch (error) {
		if (error instanceof CapabilityVaultCryptoError) throw error;
		throw new CapabilityVaultCryptoError();
	}
}

function constantTimeTextEqual(left: string, right: string): boolean {
	if (left.length !== right.length) return false;
	let difference = 0;
	for (let index = 0; index < left.length; index += 1) {
		difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
	}
	return difference === 0;
}

export function isCapabilityVaultId(value: unknown): value is CapabilityVaultId {
	return typeof value === "string" && VAULT_ID_PATTERN.test(value);
}

export function isCapabilityVaultKeyId(value: unknown): value is CapabilityVaultKeyId {
	return typeof value === "string" && KEY_ID_PATTERN.test(value);
}

export function capabilityVaultKeyFingerprint(keyId: CapabilityVaultKeyId): string {
	return keyId.slice("pnck-".length, "pnck-".length + 20).toUpperCase();
}

export function isImportedCapabilityVaultKey(value: unknown): value is ImportedCapabilityVaultKey {
	return typeof value === "object" && value !== null && authenticImportedKeys.has(value);
}

export function encodeLocalCapabilityVaultKey(value: unknown): string | null {
	const normalized = normalizeLocalCapabilityVaultKey(value);
	if (!normalized) return null;
	const serialized = JSON.stringify(normalized);
	return utf8ByteLength(serialized) <= MAX_LOCAL_CAPABILITY_VAULT_KEY_BYTES ? serialized : null;
}

export function decodeLocalCapabilityVaultKey(
	serialized: unknown,
): LocalCapabilityVaultKeyV1 | null {
	if (
		typeof serialized !== "string" ||
		serialized.length === 0 ||
		serialized.length > MAX_LOCAL_CAPABILITY_VAULT_KEY_BYTES ||
		utf8ByteLength(serialized) > MAX_LOCAL_CAPABILITY_VAULT_KEY_BYTES
	) {
		return null;
	}
	try {
		const normalized = normalizeLocalCapabilityVaultKey(JSON.parse(serialized));
		return normalized && JSON.stringify(normalized) === serialized ? normalized : null;
	} catch {
		return null;
	}
}

export async function importCapabilityVaultKey(
	value: unknown,
): Promise<ImportedCapabilityVaultKey | null> {
	const localKey = normalizeLocalCapabilityVaultKey(value);
	return localKey ? deriveImportedKey(localKey) : null;
}

export async function encodeCapabilityVaultRecoveryCode(value: unknown): Promise<string | null> {
	const localKey = normalizeLocalCapabilityVaultKey(value);
	if (!localKey || !(await deriveImportedKey(localKey))) return null;
	const vaultPayload = localKey.vaultId.slice("pncv-".length);
	const keyPayload = localKey.keyId.slice("pnck-".length);
	const checksum = await recoveryChecksum(vaultPayload, keyPayload, localKey.keyMaterial);
	return `${CAPABILITY_VAULT_RECOVERY_FORMAT}.${vaultPayload}.${keyPayload}.${localKey.keyMaterial}.${checksum}`;
}

export async function decodeCapabilityVaultRecoveryCode(value: unknown): Promise<{
	localKey: LocalCapabilityVaultKeyV1;
	importedKey: ImportedCapabilityVaultKey;
} | null> {
	if (typeof value !== "string" || value.length !== RECOVERY_CODE_LENGTH) return null;
	const match = RECOVERY_CODE_PATTERN.exec(value);
	if (!match) return null;
	const [, vaultPayload, keyPayload, keyMaterial, suppliedChecksum] = match;
	const expectedChecksum = await recoveryChecksum(vaultPayload, keyPayload, keyMaterial);
	if (!constantTimeTextEqual(suppliedChecksum, expectedChecksum)) return null;

	const localKey = normalizeLocalCapabilityVaultKey({
		schemaVersion: CAPABILITY_VAULT_KEY_SCHEMA_VERSION,
		kind: "capability-vault-key",
		algorithm: CAPABILITY_VAULT_ALGORITHM,
		vaultId: `pncv-${vaultPayload}`,
		keyId: `pnck-${keyPayload}`,
		keyMaterial,
	});
	if (!localKey) return null;
	const importedKey = await deriveImportedKey(localKey);
	return importedKey ? { localKey, importedKey } : null;
}

export async function createCapabilityVaultKey(
	fillRandom: CapabilityVaultRandomFill = fillWithWebCrypto,
): Promise<CreatedCapabilityVaultKey> {
	const rootBytes = new Uint8Array(ROOT_KEY_BYTES);
	try {
		const vaultBytes = new Uint8Array(VAULT_ID_BYTES);
		fillRandom(vaultBytes);
		fillRandom(rootBytes);
		const vaultId = `pncv-${encodeHex(vaultBytes)}` as CapabilityVaultId;
		const provisional: LocalCapabilityVaultKeyV1 = {
			schemaVersion: CAPABILITY_VAULT_KEY_SCHEMA_VERSION,
			kind: "capability-vault-key",
			algorithm: CAPABILITY_VAULT_ALGORITHM,
			vaultId,
			keyId: "pnck-00000000000000000000000000000000" as CapabilityVaultKeyId,
			keyMaterial: encodeBase64Url(rootBytes),
		};

		const subtle = getSubtle();
		const hkdfKey = await subtle.importKey("raw", rootBytes, "HKDF", false, ["deriveBits"]);
		const keyIdBits = await subtle.deriveBits(
			{
				name: "HKDF",
				hash: "SHA-256",
				salt: vaultBytes,
				info: textEncoder.encode(KEY_ID_INFO),
			},
			hkdfKey,
			128,
		);
		const localKey: LocalCapabilityVaultKeyV1 = Object.freeze({
			...provisional,
			keyId: `pnck-${encodeHex(new Uint8Array(keyIdBits))}` as CapabilityVaultKeyId,
		});
		const importedKey = await deriveImportedKey(localKey);
		if (!importedKey) throw new CapabilityVaultCryptoError();
		const recoveryCode = await encodeCapabilityVaultRecoveryCode(localKey);
		if (!recoveryCode) throw new CapabilityVaultCryptoError();
		return Object.freeze({ localKey, importedKey, recoveryCode });
	} catch (error) {
		if (error instanceof CapabilityVaultCryptoError) throw error;
		throw new CapabilityVaultCryptoError();
	} finally {
		rootBytes.fill(0);
	}
}
