import {
	CAPABILITY_VAULT_ALGORITHM,
	CAPABILITY_VAULT_RECOVERY_FORMAT,
	isCapabilityVaultId,
	isCapabilityVaultKeyId,
	type CapabilityVaultId,
	type CapabilityVaultKeyId,
} from "./capabilityVaultKey";
import {
	validateCapabilityVaultKeyCheck,
	type CapabilityVaultKeyCheckV1,
} from "./sealedCapabilityRecord";
import { snapshotStrictDataRecord, utf8ByteLength } from "./strictData";

export const CAPABILITY_VAULT_METADATA_SCHEMA_VERSION = 1;
export const MAX_CAPABILITY_VAULT_METADATA_BYTES = 2 * 1024;

/** Target-free key identity only. Immutable feed records live outside this metadata. */
export interface CapabilityVaultMetadataV1 {
	readonly schemaVersion: typeof CAPABILITY_VAULT_METADATA_SCHEMA_VERSION;
	readonly kind: "capability-vault-metadata";
	readonly algorithm: typeof CAPABILITY_VAULT_ALGORITHM;
	readonly recoveryFormat: typeof CAPABILITY_VAULT_RECOVERY_FORMAT;
	readonly vaultId: CapabilityVaultId;
	readonly keyId: CapabilityVaultKeyId;
	readonly keyCheck: CapabilityVaultKeyCheckV1;
}

export function validateCapabilityVaultMetadata(value: unknown): CapabilityVaultMetadataV1 | null {
	const record = snapshotStrictDataRecord(value, [
		"schemaVersion",
		"kind",
		"algorithm",
		"recoveryFormat",
		"vaultId",
		"keyId",
		"keyCheck",
	]);
	if (
		!record ||
		record.schemaVersion !== CAPABILITY_VAULT_METADATA_SCHEMA_VERSION ||
		record.kind !== "capability-vault-metadata" ||
		record.algorithm !== CAPABILITY_VAULT_ALGORITHM ||
		record.recoveryFormat !== CAPABILITY_VAULT_RECOVERY_FORMAT ||
		!isCapabilityVaultId(record.vaultId) ||
		!isCapabilityVaultKeyId(record.keyId)
	) {
		return null;
	}
	const keyCheck = validateCapabilityVaultKeyCheck(record.keyCheck);
	if (!keyCheck || keyCheck.vaultId !== record.vaultId || keyCheck.keyId !== record.keyId) {
		return null;
	}
	const normalized: CapabilityVaultMetadataV1 = {
		schemaVersion: CAPABILITY_VAULT_METADATA_SCHEMA_VERSION,
		kind: "capability-vault-metadata",
		algorithm: CAPABILITY_VAULT_ALGORITHM,
		recoveryFormat: CAPABILITY_VAULT_RECOVERY_FORMAT,
		vaultId: record.vaultId,
		keyId: record.keyId,
		keyCheck,
	};
	return utf8ByteLength(JSON.stringify(normalized)) <= MAX_CAPABILITY_VAULT_METADATA_BYTES
		? normalized
		: null;
}

export function encodeCapabilityVaultMetadata(value: unknown): string | null {
	const normalized = validateCapabilityVaultMetadata(value);
	return normalized ? JSON.stringify(normalized) : null;
}

export function decodeCapabilityVaultMetadata(
	serialized: unknown,
): CapabilityVaultMetadataV1 | null {
	if (
		typeof serialized !== "string" ||
		serialized.length === 0 ||
		serialized.length > MAX_CAPABILITY_VAULT_METADATA_BYTES ||
		utf8ByteLength(serialized) > MAX_CAPABILITY_VAULT_METADATA_BYTES
	) {
		return null;
	}
	try {
		const normalized = validateCapabilityVaultMetadata(JSON.parse(serialized));
		return normalized && JSON.stringify(normalized) === serialized ? normalized : null;
	} catch {
		return null;
	}
}
