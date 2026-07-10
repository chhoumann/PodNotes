import { describe, expect, it } from "vitest";
import { createCapabilityVaultKey } from "./capabilityVaultKey";
import {
	CAPABILITY_VAULT_METADATA_SCHEMA_VERSION,
	decodeCapabilityVaultMetadata,
	encodeCapabilityVaultMetadata,
	validateCapabilityVaultMetadata,
} from "./capabilityVaultMetadata";
import { createCapabilityVaultKeyCheck } from "./sealedCapabilityRecord";

async function fixture(start = 0) {
	let next = start;
	const key = await createCapabilityVaultKey((bytes) => {
		for (let index = 0; index < bytes.length; index += 1) bytes[index] = next++;
	});
	const keyCheck = await createCapabilityVaultKeyCheck(key.importedKey, (bytes) => {
		for (let index = 0; index < bytes.length; index += 1) bytes[index] = next++;
	});
	return {
		schemaVersion: CAPABILITY_VAULT_METADATA_SCHEMA_VERSION,
		kind: "capability-vault-metadata" as const,
		algorithm: "A256GCM" as const,
		recoveryFormat: "PNCV1" as const,
		vaultId: key.importedKey.vaultId,
		keyId: key.importedKey.keyId,
		keyCheck,
	};
}

describe("capability vault metadata", () => {
	it("round-trips a target-free canonical key-check manifest", async () => {
		const value = await fixture();
		const serialized = encodeCapabilityVaultMetadata(value)!;

		expect(decodeCapabilityVaultMetadata(serialized)).toEqual(value);
		expect(serialized).not.toMatch(/https?:|token|guid|hostname/i);
	});

	it("rejects mismatched key-check authority", async () => {
		const value = await fixture();
		const other = await fixture(90);
		expect(validateCapabilityVaultMetadata({ ...value, keyCheck: other.keyCheck })).toBeNull();
	});

	it.each([
		{ extra: true },
		{ schemaVersion: 2 },
		{ kind: "synced-capability-vault" },
		{ algorithm: "AES-GCM" },
		{ recoveryFormat: "PNCV2" },
	])("rejects an invalid metadata mutation %#", async (mutation) => {
		const value = await fixture();
		expect(validateCapabilityVaultMetadata({ ...value, ...mutation })).toBeNull();
	});

	it("rejects noncanonical or oversized serialized input", async () => {
		const value = await fixture();
		const serialized = encodeCapabilityVaultMetadata(value)!;
		expect(decodeCapabilityVaultMetadata(` ${serialized}`)).toBeNull();
		expect(decodeCapabilityVaultMetadata(`${serialized}\n`)).toBeNull();
		expect(decodeCapabilityVaultMetadata(JSON.stringify({ ...value, extra: true }))).toBeNull();
		expect(decodeCapabilityVaultMetadata("A".repeat(2049))).toBeNull();
	});
});
