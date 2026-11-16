/**
 * One row per API key PodNotes can hold. Released versions store a kind's key
 * under `podnotes-<kind>-api-key` and read its settingsKey and exportKey from
 * synced data and export files, so none of them may change.
 */
export const CREDENTIALS = {
	openai: { settingsKey: "openAISecretId", exportKey: "openAI", label: "OpenAI" },
	deepgram: { settingsKey: "deepgramSecretId", exportKey: "deepgram", label: "Deepgram" },
	elevenlabs: { settingsKey: "elevenLabsSecretId", exportKey: "elevenLabs", label: "ElevenLabs" },
	openrouter: { settingsKey: "openRouterSecretId", exportKey: "openRouter", label: "OpenRouter" },
} as const;

export type CredentialKind = keyof typeof CREDENTIALS;
export const CREDENTIAL_KINDS = Object.keys(CREDENTIALS) as readonly CredentialKind[];

type Credential = (typeof CREDENTIALS)[CredentialKind];
export type CredentialSettingsKey = Credential["settingsKey"];

/** Plaintext keys, as a settings export carries them under `secrets`. */
export type CredentialValues = Partial<Record<Credential["exportKey"], string>>;

export type CredentialReferences = Partial<Record<CredentialSettingsKey, string>>;

/** SecretStorage IDs of the API keys. They never contain a key itself. */
export type CredentialReferenceSettings = Record<CredentialSettingsKey, string>;

/** Obsidian SecretStorage IDs are lowercase alphanumeric strings with dashes. */
export function isValidSecretId(value: string): boolean {
	return /^(?=.*[a-z0-9])[a-z0-9-]+$/.test(value);
}

export function secretBaseId(kind: CredentialKind): string {
	return `podnotes-${kind}-api-key`;
}

/**
 * Persisted references are capabilities, not arbitrary SecretStorage lookups.
 * Keep each provider confined to the IDs PodNotes owns for that provider.
 */
export function isPodNotesSecretId(kind: CredentialKind, value: string): boolean {
	return new RegExp(`^${secretBaseId(kind)}(?:-[1-9]\\d*)?$`).test(value);
}
