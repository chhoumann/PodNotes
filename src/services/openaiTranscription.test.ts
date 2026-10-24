import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPENAI_FAILURES, rateLimited } from "../../tests/mocks/openaiFailures";
import { corsBlockedFetch, openAIMock, sentForm } from "../../tests/mocks/openaiRequestUrl";
import { createTranscription, retryDelayMs } from "./openaiTranscription";

vi.mock("obsidian", async (importOriginal) => ({
	...(await importOriginal<typeof import("obsidian")>()),
	requestUrl: (await import("../../tests/mocks/openaiRequestUrl")).openAIRequestUrl,
}));

const neverAnswers = () => new Promise<Response>(() => {});

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
];

beforeEach(() => {
	vi.stubGlobal("fetch", corsBlockedFetch);
	// In Obsidian's renderer `window` is the global object; the code under test uses its timers.
	vi.stubGlobal("window", globalThis);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	openAIMock.mockReset();
});

describe("createTranscription", () => {
	it("posts multipart form data that parses back to the same fields and file bytes", async () => {
		openAIMock.mockImplementation(async () => Response.json({ text: "Hi." }));
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

		expect(openAIMock).toHaveBeenCalledOnce();
		const [request] = openAIMock.mock.calls[0];
		expect(request.url).toBe("https://api.openai.com/v1/audio/transcriptions");
		expect(request.method).toBe("POST");
		expect(request.headers).toEqual({ Authorization: "Bearer sk-test" });
		expect(request.contentType).toMatch(/^multipart\/form-data; boundary=/);
		const form = await sentForm(request);
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
		openAIMock.mockImplementation(async () => Response.json(payload));

		await expect(send()).resolves.toEqual(payload);
	});

	it.each([...OPENAI_FAILURES, ...EDGE_FAILURES])(
		"%s rejects with the openai SDK's message after one send",
		async (_name, respond, message) => {
			openAIMock.mockImplementation(respond);

			await expect(send()).rejects.toThrow(new Error(message));
			expect(openAIMock).toHaveBeenCalledOnce();
		},
	);

	it("keeps the openai SDK's message for a 429 with retry headers", async () => {
		openAIMock.mockImplementation(async () =>
			rateLimited({ "retry-after": "4", "retry-after-ms": "4000" }),
		);

		await expect(send()).rejects.toHaveProperty(
			"message",
			"429 Rate limit reached for requests.",
		);
	});

	it.each<[name: string, headers: Record<string, string>, delayMs: number]>([
		["retry-after-ms", { "retry-after-ms": "1500" }, 1500],
		["retry-after seconds", { "retry-after": "4" }, 4000],
		["retry-after HTTP date", { "retry-after": "Thu, 01 Jan 2026 00:00:04 GMT" }, 4000],
		["both headers", { "retry-after-ms": "1500", "retry-after": "4" }, 1500],
		["retry-after over 60 s", { "retry-after": "61" }, 1234],
		["negative retry-after-ms", { "retry-after-ms": "-5" }, 1234],
		[
			"negative retry-after-ms with retry-after",
			{ "retry-after-ms": "-5", "retry-after": "4" },
			1234,
		],
		["unparseable retry-after", { "retry-after": "soon" }, 1234],
		["no retry header", {}, 1234],
		["retry-after zero", { "retry-after": "0" }, 0],
	])("%s gives the same retry delay as openai-node", async (_name, headers, delayMs) => {
		vi.useFakeTimers({ now: new Date("2026-01-01T00:00:00Z") });
		openAIMock.mockImplementation(async () => rateLimited(headers));

		const error = await send().catch((caught: unknown) => caught);

		expect(retryDelayMs(error, 1234)).toBe(delayMs);
	});

	it("stops waiting for a stalled request after 10 minutes", async () => {
		vi.useFakeTimers();
		openAIMock.mockImplementation(neverAnswers);
		let settled = false;
		const pending = send().finally(() => {
			settled = true;
		});
		const assertion = expect(pending).rejects.toThrow(new Error("Request timed out."));

		await vi.advanceTimersByTimeAsync(10 * 60 * 1000 - 1);
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(1);

		await assertion;
	});

	it("stops waiting on abort and rejects with the caller's abort reason", async () => {
		openAIMock.mockImplementation(neverAnswers);
		const controller = new AbortController();
		const reason = new DOMException(
			"PodNotes was unloaded during transcription.",
			"AbortError",
		);
		const pending = send(controller.signal);
		await vi.waitFor(() => expect(openAIMock).toHaveBeenCalledOnce());

		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
	});
});
