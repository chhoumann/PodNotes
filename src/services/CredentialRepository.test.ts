import { describe, expect, it, vi } from "vitest";
import type { SecretStorage } from "obsidian";
import { DEFAULT_SETTINGS } from "src/constants";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import { CredentialRepository } from "./CredentialRepository";

function storage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	return {
		values,
		api: {
			getSecret: vi.fn((id: string) => values.get(id) ?? null),
			setSecret: vi.fn((id: string, value: string) => {
				values.set(id, value);
			}),
			listSecrets: vi.fn(() => [...values.keys()]),
		} as unknown as SecretStorage,
	};
}

function settings(overrides: Partial<IPodNotesSettings> = {}): IPodNotesSettings {
	return { ...structuredClone(DEFAULT_SETTINGS), ...overrides };
}

describe("CredentialRepository", () => {
	it("stores credentials under fixed PodNotes IDs and verifies them", () => {
		const { api, values } = storage();
		const repository = new CredentialRepository(api);

		expect(repository.storeValues({ openAI: "  sk-openai  ", deepgram: "dg-key" })).toEqual({
			openAISecretId: "podnotes-openai-api-key",
			deepgramSecretId: "podnotes-deepgram-api-key",
		});
		expect(values.get("podnotes-openai-api-key")).toBe("sk-openai");
		expect(values.get("podnotes-deepgram-api-key")).toBe("dg-key");
		expect(api.getSecret).toHaveBeenCalledWith("podnotes-openai-api-key");
	});

	it("reuses an exact value so a migration retry is idempotent", () => {
		const { api } = storage({ "podnotes-openai-api-key": "sk-existing" });
		const repository = new CredentialRepository(api);

		expect(repository.storeValues({ openAI: "sk-existing" })).toEqual({
			openAISecretId: "podnotes-openai-api-key",
		});
		expect(api.setSecret).not.toHaveBeenCalled();
	});

	it("uses a collision-safe suffix and never overwrites another value", () => {
		const { api, values } = storage({
			"podnotes-openai-api-key": "someone-else",
			"podnotes-openai-api-key-2": "also-taken",
		});
		const repository = new CredentialRepository(api);

		expect(repository.storeValues({ openAI: "sk-new" })).toEqual({
			openAISecretId: "podnotes-openai-api-key-3",
		});
		expect(values.get("podnotes-openai-api-key")).toBe("someone-else");
		expect(values.get("podnotes-openai-api-key-3")).toBe("sk-new");
	});

	it("fails when SecretStorage cannot read back the written value", () => {
		const api = {
			getSecret: vi.fn().mockReturnValueOnce(null).mockReturnValueOnce(null),
			setSecret: vi.fn(),
			listSecrets: vi.fn(() => []),
		} as unknown as SecretStorage;
		const repository = new CredentialRepository(api);

		expect(() => repository.storeValues({ openAI: "sk" })).toThrow(
			/SecretStorage did not retain/,
		);
	});

	it("runtime reads fail closed without retaining values in the repository", () => {
		const { api } = storage({ "podnotes-openai-api-key": "  sk-runtime  " });
		const repository = new CredentialRepository(api);
		const configured = settings({ openAISecretId: "podnotes-openai-api-key" });

		expect(repository.get(configured, "openai")).toBe("sk-runtime");
		expect(repository.has(configured, "openai")).toBe(true);
		expect(repository.get(settings(), "openai")).toBeNull();

		(api.getSecret as ReturnType<typeof vi.fn>).mockImplementation(() => {
			throw new Error("storage unavailable");
		});
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		expect(repository.get(configured, "openai")).toBeNull();
	});

	it("never dereferences foreign or cross-provider persisted references", () => {
		const { api } = storage({
			"shared-api-key": "foreign-value",
			"podnotes-deepgram-api-key": "deepgram-value",
			"podnotes-openai-api-key": "openai-value",
		});
		const repository = new CredentialRepository(api);

		expect(repository.get(settings({ openAISecretId: "shared-api-key" }), "openai")).toBeNull();
		expect(
			repository.get(settings({ openAISecretId: "podnotes-deepgram-api-key" }), "openai"),
		).toBeNull();
		expect(
			repository.get(settings({ deepgramSecretId: "podnotes-openai-api-key" }), "deepgram"),
		).toBeNull();
		expect(api.getSecret).not.toHaveBeenCalled();
	});

	it("copies an explicitly selected foreign secret into a provider-owned ID", () => {
		const { api, values } = storage({
			"shared-api-key": "  sk-shared  ",
			"podnotes-openai-api-key": "existing-value",
		});
		const repository = new CredentialRepository(api);

		expect(repository.adoptReference("openai", "shared-api-key")).toBe(
			"podnotes-openai-api-key-2",
		);
		expect(values.get("podnotes-openai-api-key-2")).toBe("sk-shared");
		expect(api.getSecret).toHaveBeenLastCalledWith("podnotes-openai-api-key-2");
	});

	it("copies an explicitly selected cross-provider secret into the selected provider", () => {
		const { api, values } = storage({ "podnotes-deepgram-api-key": "shared-by-user" });
		const repository = new CredentialRepository(api);

		expect(repository.adoptReference("openai", "podnotes-deepgram-api-key")).toBe(
			"podnotes-openai-api-key",
		);
		expect(values.get("podnotes-openai-api-key")).toBe("shared-by-user");
	});

	it("rejects a missing explicit selection without creating a reference", () => {
		const { api, values } = storage();
		const repository = new CredentialRepository(api);

		expect(() => repository.adoptReference("openai", "missing-secret")).toThrow(
			"not available on this device",
		);
		expect(values.size).toBe(0);
	});

	it("exports only values whose referenced secrets still exist", () => {
		const { api } = storage({
			"podnotes-openai-api-key": "sk",
			"podnotes-deepgram-api-key": "   ",
		});
		const repository = new CredentialRepository(api);

		expect(
			repository.exportValues(
				settings({
					openAISecretId: "podnotes-openai-api-key",
					deepgramSecretId: "podnotes-deepgram-api-key",
				}),
			),
		).toEqual({ openAI: "sk" });
	});

	it("distinguishes unconfigured and synced-but-missing references", () => {
		const { api } = storage();
		const repository = new CredentialRepository(api);

		expect(repository.status(settings(), "openai")).toBe("unconfigured");
		expect(
			repository.status(settings({ openAISecretId: "podnotes-openai-api-key" }), "openai"),
		).toBe("missing");
	});

	it("refuses an explicit plaintext export when a configured value is missing locally", () => {
		const { api } = storage();
		const repository = new CredentialRepository(api);

		expect(() =>
			repository.exportValues(settings({ openAISecretId: "podnotes-openai-api-key" }), {
				requireConfigured: true,
			}),
		).toThrow("not available in SecretStorage on this device");
	});
});
