import type { SecretStorage } from "obsidian";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import type { CredentialKind, CredentialReferences, CredentialValues } from "src/types/Credentials";

export type { CredentialKind, CredentialReferences, CredentialValues } from "src/types/Credentials";

export type CredentialStatus = "unconfigured" | "available" | "missing";

const CREDENTIALS: Record<
	CredentialKind,
	{
		baseId: string;
		settingsKey: keyof Pick<IPodNotesSettings, "openAISecretId" | "deepgramSecretId">;
	}
> = {
	openai: {
		baseId: "podnotes-openai-api-key",
		settingsKey: "openAISecretId",
	},
	deepgram: {
		baseId: "podnotes-deepgram-api-key",
		settingsKey: "deepgramSecretId",
	},
};

/**
 * Narrow boundary around Obsidian's vault-local SecretStorage.
 *
 * Runtime reads fail closed and never cache secret values. Migration/import
 * writes are strict: an ID is returned only after the exact value reads back.
 */
export class CredentialRepository {
	constructor(private readonly storage: SecretStorage) {}

	get(settings: IPodNotesSettings, kind: CredentialKind): string | null {
		const id = settings[CREDENTIALS[kind].settingsKey].trim();
		if (!id) return null;

		try {
			const value = this.storage.getSecret(id);
			return value?.trim() ? value.trim() : null;
		} catch (error) {
			console.error(`PodNotes: failed to read the ${kind} credential`, error);
			return null;
		}
	}

	has(settings: IPodNotesSettings, kind: CredentialKind): boolean {
		return this.get(settings, kind) !== null;
	}

	status(settings: IPodNotesSettings, kind: CredentialKind): CredentialStatus {
		if (!settings[CREDENTIALS[kind].settingsKey].trim()) return "unconfigured";
		return this.has(settings, kind) ? "available" : "missing";
	}

	exportValues(
		settings: IPodNotesSettings,
		options: { requireConfigured?: boolean } = {},
	): CredentialValues {
		const openAI = this.get(settings, "openai");
		const deepgram = this.get(settings, "deepgram");
		if (options.requireConfigured) {
			if (settings.openAISecretId.trim() && !openAI) {
				throw new Error(
					"The selected OpenAI API key is not available in SecretStorage on this device.",
				);
			}
			if (settings.deepgramSecretId.trim() && !deepgram) {
				throw new Error(
					"The selected Deepgram API key is not available in SecretStorage on this device.",
				);
			}
		}

		return {
			...(openAI ? { openAI } : {}),
			...(deepgram ? { deepgram } : {}),
		};
	}

	/**
	 * Store values under PodNotes-owned IDs. Existing matching values are reused,
	 * making retries idempotent after a later data.json save failure. A conflicting
	 * value is never overwritten: the first free numeric suffix is used instead.
	 */
	storeValues(values: CredentialValues): CredentialReferences {
		const references: CredentialReferences = {};
		const openAI = values.openAI?.trim();
		const deepgram = values.deepgram?.trim();

		if (openAI) references.openAISecretId = this.store("openai", openAI);
		if (deepgram) references.deepgramSecretId = this.store("deepgram", deepgram);

		return references;
	}

	private store(kind: CredentialKind, secret: string): string {
		const { baseId } = CREDENTIALS[kind];

		for (let suffix = 1; suffix <= 10_000; suffix++) {
			const id = suffix === 1 ? baseId : `${baseId}-${suffix}`;
			const existing = this.storage.getSecret(id);

			if (existing === secret) return id;
			if (existing !== null) continue;

			this.storage.setSecret(id, secret);
			if (this.storage.getSecret(id) !== secret) {
				throw new Error(`SecretStorage did not retain the ${kind} credential.`);
			}
			return id;
		}

		throw new Error(`Could not allocate a SecretStorage ID for the ${kind} credential.`);
	}
}
