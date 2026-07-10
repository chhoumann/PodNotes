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
		const { api } = storage({ token: "  sk-runtime  " });
		const repository = new CredentialRepository(api);
		const configured = settings({ openAISecretId: "token" });

		expect(repository.get(configured, "openai")).toBe("sk-runtime");
		expect(repository.has(configured, "openai")).toBe(true);
		expect(repository.get(settings(), "openai")).toBeNull();

		(api.getSecret as ReturnType<typeof vi.fn>).mockImplementation(() => {
			throw new Error("storage unavailable");
		});
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		expect(repository.get(configured, "openai")).toBeNull();
	});

	it("exports only values whose referenced secrets still exist", () => {
		const { api } = storage({ openai: "sk", deepgram: "   " });
		const repository = new CredentialRepository(api);

		expect(
			repository.exportValues(
				settings({ openAISecretId: "openai", deepgramSecretId: "deepgram" }),
			),
		).toEqual({ openAI: "sk" });
	});

	it("distinguishes unconfigured and synced-but-missing references", () => {
		const { api } = storage();
		const repository = new CredentialRepository(api);

		expect(repository.status(settings(), "openai")).toBe("unconfigured");
		expect(repository.status(settings({ openAISecretId: "missing" }), "openai")).toBe(
			"missing",
		);
	});

	it("refuses an explicit plaintext export when a configured value is missing locally", () => {
		const { api } = storage();
		const repository = new CredentialRepository(api);

		expect(() =>
			repository.exportValues(settings({ openAISecretId: "synced-reference" }), {
				requireConfigured: true,
			}),
		).toThrow("not available in SecretStorage on this device");
	});
});
