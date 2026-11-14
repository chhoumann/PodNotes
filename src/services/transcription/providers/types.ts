import type { NonEmpty } from "src/services/publishedTranscript/parse";
import type { PublicAudioUrl } from "../audioSource";
import type { FailureKind } from "../http";

/** A model PodNotes has a tested request for, with what that request can carry. */
export interface ModelProfile {
	/** The ID the provider's API takes. */
	readonly id: string;
	/** The name the settings show. */
	readonly label: string;
	/** Labels who spoke. */
	readonly speakers: boolean;
	/** Fetches a public address itself, so PodNotes uploads nothing. */
	readonly url: boolean;
	/** The largest file one request may carry. */
	readonly maxUploadBytes: number;
	/** The most audio, in seconds, one request may carry. */
	readonly maxSeconds?: number;
}

export interface Word {
	readonly text: string;
	/** Seconds from the start of the audio this request carried. */
	readonly start: number;
	readonly end: number;
	/** The provider's label for who spoke. Labels from two requests are unrelated. */
	readonly speaker?: string;
}

/** What one request gave back: timed words, or text from a model that returns no times. */
export type PartTranscript = { readonly words: readonly Word[] } | { readonly text: string };

export type AudioInput = { readonly url: PublicAudioUrl } | { readonly file: File };

export interface PartInput {
	readonly apiKey: string;
	readonly model: ModelProfile;
	/** Label who spoke. Only ever true for a model whose profile says `speakers`. */
	readonly speakers: boolean;
	/** A `url` only for a model whose profile says `url`. */
	readonly audio: AudioInput;
}

export interface ProviderRequest {
	readonly url: string;
	readonly headers: Readonly<Record<string, string>>;
	/** FormData goes out as multipart, a File as its bytes with its type, anything else as JSON. */
	readonly body: FormData | File | Readonly<Record<string, unknown>>;
}

/** POSTs one request and resolves with the JSON of a 2xx answer. Rejects with a TranscriptionError. */
export type Send = (request: ProviderRequest) => Promise<unknown>;

/** The models a provider's live catalog lists, by ID, each with the day it ends (`YYYY-MM-DD`) if it has one. */
export type Listing = ReadonlyMap<string, string | undefined>;

/** Everything that is one provider's own: its models, its request and how to read its answers. */
export interface Provider {
	/** Best first. The first is the one PodNotes recommends. */
	readonly models: NonEmpty<ModelProfile>;
	/** How long PodNotes waits for one answer. */
	readonly timeoutMs: number;
	transcribe(input: PartInput, send: Send): Promise<PartTranscript>;
	/** What a failed answer means here, when the status alone does not say. `body` is the answer's JSON. */
	failure?(status: number, body: unknown): FailureKind | undefined;
	/** Reads which models the provider still serves. Rejects when it cannot tell. */
	catalog?(): Promise<Listing>;
}
