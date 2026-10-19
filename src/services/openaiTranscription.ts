import {
	TimeoutError,
	requestWithTimeout,
	type NetworkBinaryResponse,
} from "../utility/networkRequest";

const TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_REQUEST_BYTES = 25 * 1024 * 1024;
const MAX_SERVER_RETRY_DELAY_MS = 60 * 1000;
const EVERY_HTTP_STATUS = Array.from({ length: 500 }, (_, index) => 100 + index);

// OpenAI's responses do not allow Obsidian's origin, so the renderer's fetch
// cannot read them. requestUrl has no CORS check but cannot cancel an upload,
// so a timeout or abort only stops waiting and drops the late response.
export async function createTranscription(
	apiKey: string,
	fields: Record<string, string | File>,
	signal: AbortSignal,
): Promise<unknown> {
	const form = new FormData();
	for (const [name, value] of Object.entries(fields)) form.append(name, value);
	const multipart = new Request(TRANSCRIPTIONS_URL, { method: "POST", body: form });

	let response: NetworkBinaryResponse;
	try {
		response = await requestWithTimeout(TRANSCRIPTIONS_URL, {
			method: "POST",
			headers: { Authorization: `Bearer ${apiKey}` },
			contentType: multipart.headers.get("content-type") ?? undefined,
			body: await multipart.arrayBuffer(),
			timeoutMs: REQUEST_TIMEOUT_MS,
			maxRequestBodyBytes: MAX_REQUEST_BYTES,
			acceptedStatuses: EVERY_HTTP_STATUS,
			signal,
		});
	} catch (error) {
		if (signal.aborted) throw signal.reason;
		throw new Error(error instanceof TimeoutError ? "Request timed out." : "Connection error.");
	}

	const text = new TextDecoder().decode(response.arrayBuffer);
	if (response.status < 200 || response.status >= 300) {
		throw new OpenAIStatusError(
			`${response.status} ${errorDetail(text) || "status code (no body)"}`,
			serverRetryDelayMs(new Headers(response.headers)),
		);
	}
	return JSON.parse(text);
}

export function retryDelayMs(error: unknown, fallbackMs: number): number {
	return (error instanceof OpenAIStatusError ? error.retryAfterMs : undefined) ?? fallbackMs;
}

class OpenAIStatusError extends Error {
	constructor(
		message: string,
		readonly retryAfterMs: number | undefined,
	) {
		super(message);
	}
}

function serverRetryDelayMs(headers: Headers): number | undefined {
	let delayMs = parseFloat(headers.get("retry-after-ms") ?? "");
	const retryAfter = headers.get("retry-after");
	if (Number.isNaN(delayMs) && retryAfter) {
		const seconds = parseFloat(retryAfter);
		delayMs = Number.isNaN(seconds) ? Date.parse(retryAfter) - Date.now() : seconds * 1000;
	}
	return delayMs >= 0 && delayMs <= MAX_SERVER_RETRY_DELAY_MS ? delayMs : undefined;
}

// Mirrors openai-node's makeStatusError and APIError.makeMessage, so failure
// notices read exactly as they did when PodNotes used the SDK.
function errorDetail(body: string): string | undefined {
	let json: unknown;
	try {
		json = JSON.parse(body);
	} catch {}
	if (!json) return body;
	if (typeof json !== "object") return undefined;
	const error = "error" in json && json.error != null ? json.error : json;
	const message =
		typeof error === "object" && error !== null && "message" in error
			? error.message
			: undefined;
	if (message) return typeof message === "string" ? message : JSON.stringify(message);
	return error ? JSON.stringify(error) : undefined;
}
