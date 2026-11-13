import { isOption } from "src/persistence/codecUtils";
import { CREDENTIALS, type CredentialKind } from "src/types/Credentials";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import { deepgram } from "./providers/deepgram";
import { elevenlabs } from "./providers/elevenlabs";
import { openai } from "./providers/openai";
import type { ModelProfile, Provider } from "./providers/types";

/**
 * In the order the settings offer them. A provider is keyed by the API key it needs, so
 * one without a credential kind fails the build. Its name is that key's.
 */
export const PROVIDERS = {
	elevenlabs,
	deepgram,
	openai,
} satisfies Record<CredentialKind, Provider>;

const PROVIDER_IDS = Object.keys(PROVIDERS) as CredentialKind[];

/** Each provider's name by its ID, in the order the settings offer them. */
export const PROVIDER_LABELS = Object.fromEntries(
	PROVIDER_IDS.map((id) => [id, CREDENTIALS[id].label]),
) as Readonly<Record<CredentialKind, string>>;

/** A provider and a model this version can run. */
export interface ProviderChoice {
	readonly provider: CredentialKind;
	/** The provider's name, for buttons and notices. */
	readonly label: string;
	/** The stored model, or the provider's first when none is stored or `unknownModel` is. */
	readonly model: ModelProfile;
	/** The stored model ID, when this version has no such model. */
	readonly unknownModel?: string;
	/** The settings ask for speaker labels. Whether the model has them is `model.speakers`. */
	readonly speakers: boolean;
}

/** A provider a newer PodNotes stored. This version keeps the setting and cannot run it. */
export interface UnknownProviderChoice {
	readonly provider: undefined;
	/** The provider's ID as stored. */
	readonly label: string;
	readonly speakers: boolean;
}

export type TranscriptionChoice = ProviderChoice | UnknownProviderChoice;

/**
 * What the transcript settings choose. The only reader of the settings that pick a
 * provider, a model and speaker labels, so the panel button, the key check, the settings
 * rows and the run agree.
 */
export function transcriptionChoice({
	transcript,
}: Pick<IPodNotesSettings, "transcript">): TranscriptionChoice {
	const { provider, model: stored, diarization } = transcript;
	const speakers = diarization.enabled;
	if (!isOption(PROVIDERS, provider)) return { provider: undefined, label: provider, speakers };
	const models = offeredModels(provider);
	const model = models.find(({ id }) => id === stored);
	return {
		provider,
		label: PROVIDER_LABELS[provider],
		model: model ?? models[0],
		unknownModel: model || !stored ? undefined : stored,
		speakers,
	};
}

/** The models the settings offer for a provider, best first. The first is the recommended one. */
export function offeredModels(provider: CredentialKind): Provider["models"] {
	return PROVIDERS[provider].models;
}

/** The names of the providers whose recommended model labels speakers. */
export function providersWithSpeakers(): string[] {
	return PROVIDER_IDS.filter((id) => offeredModels(id)[0].speakers).map(
		(id) => PROVIDER_LABELS[id],
	);
}
