import { isPlainObject } from "src/persistence/codecUtils";
import type { Provider } from "./types";

/**
 * https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create
 *
 * gpt-transcribe answers with text only, so an OpenAI transcript has no timestamps and no
 * speaker labels. OpenAI shuts down its other transcription models on 2027-02-26.
 */
export const openai: Provider = {
	models: [
		{
			id: "gpt-transcribe",
			label: "GPT Transcribe",
			speakers: false,
			url: false,
			// OpenAI's limit is 25 MB a request.
			maxUploadBytes: 24_000_000,
			// OpenAI states no length limit, so this is the longest request measured to work.
			maxSeconds: 2070,
		},
	],
	timeoutMs: 10 * 60_000,

	async transcribe({ apiKey, model, audio }, send) {
		if ("url" in audio) throw new Error("OpenAI takes no audio address.");
		const form = new FormData();
		form.append("model", model.id);
		form.append("file", audio.file);
		form.append("response_format", "json");
		const answer = await send({
			url: "https://api.openai.com/v1/audio/transcriptions",
			headers: { Authorization: `Bearer ${apiKey}` },
			body: form,
		});
		return {
			text: isPlainObject(answer) && typeof answer.text === "string" ? answer.text : "",
		};
	},

	// A used-up quota answers 429 like a rate limit, but waiting does not cure it.
	failure: (status, body) =>
		status === 429 &&
		isPlainObject(body) &&
		isPlainObject(body.error) &&
		body.error.code === "insufficient_quota"
			? "credits"
			: undefined,
};
