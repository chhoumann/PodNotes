import type { CredentialKind } from "src/types/Credentials";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import { deepgram } from "./providers/deepgram";
import { openai } from "./providers/openai";
import type { ModelProfile, Provider } from "./providers/types";

/** A provider is keyed by the API key it needs, so one without a credential kind fails the build. */
export const PROVIDERS = { openai, deepgram } satisfies Record<CredentialKind, Provider>;

export interface TranscriptionChoice {
	readonly provider: CredentialKind;
	/** The provider's name, for buttons and notices. */
	readonly label: string;
	readonly model: ModelProfile;
	/** The settings ask for speaker labels. Whether the model has them is `model.speakers`. */
	readonly speakers: boolean;
}

/**
 * What the transcript settings choose. The only reader of the settings that pick a provider,
 * so the panel button, the key check and the run agree.
 */
export function transcriptionChoice({
	transcript,
}: Pick<IPodNotesSettings, "transcript">): TranscriptionChoice {
	const { enabled, provider: selected } = transcript.diarization;
	const provider = enabled && selected === "deepgram" ? "deepgram" : "openai";
	const { label, models } = PROVIDERS[provider];
	return { provider, label, model: models[0], speakers: enabled };
}

/** The names of the providers that label speakers. */
export function providersWithSpeakers(): string[] {
	return Object.values(PROVIDERS)
		.filter(({ models }) => models[0].speakers)
		.map(({ label }) => label);
}
