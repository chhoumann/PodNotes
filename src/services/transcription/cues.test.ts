import { describe, expect, test } from "vitest";
import { transcriptFromParts } from "./cues";

describe("transcriptFromParts", () => {
	test("times each word from the start of the episode, and never shares a speaker between parts", () => {
		const transcript = transcriptFromParts([
			{
				start: 0,
				transcript: {
					words: [
						{ text: "Hello.", start: 1.5, end: 2, speaker: "0" },
						{ text: "Hi.", start: 3, end: 3.5, speaker: "1" },
					],
				},
			},
			{
				start: 1800,
				transcript: {
					words: [{ text: "Welcome back.", start: 1.5, end: 2, speaker: "0" }],
				},
			},
		]);

		expect(transcript).toEqual({
			kind: "timed",
			cues: [
				{ start: 1.5, end: 2, speaker: "1", text: "Hello." },
				{ start: 3, end: 3.5, speaker: "2", text: "Hi." },
				{ start: 1801.5, end: 1802, speaker: "3", text: "Welcome back." },
			],
		});
	});

	test("marks a failed part at the time it starts", () => {
		const transcript = transcriptFromParts([
			{ start: 0, transcript: { words: [{ text: "Hello.", start: 1, end: 2 }] } },
			{ start: 1800 },
		]);

		expect(transcript).toEqual({
			kind: "timed",
			cues: [
				{ start: 1, end: 2, speaker: undefined, text: "Hello." },
				{ start: 1800, text: "[Error transcribing chunk 2]" },
			],
		});
	});
});
