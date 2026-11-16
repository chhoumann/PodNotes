import { requestWithTimeout, TimeoutError } from "src/utility/networkRequest";
import type { Provider, ProviderRequest, Send } from "./providers/types";

/** Why a transcription failed, as the user can act on it. */
export type FailureKind =
	| "auth"
	| "credits"
	| "model-unavailable"
	| "rejected"
	| "unfetched"
	| "rate-limited"
	| "server"
	| "network"
	| "timeout"
	| "empty";

export class TranscriptionError extends Error {
	constructor(
		readonly kind: FailureKind,
		message: string,
		/** How long the server asked to wait before another send. */
		readonly retryAfterMs?: number,
	) {
		super(message);
		this.name = "TranscriptionError";
	}
}

/** What a failure sentence names. */
export interface FailureContext {
	readonly provider: string;
	readonly model: string;
	readonly timeoutMs: number;
}

/**
 * The sentence the user reads for each failure. PodNotes writes all of them: a provider's
 * own error text can quote the address it was sent, so it is never shown or logged.
 */
const SENTENCES: Record<FailureKind, (context: FailureContext, status?: number) => string> = {
	auth: ({ provider }) =>
		`${provider} rejected the API key. Check it in the transcript settings.`,
	credits: ({ provider }) =>
		`Your ${provider} account is out of credit. Add credit there, then try again.`,
	"model-unavailable": ({ provider, model }) =>
		`${provider} does not offer the ${model} model to this API key.`,
	rejected: ({ provider }) => `${provider} could not transcribe this audio.`,
	unfetched: ({ provider }) => `${provider} could not fetch the episode.`,
	"rate-limited": ({ provider }) =>
		`${provider} is limiting how fast your key may be used. Try again in a few minutes.`,
	server: ({ provider }, status) => `${provider} failed (HTTP ${status}). Try again later.`,
	network: ({ provider }) => `Could not reach ${provider}. Check your connection.`,
	timeout: ({ provider, timeoutMs }) =>
		`${provider} did not answer within ${timeoutMs / 60_000} minutes.`,
	empty: ({ provider }) => `${provider} found no speech in this episode.`,
};

export function failure(
	kind: FailureKind,
	context: FailureContext,
	status?: number,
	retryAfterMs?: number,
): TranscriptionError {
	return new TranscriptionError(kind, SENTENCES[kind](context, status), retryAfterMs);
}

/** The failures another send can get past. */
const RETRIED: ReadonlySet<FailureKind> = new Set(["rate-limited", "server", "network"]);
const MAX_SENDS = 3;
const MAX_SERVER_RETRY_DELAY_MS = 60_000;
const EVERY_HTTP_STATUS = Array.from({ length: 500 }, (_, index) => 100 + index);

function kindOf(status: number): FailureKind {
	if (status === 401 || status === 403) return "auth";
	if (status === 402) return "credits";
	if (status === 404) return "model-unavailable";
	if (status === 429) return "rate-limited";
	if (status === 408 || status === 409 || status >= 500) return "server";
	return "rejected";
}

/**
 * A request goes out at most three times, and only again after a failure another send can
 * get past. A timeout is not one: Obsidian's requestUrl cannot cancel, so the provider may
 * still be working, and a second send would be billed too. Neither is an answer that asks
 * to wait over a minute, because a sooner send would only upload the audio to be refused.
 * requestUrl is used because providers do not allow Obsidian's origin, which rules out `fetch`.
 */
export function createSender(
	readFailure: Provider["failure"],
	context: FailureContext,
	signal: AbortSignal,
): Send {
	const sendOnce = async (request: ProviderRequest): Promise<unknown> => {
		const { body, contentType } = await encode(request);
		let response;
		try {
			response = await requestWithTimeout(request.url, {
				method: "POST",
				headers: request.headers,
				contentType,
				body,
				timeoutMs: context.timeoutMs,
				maxRequestBodyBytes: body.byteLength,
				acceptedStatuses: EVERY_HTTP_STATUS,
				signal,
			});
		} catch (error) {
			if (signal.aborted) throw signal.reason;
			throw failure(error instanceof TimeoutError ? "timeout" : "network", context);
		}

		const { status } = response;
		const answered = status >= 200 && status < 300;
		let json: unknown;
		try {
			json = JSON.parse(new TextDecoder().decode(response.arrayBuffer));
		} catch {
			if (answered) throw failure("server", context, status);
		}
		if (answered) return json;
		throw failure(
			readFailure?.(status, json) ?? kindOf(status),
			context,
			status,
			serverRetryDelayMs(new Headers(response.headers)),
		);
	};

	return async (request) => {
		for (let sends = 1; ; sends++) {
			try {
				return await sendOnce(request);
			} catch (error) {
				const again =
					error instanceof TranscriptionError &&
					RETRIED.has(error.kind) &&
					sends < MAX_SENDS &&
					(error.retryAfterMs ?? 0) <= MAX_SERVER_RETRY_DELAY_MS;
				if (!again) throw error;
				await wait(error.retryAfterMs ?? 1000 * sends, signal);
			}
		}
	};
}

async function encode({
	url,
	body,
}: ProviderRequest): Promise<{ body: ArrayBuffer; contentType: string | undefined }> {
	if (body instanceof File) return { body: await body.arrayBuffer(), contentType: body.type };
	if (body instanceof FormData) {
		// The platform writes the multipart body and picks its boundary.
		const multipart = new Request(url, { method: "POST", body });
		return {
			body: await multipart.arrayBuffer(),
			contentType: multipart.headers.get("content-type") ?? undefined,
		};
	}
	return {
		body: new TextEncoder().encode(JSON.stringify(body)).buffer,
		contentType: "application/json",
	};
}

/** How long the server's `Retry-After` asks to wait. */
function serverRetryDelayMs(headers: Headers): number | undefined {
	let delayMs = parseFloat(headers.get("retry-after-ms") ?? "");
	const retryAfter = headers.get("retry-after");
	if (Number.isNaN(delayMs) && retryAfter) {
		const seconds = parseFloat(retryAfter);
		delayMs = Number.isNaN(seconds) ? Date.parse(retryAfter) - Date.now() : seconds * 1000;
	}
	return delayMs >= 0 ? delayMs : undefined;
}

function wait(delayMs: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			window.clearTimeout(timeout);
			reject(signal.reason);
		};
		const timeout = window.setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, delayMs);
		signal.addEventListener("abort", onAbort, { once: true });
		if (signal.aborted) onAbort();
	});
}
