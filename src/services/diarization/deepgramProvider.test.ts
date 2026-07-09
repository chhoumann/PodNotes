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
});
