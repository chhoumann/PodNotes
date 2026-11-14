import { isPlainObject } from "src/persistence/codecUtils";
import { assertFetchableUrl } from "src/utility/assertFetchableUrl";
import type { Provider } from "./types";
import { verboseJsonTimes } from "./verboseJson";

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
		try {
			const url = assertFetchableUrl(address.trim(), { privateHosts: true });
			const path = url.pathname.replace(/\/+$/, "");
			url.pathname = path.endsWith(PATH) ? path : `${path}${PATH}`;
			return url.href;
		} catch {
			return undefined;
		}
	},

	async transcribe({ apiKey, model, audio, endpoint, textOnly }, send) {
		if (!endpoint || "url" in audio) {
			throw new Error("An OpenAI-compatible server takes an uploaded file at its endpoint.");
		}
		const form = new FormData();
		form.append("model", model.id);
		form.append("file", audio.file);
		form.append("response_format", textOnly ? "json" : "verbose_json");
		if (!textOnly) {
			form.append("timestamp_granularities[]", "word");
			form.append("timestamp_granularities[]", "segment");
		}
		const answer = await send({
			url: endpoint,
			headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
			body: form,
		});
		return (
			verboseJsonTimes(answer) ?? {
				text: isPlainObject(answer) && typeof answer.text === "string" ? answer.text : "",
			}
		);
	},

	// A model without times, such as OpenAI's gpt-transcribe, refuses verbose_json with a 400
	// that names the option, and answers json, which the job asks for from then on.
	failure: (status, body) =>
		status === 400 &&
		/response_format|verbose_json|timestamp_granularities/i.test(JSON.stringify(body))
			? "format"
			: undefined,
};
