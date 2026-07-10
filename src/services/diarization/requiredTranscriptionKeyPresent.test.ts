import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "src/constants";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import { requiredTranscriptionKeyPresent } from "./index";

function settings(overrides: Partial<IPodNotesSettings> = {}): IPodNotesSettings {
	return structuredClone({ ...DEFAULT_SETTINGS, ...overrides });
}

function withDiarization(provider: "openai" | "deepgram", enabled: boolean): IPodNotesSettings {
	const s = settings();
	s.transcript.diarization.enabled = enabled;
	s.transcript.diarization.provider = provider;
	return s;
}

const has =
	(...kinds: Array<"openai" | "deepgram">) =>
	(kind: "openai" | "deepgram") =>
		kinds.includes(kind);

describe("requiredTranscriptionKeyPresent (#168)", () => {
	it("requires the OpenAI key when diarization is off", () => {
		expect(requiredTranscriptionKeyPresent(settings(), has("openai"))).toBe(true);
		expect(requiredTranscriptionKeyPresent(settings(), has())).toBe(false);
	});

	it("requires the OpenAI key for the OpenAI diarization provider", () => {
		expect(
			requiredTranscriptionKeyPresent(withDiarization("openai", true), has("openai")),
		).toBe(true);
		expect(
			requiredTranscriptionKeyPresent(withDiarization("openai", true), has("deepgram")),
		).toBe(false);
	});

	it("requires the Deepgram key for the Deepgram diarization provider", () => {
		expect(
			requiredTranscriptionKeyPresent(withDiarization("deepgram", true), has("deepgram")),
		).toBe(true);
		// An OpenAI key does not satisfy the Deepgram provider.
		expect(
			requiredTranscriptionKeyPresent(withDiarization("deepgram", true), has("openai")),
		).toBe(false);
	});

	it("falls back to the OpenAI key when Deepgram is selected but diarization is off", () => {
		// provider=deepgram only matters when diarization is enabled.
		expect(
			requiredTranscriptionKeyPresent(withDiarization("deepgram", false), has("openai")),
		).toBe(true);
	});

	it("treats dangling SecretStorage references as absent", () => {
		expect(requiredTranscriptionKeyPresent(settings(), has())).toBe(false);
		expect(requiredTranscriptionKeyPresent(withDiarization("deepgram", true), has())).toBe(
			false,
		);
	});
});
