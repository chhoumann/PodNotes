import { arrayBufferToBase64 } from "obsidian";
import { isPlainObject } from "src/persistence/codecUtils";
import type { NonEmpty } from "src/services/publishedTranscript/parse";
import type {
	ModelProfile,
	PartInput,
	PartTranscript,
	Provider,
	ProviderRequest,
	Word,
} from "./types";

const TRANSCRIPTIONS_URL = "https://openrouter.ai/api/v1/audio/transcriptions";

/**
 * OpenRouter takes 25 MB a request and gives the model 60 s to answer. Parts of 24 MB and
 * 1,980 s were answered in 20 to 31 s, so these leave room.
 */
const PART_CAPS = { maxUploadBytes: 18_000_000, maxSeconds: 1800 };

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

/** Scribe v2 and MAI-Transcribe 2 take `diarize` beside the model. Only Scribe v2 fetches an address. */
const topLevelDiarize: Body = async ({ model, speakers, audio }) => {
	if ("url" in audio) {
		return {
			model: model.id,
			input_audio: { url: audio.url, format: "mp3" },
			response_format: "verbose_json",
			...(speakers && { diarize: true }),
		};
	}
	const form = new FormData();
	form.append("model", model.id);
	form.append("file", audio.file);
	form.append("response_format", "verbose_json");
	if (speakers) form.append("diarize", "true");
	return form;
};

const MODELS: NonEmpty<ModelProfile & { readonly body: Body }> = [
	{
		id: "x-ai/grok-stt-2.0",
		label: "Grok STT 2.0",
		speakers: true,
		url: false,
		...PART_CAPS,
		body: grok,
	},
	{
		id: "elevenlabs/scribe-v2",
		label: "ElevenLabs Scribe v2",
		speakers: true,
		url: true,
		...PART_CAPS,
		body: topLevelDiarize,
	},
	{
		id: "microsoft/mai-transcribe-2",
		label: "MAI-Transcribe 2",
		speakers: true,
		url: false,
		...PART_CAPS,
		body: topLevelDiarize,
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
		return parse(
			await send({
				url: TRANSCRIPTIONS_URL,
				headers: { Authorization: `Bearer ${input.apiKey}` },
				body: await model.body(input),
			}),
		);
	},

	// A 404 also answers a model whose every route breaks the account's privacy settings,
	// such as zero data retention: "No endpoints found matching your data policy".
	failure: (status, body) =>
		status === 404 &&
		isPlainObject(body) &&
		isPlainObject(body.error) &&
		typeof body.error.message === "string" &&
		/data policy|zero data retention|\bzdr\b/i.test(body.error.message)
			? "privacy"
			: undefined,
};

function parse(answer: unknown): PartTranscript {
	const words = isPlainObject(answer) ? answer.words : undefined;
	if (!Array.isArray(words)) return { words: [] };
	return {
		words: words.flatMap((item: unknown): Word[] => {
			// Scribe v2 also lists sounds, such as "[gentle music]", as `audio_event` items.
			if (!isPlainObject(item) || (item.type ?? "word") !== "word") return [];
			const { word: text, start, end, speaker } = item;
			if (typeof text !== "string" || typeof start !== "number" || typeof end !== "number") {
				return [];
			}
			return [
				{
					text,
					start,
					end,
					speaker:
						typeof speaker === "number" || typeof speaker === "string"
							? `${speaker}`
							: undefined,
				},
			];
		}),
	};
}
