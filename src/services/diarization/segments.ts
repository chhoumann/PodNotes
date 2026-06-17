import type { DiarizedSegment } from "./types";

/**
 * Pure parsing/rendering for diarized transcripts (issue #168).
 *
 * The provider-specific network code lives in `openaiProvider.ts` /
 * `deepgramProvider.ts`; everything here is side-effect free so the risky shape
 * handling (untrusted JSON -> normalized segments -> markdown) is unit-testable.
 */

/** The placeholder a speaker-label template uses to position the speaker name. */
const SPEAKER_TOKEN = /\{\{\s*speaker\s*\}\}/gi;

/** Default per-turn prefix; `{{speaker}}` is replaced with the provider's label. */
export const DEFAULT_SPEAKER_TEMPLATE = "**{{speaker}}:** ";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function cleanText(text: unknown): string {
	return typeof text === "string" ? text.trim() : "";
}

/**
 * Parse OpenAI `diarized_json` output (from `gpt-4o-transcribe-diarize`) into
 * normalized segments. The payload is `{ segments: [{ speaker, text, start,
 * end, ... }] }` where `speaker` is a capital-letter label (`A`, `B`, ...).
 * Malformed/empty entries are skipped rather than throwing so one bad segment
 * can't sink an otherwise-good transcript.
 */
export function parseOpenAIDiarizedSegments(payload: unknown): DiarizedSegment[] {
	if (!isRecord(payload) || !Array.isArray(payload.segments)) return [];

	const segments: DiarizedSegment[] = [];
	for (const raw of payload.segments) {
		if (!isRecord(raw)) continue;
		const text = cleanText(raw.text);
		if (!text) continue;
		const speaker =
			typeof raw.speaker === "string" && raw.speaker.trim()
				? raw.speaker.trim()
				: "?";
		segments.push({
			speaker,
			text,
			start: typeof raw.start === "number" ? raw.start : undefined,
			end: typeof raw.end === "number" ? raw.end : undefined,
		});
	}
	return mergeAdjacentSpeakers(segments);
}

/**
 * Parse Deepgram pre-recorded output into normalized segments. Prefers the
 * top-level `results.utterances[]` (already grouped into speaker turns when the
 * request sets `utterances=true`); otherwise falls back to grouping the
 * per-word `results.channels[0].alternatives[0].words[]` by their integer
 * `speaker`. Deepgram speakers are 0-based; we present them 1-based so a label
 * never reads "Speaker 0".
 */
export function parseDeepgramSegments(payload: unknown): DiarizedSegment[] {
	if (!isRecord(payload) || !isRecord(payload.results)) return [];
	const results = payload.results;

	if (Array.isArray(results.utterances)) {
		const segments: DiarizedSegment[] = [];
		for (const raw of results.utterances) {
			if (!isRecord(raw)) continue;
			const text = cleanText(raw.transcript);
			if (!text) continue;
			segments.push({
				speaker: speakerLabelFromIndex(raw.speaker),
				text,
				start: typeof raw.start === "number" ? raw.start : undefined,
				end: typeof raw.end === "number" ? raw.end : undefined,
			});
		}
		return mergeAdjacentSpeakers(segments);
	}

	return mergeAdjacentSpeakers(groupDeepgramWords(results));
}

/** Deepgram fallback: stitch per-word objects into contiguous speaker turns. */
function groupDeepgramWords(results: Record<string, unknown>): DiarizedSegment[] {
	const channels = results.channels;
	if (!Array.isArray(channels) || !isRecord(channels[0])) return [];
	const alternatives = channels[0].alternatives;
	if (!Array.isArray(alternatives) || !isRecord(alternatives[0])) return [];
	const words = alternatives[0].words;
	if (!Array.isArray(words)) return [];

	const segments: DiarizedSegment[] = [];
	for (const raw of words) {
		if (!isRecord(raw)) continue;
		const token =
			typeof raw.punctuated_word === "string"
				? raw.punctuated_word
				: typeof raw.word === "string"
					? raw.word
					: "";
		if (!token) continue;
		const speaker = speakerLabelFromIndex(raw.speaker);
		const last = segments[segments.length - 1];
		if (last && last.speaker === speaker) {
			last.text += ` ${token}`;
			if (typeof raw.end === "number") last.end = raw.end;
		} else {
			segments.push({
				speaker,
				text: token,
				start: typeof raw.start === "number" ? raw.start : undefined,
				end: typeof raw.end === "number" ? raw.end : undefined,
			});
		}
	}
	return segments;
}

function speakerLabelFromIndex(speaker: unknown): string {
	return typeof speaker === "number" && Number.isFinite(speaker)
		? String(speaker + 1)
		: "?";
}

/**
 * Collapse runs of the same speaker into one turn. Providers can emit several
 * back-to-back segments for the same speaker (e.g. one per sentence); merging
 * them yields readable paragraphs and a stable shape for rendering.
 */
export function mergeAdjacentSpeakers(
	segments: DiarizedSegment[],
): DiarizedSegment[] {
	const merged: DiarizedSegment[] = [];
	for (const segment of segments) {
		const last = merged[merged.length - 1];
		if (last && last.speaker === segment.speaker) {
			last.text = `${last.text} ${segment.text}`.trim();
			if (segment.end !== undefined) last.end = segment.end;
		} else {
			merged.push({ ...segment });
		}
	}
	return merged;
}

/**
 * Replace the `{{speaker}}` token in a speaker-label template. When the template
 * has no token the label is prefixed instead, so even a tokenless template
 * (e.g. "> ") still produces a usable, speaker-prefixed line.
 */
export function formatSpeakerLabel(template: string, speaker: string): string {
	if (SPEAKER_TOKEN.test(template)) {
		SPEAKER_TOKEN.lastIndex = 0;
		return template.replace(SPEAKER_TOKEN, speaker);
	}
	return `${speaker}: ${template}`;
}

/**
 * Render normalized segments into the markdown body that fills `{{transcript}}`.
 * Each turn is `<speaker-label><text>`, turns separated by a blank line so they
 * read as paragraphs. Returns an empty string for no segments so the caller can
 * detect a diarization that produced nothing.
 */
export function renderDiarizedTranscript(
	segments: DiarizedSegment[],
	speakerTemplate: string,
): string {
	const template = speakerTemplate || DEFAULT_SPEAKER_TEMPLATE;
	return segments
		.map((segment) => `${formatSpeakerLabel(template, segment.speaker)}${segment.text}`)
		.join("\n\n");
}
