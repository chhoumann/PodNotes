import { describe, expect, it, vi } from "vitest";
import type { OpenAI } from "openai";
import { diarizeWithOpenAI } from "./openaiProvider";

function fakeClient(create: ReturnType<typeof vi.fn>): () => Promise<OpenAI> {
	return async () => ({ audio: { transcriptions: { create } } }) as unknown as OpenAI;
}

function chunk(name: string): File {
	return new File([new ArrayBuffer(8)], name, { type: "audio/mpeg" });
}

const diarized = (speaker: string, text: string) => ({
	segments: [{ type: "transcript.text.segment", id: "1", speaker, start: 0, end: 1, text }],
});

describe("diarizeWithOpenAI (#168)", () => {
	it("concatenates parsed segments across chunks in order", async () => {
		const create = vi
			.fn()
			.mockResolvedValueOnce(diarized("A", "First."))
			.mockResolvedValueOnce(diarized("B", "Second."));

		const segments = await diarizeWithOpenAI({
			getClient: fakeClient(create),
			chunkFiles: [chunk("a.mp3"), chunk("b.mp3")],
			maxRetries: 2,
			onProgress: () => {},
			signal: new AbortController().signal,
		});

		expect(segments).toEqual([
			{ speaker: "A", text: "First.", start: 0, end: 1 },
			{ speaker: "B", text: "Second.", start: 0, end: 1 },
		]);
	});

	it("keeps a partial transcript with a marker when only some chunks fail", async () => {
		const create = vi
			.fn()
			.mockResolvedValueOnce(diarized("A", "Good chunk."))
			.mockRejectedValue(new Error("boom"));

		const segments = await diarizeWithOpenAI({
			getClient: fakeClient(create),
			chunkFiles: [chunk("a.mp3"), chunk("b.mp3")],
			maxRetries: 1,
			onProgress: () => {},
			signal: new AbortController().signal,
		});

		expect(segments).toEqual([
			{ speaker: "A", text: "Good chunk.", start: 0, end: 1 },
			{ speaker: "?", text: "[Error diarizing chunk 2]" },
		]);
	});

	it("throws (writes no transcript) when every chunk fails", async () => {
		const create = vi.fn().mockRejectedValue(new Error("invalid api key"));

		await expect(
			diarizeWithOpenAI({
				getClient: fakeClient(create),
				chunkFiles: [chunk("a.mp3"), chunk("b.mp3")],
				maxRetries: 1,
				onProgress: () => {},
				signal: new AbortController().signal,
			}),
		).rejects.toThrow(/every chunk: invalid api key/);
	});

	it("aborts an in-flight request without retrying or logging a failure", async () => {
		const controller = new AbortController();
		const abortError = new DOMException("plugin unloaded", "AbortError");
		const create = vi.fn(
			(_request: unknown, options?: { signal?: AbortSignal }): Promise<never> =>
				new Promise((_resolve, reject) => {
					options?.signal?.addEventListener(
						"abort",
						() => reject(options.signal?.reason ?? new Error("aborted")),
						{ once: true },
					);
				}),
		);
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

		try {
			const pending = diarizeWithOpenAI({
				getClient: fakeClient(create),
				chunkFiles: [chunk("a.mp3")],
				maxRetries: 3,
				onProgress: () => {},
				signal: controller.signal,
			});
			await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());

			controller.abort(abortError);

			await expect(pending).rejects.toBe(abortError);
			expect(create).toHaveBeenCalledTimes(1);
			expect(create.mock.calls[0]?.[1]).toEqual({ signal: controller.signal });
			expect(consoleError).not.toHaveBeenCalled();
		} finally {
			consoleError.mockRestore();
		}
	});
});
