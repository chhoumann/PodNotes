export type CredentialKind = "openai" | "deepgram";

export interface CredentialValues {
	openAI?: string;
	deepgram?: string;
}

export interface CredentialReferences {
	openAISecretId?: string;
	deepgramSecretId?: string;
}

/** Obsidian SecretStorage IDs are lowercase alphanumeric strings with dashes. */
export function isValidSecretId(value: string): boolean {
	return /^(?=.*[a-z0-9])[a-z0-9-]+$/.test(value);
}

const PODNOTES_SECRET_ID_PATTERNS: Record<CredentialKind, RegExp> = {
	openai: /^podnotes-openai-api-key(?:-[1-9]\d*)?$/,
	deepgram: /^podnotes-deepgram-api-key(?:-[1-9]\d*)?$/,
};

/**
 * Persisted references are capabilities, not arbitrary SecretStorage lookups.
 * Keep each provider confined to the IDs PodNotes owns for that provider.
 */
export function isPodNotesSecretId(kind: CredentialKind, value: string): boolean {
	return PODNOTES_SECRET_ID_PATTERNS[kind].test(value);
}
