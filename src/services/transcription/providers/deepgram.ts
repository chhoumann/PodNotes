import { isPlainObject } from "src/persistence/codecUtils";
import type { PartTranscript, Provider, Word } from "./types";

/**
 * https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded
 *
 * The query is the released one. Deepgram now prefers `diarize_model=latest` over
 * `diarize=true`. Switch once a real key has confirmed the answer keeps its shape.
 */
export const deepgram: Provider = {
	models: [
		{
			id: "nova-3",
			label: "Nova-3",
			speakers: true,
			url: true,
			maxUploadBytes: 2_000_000_000,
		},
	],
	timeoutMs: 30 * 60_000,

	async transcribe({ apiKey, model, speakers, audio }, send) {
		return parse(
			await send({
				url: `https://api.deepgram.com/v1/listen?model=${model.id}&diarize=${speakers}&punctuate=true&smart_format=true&utterances=true`,
				headers: { Authorization: `Token ${apiKey}` },
				body: "url" in audio ? { url: audio.url } : audio.file,
			}),
		);
	},

	// Deepgram could not download the address (https://developers.deepgram.com/docs/errors).
	failure: (status, body) =>
		status === 400 && isPlainObject(body) && body.err_code === "REMOTE_CONTENT_ERROR"
			? "unfetched"
			: undefined,
};

interface Answer {
	results?: { channels?: { alternatives?: { words?: unknown }[] }[] };
}

function parse(answer: unknown): PartTranscript {
	const words = (answer as Answer | null)?.results?.channels?.[0]?.alternatives?.[0]?.words;
	if (!Array.isArray(words)) return { words: [] };
	return {
		words: words.flatMap((word: unknown): Word[] => {
			if (!isPlainObject(word)) return [];
			const text = word.punctuated_word ?? word.word;
			const { start, end, speaker } = word;
			if (typeof text !== "string" || typeof start !== "number" || typeof end !== "number") {
				return [];
			}
			return [
				{
					text,
					start,
					end,
					speaker: typeof speaker === "number" ? `${speaker}` : undefined,
				},
			];
		}),
	};
}
