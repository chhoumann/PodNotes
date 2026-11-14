import { isPlainObject } from "src/persistence/codecUtils";
import { isFetchableUrl } from "src/utility/assertFetchableUrl";
import { TranscriptionError } from "../http";
import type { PartTranscript, Provider, Word } from "./types";

const PATH = "/audio/transcriptions";

/**
 * A server that speaks https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create,
 * such as whisper.cpp, faster-whisper, speaches, Groq or Together, at the address the user
 * enters. It labels no speakers, and an upload goes in parts of 24 MB, under the 25 MB most
 * of them take.
 */
export const openaiCompatible: Provider = {
	models: [{ id: "", label: "", speakers: false, url: false, maxUploadBytes: 24_000_000 }],
	timeoutMs: 10 * 60_000,

	endpoint(address) {
		const base = address.trim().replace(/\/+$/, "");
		const endpoint = base.endsWith(PATH) ? base : `${base}${PATH}`;
		return isFetchableUrl(endpoint, { privateHosts: true }) ? endpoint : undefined;
	},

	async transcribe({ apiKey, model, audio, endpoint }, send) {
		if (!endpoint || "url" in audio) {
			throw new Error("An OpenAI-compatible server takes an uploaded file at its endpoint.");
		}
		const request = (timed: boolean) => {
			const form = new FormData();
			form.append("model", model.id);
			form.append("file", audio.file);
			form.append("response_format", timed ? "verbose_json" : "json");
			if (timed) {
				form.append("timestamp_granularities[]", "word");
				form.append("timestamp_granularities[]", "segment");
			}
			return send({
				url: endpoint,
				headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
				body: form,
			});
		};
		try {
			return readTranscription(await request(true));
		} catch (error) {
			if (!(error instanceof TranscriptionError) || error.kind !== "format") throw error;
			return readTranscription(await request(false));
		}
	},

	// A model without times, such as OpenAI's gpt-transcribe, refuses verbose_json with a 400
	// that names the option, and answers json.
	failure: (status, body) =>
		status === 400 &&
		/response_format|verbose_json|timestamp_granularities/i.test(JSON.stringify(body))
			? "format"
			: undefined,
};

/**
 * An answer in OpenAI's transcription shapes: verbose_json's words, or its segments when it
 * has no words, or the text of json.
 */
function readTranscription(answer: unknown): PartTranscript {
	if (!isPlainObject(answer)) return { text: "" };
	const words = timed(answer.words, "word");
	if (words.length > 0) return { words };
	const segments = timed(answer.segments, "text");
	if (segments.length > 0) return { words: segments };
	return { text: typeof answer.text === "string" ? answer.text : "" };
}

function timed(items: unknown, textKey: "word" | "text"): Word[] {
	if (!Array.isArray(items)) return [];
	return items.flatMap((item: unknown): Word[] => {
		if (!isPlainObject(item)) return [];
		const { [textKey]: text, start, end } = item;
		return typeof text === "string" && typeof start === "number" && typeof end === "number"
			? [{ text, start, end }]
			: [];
	});
}
