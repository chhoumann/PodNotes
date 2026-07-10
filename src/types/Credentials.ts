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
