import { isPlainObject } from "src/persistence/codecUtils";
import type { PartTranscript, Provider, Word } from "./types";

const UNFETCHED_MESSAGE = "Failed to download the file from the provided URL";

/**
 * https://elevenlabs.io/docs/api-reference/speech-to-text/convert
 *
 * One request carries a whole episode: ElevenLabs takes 5 GB and 15 hours of audio.
 */
export const elevenlabs: Provider = {
	models: [
		{
			id: "scribe_v3",
			label: "Scribe v3",
			speakers: true,
			url: true,
			maxUploadBytes: 5_000_000_000,
			maxSeconds: 15 * 60 * 60,
		},
	],
	// An episode of 54 minutes is answered in about 30 s, but an address ElevenLabs cannot
	// resolve gets no answer for over a minute.
	timeoutMs: 10 * 60_000,

	async transcribe({ apiKey, model, speakers, audio }, send) {
		const form = new FormData();
		form.append("model_id", model.id);
		form.append("diarize", `${speakers}`);
		form.append("timestamps_granularity", "word");
		// Otherwise sounds such as "(laughter)" are transcribed as words.
		form.append("tag_audio_events", "false");
		if ("url" in audio) form.append("source_url", audio.url);
		else form.append("file", audio.file);
		return parse(
			await send({
				url: "https://api.elevenlabs.io/v1/speech-to-text",
				headers: { "xi-api-key": apiKey },
				body: form,
			}),
		);
	},

	// ElevenLabs answers 401 for a used-up quota as for a rejected key, and 400 for a model
	// the key may not use as for an address it could not download.
	failure(status, body) {
		const detail = isPlainObject(body) && isPlainObject(body.detail) ? body.detail : {};
		if (status === 401 && detail.code === "quota_exceeded") return "credits";
		if (status !== 400) return undefined;
		if (detail.code === "unsupported_model") return "model-unavailable";
		return detail.code === "bad_request" &&
			typeof detail.message === "string" &&
			detail.message.startsWith(UNFETCHED_MESSAGE)
			? "unfetched"
			: undefined;
	},
};

function parse(answer: unknown): PartTranscript {
	const words = isPlainObject(answer) ? answer.words : undefined;
	if (!Array.isArray(words)) return { words: [] };
	return {
		words: words.flatMap((word: unknown): Word[] => {
			// The other types, `spacing` and `audio_event`, are not speech.
			if (!isPlainObject(word) || word.type !== "word") return [];
			const { text, start, end, speaker_id: speaker } = word;
			if (typeof text !== "string" || typeof start !== "number" || typeof end !== "number") {
				return [];
			}
			return [
				{ text, start, end, speaker: typeof speaker === "string" ? speaker : undefined },
			];
		}),
	};
}
