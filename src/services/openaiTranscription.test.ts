import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPENAI_FAILURES } from "../../tests/mocks/openaiFailures";
import { createTranscription } from "./openaiTranscription";

const fetchMock = vi.fn<typeof fetch>();

const pendingUntilAborted: typeof fetch = (_url, init) =>
	new Promise((_resolve, reject) => {
		init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
	});

const send = (signal = new AbortController().signal) =>
	createTranscription("sk-test", { model: "whisper-1" }, signal);

const status500 = (body: string) => async () => new Response(body, { status: 500 });

const EDGE_FAILURES: typeof OPENAI_FAILURES = [
	[
		"500 top-level message",
		status500('{"message":"Overloaded","type":"server_error"}'),
		"500 Overloaded",
	],
	[
		"500 empty error.message",
		status500('{"error":{"message":"","type":"server_error"}}'),
		'500 {"message":"","type":"server_error"}',
	],
	[
		"500 non-string error.message",
		status500('{"error":{"message":{"reason":"x"}}}'),
		'500 {"reason":"x"}',
	],
	["500 error without message", status500('{"error":{"code":"busy"}}'), '500 {"code":"busy"}'],
	["500 error is a string", status500('{"error":"busy"}'), '500 "busy"'],
	["500 JSON number", status500("42"), "500 status code (no body)"],
	["500 JSON null", status500("null"), "500 null"],
	[
		"transport timeout message",
		() => Promise.reject(new TypeError("The request timed out.")),
		"Request timed out.",
	],
	[
		"transport WebKit load failed",
		() => Promise.reject(new TypeError("Load failed")),
		"Connection error.",
	],
];

beforeEach(() => {
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	fetchMock.mockReset();
});

describe("createTranscription", () => {
	it("posts the fields in order as multipart form data with only the bearer key", async () => {
		fetchMock.mockImplementation(async () => Response.json({ text: "Hi." }));
		const bytes = new Uint8Array(70_000).map((_, i) => (i * 31) % 256);
		const file = new File([bytes], "episode.mp3", { type: "audio/mp3" });

		await createTranscription(
			"sk-test",
			{
				model: "gpt-4o-transcribe-diarize",
				file,
				response_format: "diarized_json",
				chunking_strategy: "auto",
			},
			new AbortController().signal,
		);

		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
		expect(init?.method).toBe("POST");
		expect(Object.fromEntries(new Headers(init?.headers))).toEqual({
			authorization: "Bearer sk-test",
		});
		expect(init?.body).toBeInstanceOf(FormData);
		const form = init?.body as FormData;
		expect([...form.keys()]).toEqual(["model", "file", "response_format", "chunking_strategy"]);
		expect(form.get("model")).toBe("gpt-4o-transcribe-diarize");
		expect(form.get("response_format")).toBe("diarized_json");
		expect(form.get("chunking_strategy")).toBe("auto");
		const sent = form.get("file") as File;
		expect(sent.name).toBe("episode.mp3");
		expect(sent.type).toBe("audio/mp3");
		expect(new Uint8Array(await sent.arrayBuffer())).toEqual(bytes);
	});

	it("resolves with the parsed JSON body", async () => {
		const payload = {
			text: "Hi.",
			segments: [{ type: "transcript.text.segment", speaker: "A", start: 0, end: 1 }],
		};
		fetchMock.mockImplementation(async () => Response.json(payload));

		await expect(send()).resolves.toEqual(payload);
	});

	it.each([...OPENAI_FAILURES, ...EDGE_FAILURES])(
		"%s rejects with the openai SDK's message after one send",
		async (_name, respond, message) => {
			fetchMock.mockImplementation(respond);

			await expect(send()).rejects.toThrow(new Error(message));
			expect(fetchMock).toHaveBeenCalledOnce();
		},
	);

	it("times out a stalled request after 10 minutes", async () => {
		vi.useFakeTimers();
		fetchMock.mockImplementation(pendingUntilAborted);
		let settled = false;
		const pending = send().finally(() => {
			settled = true;
		});
		const assertion = expect(pending).rejects.toThrow(new Error("Request timed out."));

		await vi.advanceTimersByTimeAsync(10 * 60 * 1000 - 1);
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(1);

		await assertion;
		expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
	});

	it("aborts the request and rejects with the caller's abort reason", async () => {
		fetchMock.mockImplementation(pendingUntilAborted);
		const controller = new AbortController();
		const reason = new DOMException(
			"PodNotes was unloaded during transcription.",
			"AbortError",
		);
		const pending = send(controller.signal);

		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
		const requestSignal = fetchMock.mock.calls[0][1]?.signal;
		expect(requestSignal?.aborted).toBe(true);
		expect(requestSignal?.reason).toBe(reason);
	});
});
