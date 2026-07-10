import { describe, expect, it, vi } from "vitest";
import { diarizeWithDeepgram, type RequestUrlFn } from "./deepgramProvider";
import type { DiarizationAudio } from "./types";

const audio: DiarizationAudio = {
	buffer: new ArrayBuffer(8),
	mimeType: "audio/mpeg",
	extension: "mp3",
	basename: "episode",
};

function stubResponse(overrides: Partial<{ status: number; json: unknown; text: string }>) {
	return {
		status: 200,
		json: {},
		text: "",
		arrayBuffer: new ArrayBuffer(0),
		headers: {},
		...overrides,
	} as unknown as Awaited<ReturnType<RequestUrlFn>>;
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

describe("diarizeWithDeepgram (#168)", () => {
	it("posts the whole audio buffer with token auth and parses the response", async () => {
		const request = vi.fn<RequestUrlFn>().mockResolvedValue(
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
			request,
		});

		expect(segments).toEqual([
			{ speaker: "1", text: "Hello.", start: 0, end: 1 },
			{ speaker: "2", text: "Hi.", start: 1, end: 2 },
		]);

		const call = request.mock.calls[0][0];
		expect(call.method).toBe("POST");
		expect(call.url).toContain("api.deepgram.com/v1/listen");
		expect(call.url).toContain("diarize=true");
		expect(call.headers.Authorization).toBe("Token dg-key");
		expect(call.contentType).toBe("audio/mpeg");
		expect(call.body).toBe(audio.buffer);
	});

	it("throws a helpful error on a non-2xx response", async () => {
		const request = vi
			.fn<RequestUrlFn>()
			.mockResolvedValue(
				stubResponse({ status: 401, json: { err_msg: "Invalid credentials" } }),
			);

		await expect(
			diarizeWithDeepgram({
				audio,
				apiKey: "bad",
				onProgress: () => {},
				request,
			}),
		).rejects.toThrow(/HTTP 401.*Invalid credentials/);
	});

	it("aborts promptly and ignores a late HTTP failure from requestUrl", async () => {
		const controller = new AbortController();
		const abortError = new DOMException("plugin unloaded", "AbortError");
		const response = deferred<Awaited<ReturnType<RequestUrlFn>>>();
		const request = vi.fn<RequestUrlFn>().mockReturnValue(response.promise);
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const pending = diarizeWithDeepgram({
			audio,
			apiKey: "bad",
			onProgress: () => {},
			request,
			signal: controller.signal,
		});
		const outcome = pending.then(
			() => undefined,
			(error: unknown) => error,
		);
		await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());

		try {
			controller.abort(abortError);
			const settledPromptly = await settlesAfterMicrotasks(outcome);
			response.resolve(stubResponse({ status: 401, json: { err_msg: "late failure" } }));
			const result = await outcome;

			expect(settledPromptly).toBe(true);
			expect(result).toBe(abortError);
			expect(consoleError).not.toHaveBeenCalled();
		} finally {
			consoleError.mockRestore();
		}
	});
});
