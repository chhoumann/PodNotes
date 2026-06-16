import { describe, expect, it } from "vitest";
import {
	DEFAULT_SPEAKER_TEMPLATE,
	formatSpeakerLabel,
	mergeAdjacentSpeakers,
	parseDeepgramSegments,
	parseOpenAIDiarizedSegments,
	renderDiarizedTranscript,
} from "./segments";

describe("parseOpenAIDiarizedSegments (#168)", () => {
	it("maps diarized_json segments to normalized turns", () => {
		const payload = {
			segments: [
				{ type: "transcript.text.segment", id: "1", speaker: "A", start: 0, end: 2, text: "Hello there." },
				{ type: "transcript.text.segment", id: "2", speaker: "B", start: 2, end: 4, text: "Hi!" },
			],
		};

		expect(parseOpenAIDiarizedSegments(payload)).toEqual([
			{ speaker: "A", text: "Hello there.", start: 0, end: 2 },
			{ speaker: "B", text: "Hi!", start: 2, end: 4 },
		]);
	});

	it("merges consecutive same-speaker segments into one turn", () => {
		const payload = {
			segments: [
				{ speaker: "A", start: 0, end: 1, text: "One." },
				{ speaker: "A", start: 1, end: 2, text: "Two." },
				{ speaker: "B", start: 2, end: 3, text: "Three." },
			],
		};

		expect(parseOpenAIDiarizedSegments(payload)).toEqual([
			{ speaker: "A", text: "One. Two.", start: 0, end: 2 },
			{ speaker: "B", text: "Three.", start: 2, end: 3 },
		]);
	});

	it("skips empty/malformed entries instead of throwing", () => {
		const payload = {
			segments: [
				{ speaker: "A", text: "  " },
				null,
				{ speaker: "A", text: "Real." },
				{ text: "No speaker field" },
			],
		};

		expect(parseOpenAIDiarizedSegments(payload)).toEqual([
			{ speaker: "A", text: "Real.", start: undefined, end: undefined },
			{ speaker: "?", text: "No speaker field", start: undefined, end: undefined },
		]);
	});

	it("returns [] for non-object or shapeless payloads", () => {
		expect(parseOpenAIDiarizedSegments(null)).toEqual([]);
		expect(parseOpenAIDiarizedSegments("nope")).toEqual([]);
		expect(parseOpenAIDiarizedSegments({})).toEqual([]);
		expect(parseOpenAIDiarizedSegments({ segments: "x" })).toEqual([]);
	});
});

describe("parseDeepgramSegments (#168)", () => {
	it("prefers utterances and presents speakers 1-based", () => {
		const payload = {
			results: {
				utterances: [
					{ speaker: 0, transcript: "Hello there.", start: 0, end: 2 },
					{ speaker: 1, transcript: "Hi!", start: 2, end: 3 },
				],
			},
		};

		expect(parseDeepgramSegments(payload)).toEqual([
			{ speaker: "1", text: "Hello there.", start: 0, end: 2 },
			{ speaker: "2", text: "Hi!", start: 2, end: 3 },
		]);
	});

	it("falls back to grouping words when utterances are absent", () => {
		const payload = {
			results: {
				channels: [
					{
						alternatives: [
							{
								words: [
									{ word: "hello", punctuated_word: "Hello", speaker: 0, start: 0, end: 1 },
									{ word: "there", punctuated_word: "there.", speaker: 0, start: 1, end: 2 },
									{ word: "hi", punctuated_word: "Hi!", speaker: 1, start: 2, end: 3 },
								],
							},
						],
					},
				],
			},
		};

		expect(parseDeepgramSegments(payload)).toEqual([
			{ speaker: "1", text: "Hello there.", start: 0, end: 2 },
			{ speaker: "2", text: "Hi!", start: 2, end: 3 },
		]);
	});

	it("returns [] for a results object with neither utterances nor words", () => {
		expect(parseDeepgramSegments({ results: {} })).toEqual([]);
		expect(parseDeepgramSegments({})).toEqual([]);
		expect(parseDeepgramSegments(null)).toEqual([]);
	});
});

describe("mergeAdjacentSpeakers (#168)", () => {
	it("does not mutate the input array", () => {
		const input = [
			{ speaker: "A", text: "One." },
			{ speaker: "A", text: "Two." },
		];
		const copy = structuredClone(input);
		mergeAdjacentSpeakers(input);
		expect(input).toEqual(copy);
	});
});

describe("formatSpeakerLabel (#168)", () => {
	it("substitutes the {{speaker}} token (case/space-insensitive)", () => {
		expect(formatSpeakerLabel("**{{speaker}}:** ", "A")).toBe("**A:** ");
		expect(formatSpeakerLabel("{{ Speaker }} - ", "2")).toBe("2 - ");
	});

	it("prefixes the label when the template has no token", () => {
		expect(formatSpeakerLabel("> ", "A")).toBe("A: > ");
	});
});

describe("renderDiarizedTranscript (#168)", () => {
	it("renders speaker turns separated by blank lines", () => {
		const body = renderDiarizedTranscript(
			[
				{ speaker: "A", text: "Hello there." },
				{ speaker: "B", text: "Hi!" },
			],
			DEFAULT_SPEAKER_TEMPLATE,
		);

		expect(body).toBe("**A:** Hello there.\n\n**B:** Hi!");
	});

	it("honors a custom speaker template", () => {
		const body = renderDiarizedTranscript(
			[{ speaker: "1", text: "Hi." }],
			"Speaker {{speaker}}: ",
		);

		expect(body).toBe("Speaker 1: Hi.");
	});

	it("falls back to the default template when given an empty one", () => {
		const body = renderDiarizedTranscript([{ speaker: "A", text: "Hi." }], "");
		expect(body).toBe("**A:** Hi.");
	});

	it("returns an empty string for no segments", () => {
		expect(renderDiarizedTranscript([], DEFAULT_SPEAKER_TEMPLATE)).toBe("");
	});
});
