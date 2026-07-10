import { describe, expect, it } from "vitest";
import {
	CAPABILITY_VAULT_ALGORITHM,
	CAPABILITY_VAULT_KEY_SCHEMA_VERSION,
	CapabilityVaultCryptoError,
	capabilityVaultKeyFingerprint,
	createCapabilityVaultKey,
	decodeCapabilityVaultRecoveryCode,
	decodeLocalCapabilityVaultKey,
	encodeCapabilityVaultRecoveryCode,
	encodeLocalCapabilityVaultKey,
	importCapabilityVaultKey,
	isImportedCapabilityVaultKey,
	type CapabilityVaultRandomFill,
} from "./capabilityVaultKey";

const EXPECTED_LOCAL_KEY = {
	schemaVersion: CAPABILITY_VAULT_KEY_SCHEMA_VERSION,
	kind: "capability-vault-key",
	algorithm: CAPABILITY_VAULT_ALGORITHM,
	vaultId: "pncv-000102030405060708090a0b0c0d0e0f",
	keyId: "pnck-2ff6e1446606feeacee35215d553a56f",
	keyMaterial: "EBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8",
} as const;
const EXPECTED_RECOVERY_CODE =
	"PNCV1.000102030405060708090a0b0c0d0e0f.2ff6e1446606feeacee35215d553a56f.EBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8.ea0da65e52509b65";

function sequentialFill(): CapabilityVaultRandomFill {
	let next = 0;
	return (bytes) => {
		for (let index = 0; index < bytes.length; index += 1) bytes[index] = next++;
	};
}

describe("capability vault keys", () => {
	it("creates the fixed HKDF vector as a non-extractable AES-256-GCM key", async () => {
		const created = await createCapabilityVaultKey(sequentialFill());

		expect(created.localKey).toEqual(EXPECTED_LOCAL_KEY);
		expect(created.recoveryCode).toBe(EXPECTED_RECOVERY_CODE);
		expect(created.recoveryCode).toHaveLength(132);
		expect(created.importedKey.cryptoKey.algorithm).toEqual({ name: "AES-GCM", length: 256 });
		expect(created.importedKey.cryptoKey.extractable).toBe(false);
		expect(created.importedKey.cryptoKey.usages).toEqual(["encrypt", "decrypt"]);
		expect(created.importedKey.keyCheckCryptoKey.algorithm).toEqual({
			name: "AES-GCM",
			length: 256,
		});
		expect(created.importedKey.keyCheckCryptoKey.extractable).toBe(false);
		expect(created.importedKey.keyCheckCryptoKey).not.toBe(created.importedKey.cryptoKey);
		expect(isImportedCapabilityVaultKey(created.importedKey)).toBe(true);
		expect(JSON.stringify(created.importedKey)).not.toContain(EXPECTED_LOCAL_KEY.keyMaterial);
		expect(capabilityVaultKeyFingerprint(created.importedKey.keyId)).toBe(
			"2FF6E1446606FEEACEE3",
		);
	});

	it("round-trips only canonical local SecretStorage JSON", async () => {
		const created = await createCapabilityVaultKey(sequentialFill());
		const serialized = encodeLocalCapabilityVaultKey(created.localKey)!;

		expect(decodeLocalCapabilityVaultKey(serialized)).toEqual(EXPECTED_LOCAL_KEY);
		expect(
			await importCapabilityVaultKey(decodeLocalCapabilityVaultKey(serialized)),
		).not.toBeNull();
		expect(decodeLocalCapabilityVaultKey(` ${serialized}`)).toBeNull();
		expect(decodeLocalCapabilityVaultKey(`${serialized}\n`)).toBeNull();
		expect(
			decodeLocalCapabilityVaultKey(
				JSON.stringify({
					keyMaterial: EXPECTED_LOCAL_KEY.keyMaterial,
					schemaVersion: EXPECTED_LOCAL_KEY.schemaVersion,
					kind: EXPECTED_LOCAL_KEY.kind,
					algorithm: EXPECTED_LOCAL_KEY.algorithm,
					vaultId: EXPECTED_LOCAL_KEY.vaultId,
					keyId: EXPECTED_LOCAL_KEY.keyId,
				}),
			),
		).toBeNull();
	});

	it("round-trips the sensitive recovery code and rejects transcription changes", async () => {
		const decoded = await decodeCapabilityVaultRecoveryCode(EXPECTED_RECOVERY_CODE);
		expect(decoded?.localKey).toEqual(EXPECTED_LOCAL_KEY);
		expect(decoded && isImportedCapabilityVaultKey(decoded.importedKey)).toBe(true);
		expect(await encodeCapabilityVaultRecoveryCode(decoded?.localKey)).toBe(
			EXPECTED_RECOVERY_CODE,
		);

		const changedChecksum = `${EXPECTED_RECOVERY_CODE.slice(0, -1)}4`;
		const changedKey = EXPECTED_RECOVERY_CODE.replace(
			EXPECTED_LOCAL_KEY.keyMaterial,
			`A${EXPECTED_LOCAL_KEY.keyMaterial.slice(1)}`,
		);
		expect(await decodeCapabilityVaultRecoveryCode(changedChecksum)).toBeNull();
		expect(await decodeCapabilityVaultRecoveryCode(changedKey)).toBeNull();
		expect(
			await decodeCapabilityVaultRecoveryCode(EXPECTED_RECOVERY_CODE.toLowerCase()),
		).toBeNull();
		expect(await decodeCapabilityVaultRecoveryCode(` ${EXPECTED_RECOVERY_CODE}`)).toBeNull();
	});

	it("rejects a structurally valid local envelope whose key ID does not derive from the key", async () => {
		const mismatched = {
			...EXPECTED_LOCAL_KEY,
			keyId: "pnck-00000000000000000000000000000000",
		};
		expect(encodeLocalCapabilityVaultKey(mismatched)).not.toBeNull();
		expect(await importCapabilityVaultKey(mismatched)).toBeNull();
		expect(await encodeCapabilityVaultRecoveryCode(mismatched)).toBeNull();
	});

	it.each([
		{ ...EXPECTED_LOCAL_KEY, extra: true },
		{ ...EXPECTED_LOCAL_KEY, schemaVersion: 2 },
		{ ...EXPECTED_LOCAL_KEY, algorithm: "AES-GCM" },
		{ ...EXPECTED_LOCAL_KEY, vaultId: EXPECTED_LOCAL_KEY.vaultId.toUpperCase() },
		{ ...EXPECTED_LOCAL_KEY, keyId: "pnck-00" },
		{ ...EXPECTED_LOCAL_KEY, keyMaterial: `${EXPECTED_LOCAL_KEY.keyMaterial}=` },
	])("rejects a hostile local key envelope %#", async (value) => {
		expect(encodeLocalCapabilityVaultKey(value)).toBeNull();
		expect(await importCapabilityVaultKey(value)).toBeNull();
	});

	it("does not invoke accessors while validating local key material", async () => {
		let accessed = false;
		const value = Object.defineProperty({ ...EXPECTED_LOCAL_KEY }, "keyMaterial", {
			enumerable: true,
			get() {
				accessed = true;
				return EXPECTED_LOCAL_KEY.keyMaterial;
			},
		});
		expect(encodeLocalCapabilityVaultKey(value)).toBeNull();
		expect(await importCapabilityVaultKey(value)).toBeNull();
		expect(accessed).toBe(false);
	});

	it("sanitizes random-source failures", async () => {
		await expect(
			createCapabilityVaultKey(() => {
				throw new Error("sensitive random source detail");
			}),
		).rejects.toEqual(new CapabilityVaultCryptoError());
	});

	it("creates independent vault and key identities", async () => {
		const first = await createCapabilityVaultKey(sequentialFill());
		let value = 91;
		const second = await createCapabilityVaultKey((bytes) => {
			for (let index = 0; index < bytes.length; index += 1) bytes[index] = value++;
		});
		expect(second.localKey.vaultId).not.toBe(first.localKey.vaultId);
		expect(second.localKey.keyId).not.toBe(first.localKey.keyId);
		expect(second.recoveryCode).not.toBe(first.recoveryCode);
	});
});
