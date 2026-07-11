import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestUrlResponse } from "obsidian";

const nativeRequest = vi.hoisted(() => vi.fn());

vi.mock("../../utility/networkRequest", async () => {
	const actual = await vi.importActual<typeof import("../../utility/networkRequest")>(
		"../../utility/networkRequest",
	);
	const fetchJsonWithTimeout: typeof actual.fetchJsonWithTimeout = (url, options) =>
		actual.fetchJsonWithTimeout(url, { ...options, request: nativeRequest });

	return { ...actual, fetchJsonWithTimeout: vi.fn(fetchJsonWithTimeout) };
});

import { diarizeWithDeepgram } from "./deepgramProvider";
import type { DiarizationAudio } from "./types";
import { NetworkError, fetchJsonWithTimeout } from "../../utility/networkRequest";

const audio: DiarizationAudio = {
	buffer: new ArrayBuffer(8),
	mimeType: "audio/mpeg",
	extension: "mp3",
	basename: "episode",
};

function stubResponse(overrides: Partial<{ status: number; json: unknown; text: string }>) {
	const json = overrides.json ?? {};
	return {
		status: 200,
		json,
		text: overrides.text ?? JSON.stringify(json),
		arrayBuffer: new ArrayBuffer(0),
		headers: {},
		...overrides,
	} satisfies RequestUrlResponse;
}

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

async function settlesAfterMicrotasks(promise: Promise<unknown>): Promise<boolean> {
	let settled = false;
	void promise.then(
		() => {
			settled = true;
		},
		() => {
			settled = true;
		},
	);

	for (let turn = 0; turn < 10 && !settled; turn++) await Promise.resolve();
	return settled;
}

beforeEach(() => {
	nativeRequest.mockReset();
	vi.mocked(fetchJsonWithTimeout).mockClear();
});

describe("diarizeWithDeepgram (#168)", () => {
	it("posts the whole audio buffer with token auth and parses the response", async () => {
		nativeRequest.mockResolvedValue(
			stubResponse({
				json: {
					results: {
						utterances: [
							{ speaker: 0, transcript: "Hello.", start: 0, end: 1 },
							{ speaker: 1, transcript: "Hi.", start: 1, end: 2 },
						],
					},
				},
			}),
		);

		const segments = await diarizeWithDeepgram({
			audio,
			apiKey: "dg-key",
			onProgress: () => {},
		});

		expect(segments).toEqual([
			{ speaker: "1", text: "Hello.", start: 0, end: 1 },
			{ speaker: "2", text: "Hi.", start: 1, end: 2 },
		]);

		expect(fetchJsonWithTimeout).toHaveBeenCalledWith(
			expect.stringContaining("api.deepgram.com/v1/listen"),
			{
				method: "POST",
				headers: { Authorization: "Token dg-key" },
				contentType: "audio/mpeg",
				body: audio.buffer,
				timeoutMs: 30 * 60_000,
				maxRequestBodyBytes: 2 * 1024 * 1024 * 1024,
				maxResponseBytes: 16 * 1024 * 1024,
				signal: undefined,
			},
		);

		const call = nativeRequest.mock.calls[0][0];
		expect(call.method).toBe("POST");
		expect(call.url).toContain("api.deepgram.com/v1/listen");
		expect(call.url).toContain("diarize=true");
		expect(call.headers.Authorization).toBe("Token dg-key");
		expect(call.contentType).toBe("audio/mpeg");
		expect(call.body).toBe(audio.buffer);
	});

	it("reports only a safe HTTP status on a non-2xx response", async () => {
		nativeRequest.mockResolvedValue(
			stubResponse({ status: 401, json: { err_msg: "Invalid credentials" } }),
		);

		const error = await diarizeWithDeepgram({
			audio,
			apiKey: "bad",
			onProgress: () => {},
		}).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NetworkError);
		expect((error as NetworkError).status).toBe(401);
		expect(String(error)).toContain("HTTP 401");
		expect(String(error)).not.toContain("Invalid credentials");
	});

	it("redacts the API key and a native transport error", async () => {
		const marker = "private-deepgram-marker";
		nativeRequest.mockRejectedValue(new Error(`native failure with ${marker}`));

		const error = await diarizeWithDeepgram({
			audio,
			apiKey: marker,
			onProgress: () => {},
		}).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NetworkError);
		expect((error as NetworkError).code).toBe("transport-failure");
		expect(String(error)).not.toContain(marker);
		expect(String(error)).not.toContain("native failure");
	});

	it("aborts promptly and ignores a late HTTP failure from the native transport", async () => {
		const controller = new AbortController();
		const abortError = new DOMException("private lifecycle detail", "AbortError");
		const response = deferred<RequestUrlResponse>();
		nativeRequest.mockReturnValue(response.promise);
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const pending = diarizeWithDeepgram({
			audio,
			apiKey: "bad",
			onProgress: () => {},
			signal: controller.signal,
		});
		const outcome = pending.then(
			() => undefined,
			(error: unknown) => error,
		);
		await vi.waitFor(() => expect(nativeRequest).toHaveBeenCalledOnce());

		try {
			controller.abort(abortError);
			const settledPromptly = await settlesAfterMicrotasks(outcome);
			response.resolve(stubResponse({ status: 401, json: { err_msg: "late failure" } }));
			const result = await outcome;

			expect(settledPromptly).toBe(true);
			expect(result).toBeInstanceOf(NetworkError);
			expect((result as NetworkError).code).toBe("aborted");
			expect(String(result)).not.toContain(abortError.message);
			expect(consoleError).not.toHaveBeenCalled();
		} finally {
			consoleError.mockRestore();
		}
	});
});
