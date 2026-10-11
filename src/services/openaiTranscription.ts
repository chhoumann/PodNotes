const TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_SERVER_RETRY_DELAY_MS = 60 * 1000;

export async function createTranscription(
	apiKey: string,
	fields: Record<string, string | File>,
	signal: AbortSignal,
): Promise<unknown> {
	const body = new FormData();
	for (const [name, value] of Object.entries(fields)) body.append(name, value);

	const controller = new AbortController();
	const forwardAbort = () => controller.abort(signal.reason);
	signal.addEventListener("abort", forwardAbort, { once: true });
	if (signal.aborted) forwardAbort();
	let timedOut = false;
	const timeout = window.setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, REQUEST_TIMEOUT_MS);

	try {
		let response: Response;
		let text: string;
		try {
			// oxlint-disable-next-line no-restricted-globals -- requestUrl cannot cancel an in-flight upload.
			response = await fetch(TRANSCRIPTIONS_URL, {
				method: "POST",
				headers: { Authorization: `Bearer ${apiKey}` },
				body,
				signal: controller.signal,
			});
			text = await response.text();
		} catch (error) {
			if (signal.aborted) throw signal.reason;
			const mentionsTimeout = /timed? ?out/i.test(String(error));
			throw new Error(
				timedOut || mentionsTimeout ? "Request timed out." : "Connection error.",
			);
		}

		if (!response.ok) {
			throw new OpenAIStatusError(
				`${response.status} ${errorDetail(text) || "status code (no body)"}`,
				serverRetryDelayMs(response.headers),
			);
		}
		return JSON.parse(text);
	} finally {
		window.clearTimeout(timeout);
		signal.removeEventListener("abort", forwardAbort);
	}
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
