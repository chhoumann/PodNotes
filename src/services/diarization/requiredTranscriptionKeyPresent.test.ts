import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "src/constants";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import { requiredTranscriptionKeyPresent } from "./index";

function settings(overrides: Partial<IPodNotesSettings> = {}): IPodNotesSettings {
	return structuredClone({ ...DEFAULT_SETTINGS, ...overrides });
}

function withDiarization(
	provider: "openai" | "deepgram",
	enabled: boolean,
	keys: { openAIApiKey?: string; diarizationApiKey?: string } = {},
): IPodNotesSettings {
	const s = settings(keys);
	s.transcript.diarization.enabled = enabled;
	s.transcript.diarization.provider = provider;
	return s;
}

describe("requiredTranscriptionKeyPresent (#168)", () => {
	it("requires the OpenAI key when diarization is off", () => {
		expect(requiredTranscriptionKeyPresent(settings({ openAIApiKey: "sk" }))).toBe(
			true,
		);
		expect(requiredTranscriptionKeyPresent(settings({ openAIApiKey: "" }))).toBe(
			false,
		);
	});

	it("requires the OpenAI key for the OpenAI diarization provider", () => {
		expect(
			requiredTranscriptionKeyPresent(
				withDiarization("openai", true, { openAIApiKey: "sk" }),
			),
		).toBe(true);
		expect(
			requiredTranscriptionKeyPresent(
				withDiarization("openai", true, {
					openAIApiKey: "",
					diarizationApiKey: "dg",
				}),
			),
		).toBe(false);
	});

	it("requires the Deepgram key for the Deepgram diarization provider", () => {
		expect(
			requiredTranscriptionKeyPresent(
				withDiarization("deepgram", true, { diarizationApiKey: "dg" }),
			),
		).toBe(true);
		// An OpenAI key does not satisfy the Deepgram provider.
		expect(
			requiredTranscriptionKeyPresent(
				withDiarization("deepgram", true, {
					openAIApiKey: "sk",
					diarizationApiKey: "",
				}),
			),
		).toBe(false);
	});

	it("falls back to the OpenAI key when Deepgram is selected but diarization is off", () => {
		// provider=deepgram only matters when diarization is enabled.
		expect(
			requiredTranscriptionKeyPresent(
				withDiarization("deepgram", false, { openAIApiKey: "sk" }),
			),
		).toBe(true);
	});

	it("treats whitespace-only keys as absent", () => {
		expect(
			requiredTranscriptionKeyPresent(settings({ openAIApiKey: "   " })),
		).toBe(false);
		expect(
			requiredTranscriptionKeyPresent(
				withDiarization("deepgram", true, { diarizationApiKey: "  " }),
			),
		).toBe(false);
	});
});
