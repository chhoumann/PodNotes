import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { diarizeWithOpenAI } from "./openaiProvider";

const fetchMock = vi.fn<typeof fetch>();

function chunk(name: string): File {
	return new File([new ArrayBuffer(8)], name, { type: "audio/mpeg" });
}

const diarized = (speaker: string, text: string) => async () =>
	Response.json({
		segments: [{ type: "transcript.text.segment", id: "1", speaker, start: 0, end: 1, text }],
	});

const sentForm = (call: number) => fetchMock.mock.calls[call][1]?.body as FormData;

beforeEach(() => {
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	fetchMock.mockReset();
});

describe("diarizeWithOpenAI (#168)", () => {
	it("concatenates parsed segments across chunks in order", async () => {
		fetchMock
			.mockImplementationOnce(diarized("A", "First."))
			.mockImplementationOnce(diarized("B", "Second."));
		const chunks = [chunk("a.mp3"), chunk("b.mp3")];

		const segments = await diarizeWithOpenAI({
			apiKey: "sk-test",
			chunkFiles: chunks,
			maxRetries: 2,
			onProgress: () => {},
			signal: new AbortController().signal,
		});

		expect(segments).toEqual([
			{ speaker: "A", text: "First.", start: 0, end: 1 },
			{ speaker: "B", text: "Second.", start: 0, end: 1 },
		]);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect([...sentForm(0).entries()]).toEqual([
			["model", "gpt-4o-transcribe-diarize"],
			["file", expect.objectContaining({ name: "a.mp3" })],
			["response_format", "diarized_json"],
			["chunking_strategy", "auto"],
		]);
		expect((sentForm(1).get("file") as File).name).toBe("b.mp3");
	});

	it("keeps a partial transcript with a marker when only some chunks fail", async () => {
		fetchMock
			.mockImplementationOnce(diarized("A", "Good chunk."))
			.mockImplementation(async () => new Response("Bad Gateway", { status: 502 }));

		const segments = await diarizeWithOpenAI({
			apiKey: "sk-test",
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
		fetchMock.mockImplementation(async () =>
			Response.json(
				{ error: { message: "Incorrect API key provided: sk-test." } },
				{ status: 401 },
			),
		);

		await expect(
			diarizeWithOpenAI({
				apiKey: "sk-test",
				chunkFiles: [chunk("a.mp3"), chunk("b.mp3")],
				maxRetries: 1,
				onProgress: () => {},
				signal: new AbortController().signal,
			}),
		).rejects.toThrow(
			new Error(
				"OpenAI diarization failed for every chunk: 401 Incorrect API key provided: sk-test.",
			),
		);
	});

	it("aborts an in-flight request without retrying or logging a failure", async () => {
		const controller = new AbortController();
		const abortError = new DOMException("plugin unloaded", "AbortError");
		fetchMock.mockImplementation(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
						once: true,
					});
				}),
		);
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

		try {
			const pending = diarizeWithOpenAI({
				apiKey: "sk-test",
				chunkFiles: [chunk("a.mp3")],
				maxRetries: 3,
				onProgress: () => {},
				signal: controller.signal,
			});
			await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

			controller.abort(abortError);

			await expect(pending).rejects.toBe(abortError);
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
			expect(consoleError).not.toHaveBeenCalled();
		} finally {
			consoleError.mockRestore();
		}
	});
});
