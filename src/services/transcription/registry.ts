import { get, writable } from "svelte/store";
import { isOption } from "src/persistence/codecUtils";
import { isNonEmpty, type NonEmpty } from "src/services/publishedTranscript/parse";
import { CREDENTIALS, type CredentialKind } from "src/types/Credentials";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import { deepgram } from "./providers/deepgram";
import { elevenlabs } from "./providers/elevenlabs";
import { openai } from "./providers/openai";
import { openrouter } from "./providers/openrouter";
import type { Listing, ModelProfile, Provider } from "./providers/types";

/**
 * In the order the settings offer them. A provider is keyed by the API key it needs, so
 * one without a credential kind fails the build. Its name is that key's.
 */
export const PROVIDERS = {
	elevenlabs,
	deepgram,
	openrouter,
	openai,
} satisfies Record<CredentialKind, Provider>;

const PROVIDER_IDS = Object.keys(PROVIDERS) as CredentialKind[];

/** Each provider's name by its ID, in the order the settings offer them. */
export const PROVIDER_LABELS = Object.fromEntries(
	PROVIDER_IDS.map((id) => [id, CREDENTIALS[id].label]),
) as Readonly<Record<CredentialKind, string>>;

/** A model the settings offer, with the day its provider stops serving it when one is announced. */
export interface OfferedModel extends ModelProfile {
	readonly ends?: string;
}

/** A provider and a model this version can run. */
export interface ProviderChoice {
	readonly provider: CredentialKind;
	/** The provider's name, for buttons and notices. */
	readonly label: string;
	/** The stored model, or the first offered when none is stored or the stored one cannot run. */
	readonly model: OfferedModel;
	/** The stored model ID, when this version has no such model. */
	readonly unknownModel?: string;
	/** The stored model, when the provider's catalog no longer offers it. */
	readonly withdrawnModel?: ModelProfile;
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
	const withdrawn = model
		? undefined
		: PROVIDERS[provider].models.find(({ id }) => id === stored);
	return {
		provider,
		label: PROVIDER_LABELS[provider],
		model: model ?? models[0],
		unknownModel: model || withdrawn || !stored ? undefined : stored,
		withdrawnModel: withdrawn,
		speakers,
	};
}

/**
 * The models the settings offer for a provider, best first. The first is the recommended
 * one. A provider's catalog only takes models away: those it does not list, and those whose
 * end date has come. A catalog that would take every model away is not followed.
 */
export function offeredModels(provider: CredentialKind): NonEmpty<OfferedModel> {
	const { models } = PROVIDERS[provider];
	const listing = get(catalogs).get(provider)?.listing;
	if (!listing) return models;
	const today = new Date().toISOString().slice(0, 10);
	const offered = models.flatMap((model): OfferedModel[] => {
		if (!listing.has(model.id)) return [];
		const ends = listing.get(model.id);
		if (ends === undefined) return [model];
		return ends > today ? [{ ...model, ends }] : [];
	});
	return isNonEmpty(offered) ? offered : models;
}

/** The names of the providers whose recommended model labels speakers. */
export function providersWithSpeakers(): string[] {
	return PROVIDER_IDS.filter((id) => offeredModels(id)[0].speakers).map(
		(id) => PROVIDER_LABELS[id],
	);
}

const CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The last catalog read of each provider that has a catalog, in memory only. A failed read
 * is not kept, so the next one asks again.
 */
export const catalogs = writable<ReadonlyMap<CredentialKind, { at: number; listing: Listing }>>(
	new Map(),
);

const reading = new Map<CredentialKind, Promise<void>>();

/**
 * Reads the provider's catalog when it has one and the last read is missing or a day old.
 * Resolves once the read is done, whether or not it worked.
 */
export function refreshModels(storedProvider: string): Promise<void> {
	if (!isOption(PROVIDERS, storedProvider)) return Promise.resolve();
	const provider: CredentialKind = storedProvider;
	const source: Provider = PROVIDERS[provider];
	const last = get(catalogs).get(provider);
	if (!source.catalog || (last && Date.now() - last.at < CATALOG_MAX_AGE_MS)) {
		return Promise.resolve();
	}
	let pending = reading.get(provider);
	if (!pending) {
		pending = source
			.catalog()
			.then(
				(listing) =>
					catalogs.update((read) =>
						new Map(read).set(provider, { at: Date.now(), listing }),
					),
				() => {},
			)
			.finally(() => reading.delete(provider));
		reading.set(provider, pending);
	}
	return pending;
}
