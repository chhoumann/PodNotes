import { arrayBufferToBase64 } from "obsidian";
import { isPlainObject } from "src/persistence/codecUtils";
import type { NonEmpty } from "src/services/publishedTranscript/parse";
import { fetchJsonWithTimeout } from "src/utility/networkRequest";
import type { Listing, ModelProfile, PartInput, Provider, ProviderRequest } from "./types";
import { verboseJsonTimes } from "./verboseJson";

const TRANSCRIPTIONS_URL = "https://openrouter.ai/api/v1/audio/transcriptions";
const CATALOG_URL = "https://openrouter.ai/api/v1/models?output_modalities=transcription";

/**
 * OpenRouter takes 25 MB a request and gives the model 60 s to answer. Parts of 24 MB and
 * 1,980 s were answered in 20 to 31 s, so these leave room.
 */
const PART_CAPS = { maxUploadBytes: 18_000_000, maxSeconds: 1800 };
/** Voxtral and Qwen3 ASR took 33 to 35 s to answer 20 MB, so they get smaller parts. */
const SLOW_PART_CAPS = { maxUploadBytes: 12_000_000, maxSeconds: 900 };

type Body = (input: PartInput) => Promise<ProviderRequest["body"]>;

/** The formats `input_audio.format` names, by the type of the file PodNotes sends. MP3 otherwise. */
const FORMATS: Readonly<Record<string, string>> = {
	"audio/mp4": "m4a",
	"audio/ogg": "ogg",
	"audio/wav": "wav",
	"audio/flac": "flac",
	"audio/webm": "webm",
};

/**
 * xAI reads speaker labels from its own options. A request OpenRouter routes elsewhere
 * ignores them and is answered with no speakers, so the route is pinned to xAI.
 */
const grok: Body = async ({ model, speakers, audio }) => {
	if ("url" in audio) throw new Error("Grok STT takes no audio address.");
	return {
		model: model.id,
		input_audio: {
			data: arrayBufferToBase64(await audio.file.arrayBuffer()),
			format: FORMATS[audio.file.type] ?? "mp3",
		},
		response_format: "verbose_json",
		timestamp_granularities: ["word", "segment"],
		provider: { only: ["xai"], ...(speakers && { options: { xai: { diarize: true } } }) },
	};
};

/**
 * Scribe v2, MAI-Transcribe 2 and Qwen3 ASR list words only when asked for word times or
 * speakers. The first two take `diarize` beside the model. Only Scribe v2 fetches an address.
 */
const wordTimes: Body = async ({ model, speakers, audio }) => {
	if ("url" in audio) {
		return {
			model: model.id,
			input_audio: { url: audio.url, format: "mp3" },
			response_format: "verbose_json",
			timestamp_granularities: ["word"],
			...(speakers && { diarize: true }),
		};
	}
	const form = new FormData();
	form.append("model", model.id);
	form.append("file", audio.file);
	form.append("response_format", "verbose_json");
	form.append("timestamp_granularities[]", "word");
	if (speakers) form.append("diarize", "true");
	return form;
};

/** Voxtral refuses a request for word times with a 400, and times its segments unasked. */
const segmentTimes: Body = async ({ model, audio }) => {
	if ("url" in audio) throw new Error("Voxtral takes no audio address.");
	const form = new FormData();
	form.append("model", model.id);
	form.append("file", audio.file);
	form.append("response_format", "verbose_json");
	return form;
};

const MODELS: NonEmpty<ModelProfile & { readonly body: Body }> = [
	{
		id: "x-ai/grok-stt-2.0",
		label: "Grok STT 2.0",
		speakers: true,
		url: false,
		...PART_CAPS,
		mergeSpeakers: true,
		body: grok,
	},
	{
		id: "elevenlabs/scribe-v2",
		label: "ElevenLabs Scribe v2",
		speakers: true,
		url: true,
		...PART_CAPS,
		// Its reel heard 4 voices on a show with 10.
		mergeSpeakers: false,
		body: wordTimes,
	},
	{
		id: "microsoft/mai-transcribe-2",
		label: "MAI-Transcribe 2",
		speakers: true,
		url: false,
		...PART_CAPS,
		mergeSpeakers: false,
		body: wordTimes,
	},
	{
		id: "mistralai/voxtral-mini-transcribe-3-0",
		label: "Voxtral Mini Transcribe 3",
		speakers: false,
		url: false,
		...SLOW_PART_CAPS,
		body: segmentTimes,
	},
	{
		id: "qwen/qwen3-asr-1.7b",
		label: "Qwen3 ASR 1.7B",
		speakers: false,
		url: false,
		...SLOW_PART_CAPS,
		body: wordTimes,
	},
];

/**
 * https://openrouter.ai/docs/guides/overview/multimodal/stt
 *
 * Each model asks for speaker labels its own way, and one asked the wrong way answers
 * with none, so each model has the request it was measured with.
 */
export const openrouter: Provider = {
	models: MODELS,
	timeoutMs: 10 * 60_000,

	async transcribe(input, send) {
		const model = MODELS.find(({ id }) => id === input.model.id);
		if (!model) throw new Error(`OpenRouter has no ${input.model.id} request.`);
		const answer = await send({
			url: TRANSCRIPTIONS_URL,
			headers: { Authorization: `Bearer ${input.apiKey}` },
			body: await model.body(input),
		});
		// An answer with neither words nor segments holds no speech.
		return verboseJsonTimes(answer) ?? { words: [] };
	},

	failure(status, body) {
		const message =
			isPlainObject(body) &&
			isPlainObject(body.error) &&
			typeof body.error.message === "string"
				? body.error.message
				: "";
		// A 404 also answers a model whose every route breaks the account's privacy settings,
		// such as zero data retention: "... matching your guardrail restrictions and data policy".
		if (status === 404 && /data policy|zero data retention|\bzdr\b/i.test(message)) {
			return "privacy";
		}
		if (status === 400 && /could not download input_audio\.url/i.test(message))
			return "unfetched";
		return undefined;
	},

	async catalog() {
		const answer = await fetchJsonWithTimeout<unknown>(CATALOG_URL, { timeoutMs: 15_000 });
		const entries = isPlainObject(answer) ? answer.data : undefined;
		if (!Array.isArray(entries)) throw new Error("OpenRouter's catalog lists no models.");
		const listing: Map<string, string | undefined> = new Map();
		for (const entry of entries) {
			if (!isPlainObject(entry) || typeof entry.id !== "string") continue;
			const ends = entry.expiration_date;
			listing.set(entry.id, typeof ends === "string" ? ends.slice(0, 10) : undefined);
		}
		return listing satisfies Listing;
	},
};
