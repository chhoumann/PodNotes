import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimited } from "../../../tests/mocks/openaiFailures";
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
	vi.useRealTimers();
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

	it("waits out the server's Retry-After and recovers the chunk", async () => {
		vi.useFakeTimers();
		const sentAt: number[] = [];
		fetchMock.mockImplementation(async () => {
			sentAt.push(Date.now());
			return Date.now() - sentAt[0] < 4000
				? rateLimited({ "retry-after": "4" })
				: diarized("A", "Recovered.")();
		});

		const outcome = diarizeWithOpenAI({
			apiKey: "sk-test",
			chunkFiles: [chunk("a.mp3")],
			maxRetries: 3,
			onProgress: () => {},
			signal: new AbortController().signal,
		}).catch((error: unknown) => error);
		await vi.runAllTimersAsync();

		expect(sentAt.map((time) => time - sentAt[0])).toEqual([0, 4000]);
		expect(await outcome).toEqual([{ speaker: "A", text: "Recovered.", start: 0, end: 1 }]);
	});

	it("aborts while waiting out the server's Retry-After", async () => {
		vi.useFakeTimers();
		const controller = new AbortController();
		const abortReason = new Error("plugin unloaded");
		fetchMock.mockImplementation(async () => rateLimited({ "retry-after": "30" }));

		let outcome: unknown = "pending";
		void diarizeWithOpenAI({
			apiKey: "sk-test",
			chunkFiles: [chunk("a.mp3")],
			maxRetries: 3,
			onProgress: () => {},
			signal: controller.signal,
		}).then(
			() => {
				outcome = "resolved";
			},
			(error: unknown) => {
				outcome = error;
			},
		);
		await vi.advanceTimersByTimeAsync(29_000);
		expect(fetchMock).toHaveBeenCalledOnce();

		controller.abort(abortReason);
		await vi.advanceTimersByTimeAsync(0);

		expect(outcome).toBe(abortReason);
		expect(fetchMock).toHaveBeenCalledOnce();
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
