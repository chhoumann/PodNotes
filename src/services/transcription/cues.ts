import {
	type ParsedTranscript,
	timed,
	type TranscriptCue,
	untimed,
} from "src/services/publishedTranscript/parse";
import type { PartTranscript, Word } from "./providers/types";

/** What one part of the episode gave back. `transcript` is absent when its request failed. */
export interface TranscribedPart {
	/** Seconds into the episode where the part starts. */
	readonly start: number;
	readonly transcript?: PartTranscript;
}

type TimedPart = TranscribedPart & { readonly transcript?: { readonly words: readonly Word[] } };

const PARAGRAPH_LENGTH = 500;

/** Stands in the note for a part whose request failed, so the reader sees where speech is missing. */
function failedPartMarker(index: number): string {
	return `[Error transcribing chunk ${index + 1}]`;
}

/**
 * The episode's transcript from its parts in order, or undefined when no part holds speech.
 * Words become one cue each, timed from the start of the episode, and the renderer folds
 * them into paragraphs as it does for a published word-level transcript. Text from a model
 * that returns no times becomes untimed paragraphs. Without `speakers` no cue names one,
 * whatever the provider answered.
 */
export function transcriptFromParts(
	parts: readonly TranscribedPart[],
	speakers: boolean,
): ParsedTranscript | undefined {
	if (!parts.some(({ transcript }) => transcript && textOf(transcript).trim())) return undefined;
	if (isTimed(parts)) return timed(cuesOf(parts, speakers));
	const text = parts.map(({ transcript }, index) =>
		transcript ? textOf(transcript) : failedPartMarker(index),
	);
	return untimed(paragraphsOf(text.join(" ")));
}

function textOf(transcript: PartTranscript): string {
	return "text" in transcript
		? transcript.text
		: transcript.words.map((word) => word.text).join(" ");
}

function isTimed(parts: readonly TranscribedPart[]): parts is readonly TimedPart[] {
	return parts.every(({ transcript }) => !transcript || "words" in transcript);
}

/**
 * Seconds to the millisecond, as finely as providers time words. A part's start is a sum of
 * frame lengths, so a word's time in the episode would otherwise carry float noise into its link.
 */
function toMilliseconds(seconds: number): number {
	return Math.round(seconds * 1000) / 1000;
}

/** Speakers are numbered in the order they first speak. A provider's label names a speaker only within its own part. */
function cuesOf(parts: readonly TimedPart[], speakers: boolean): TranscriptCue[] {
	const numbers = new Map<string, string>();
	const numberOf = (label: string) => {
		const number = numbers.get(label) ?? `${numbers.size + 1}`;
		numbers.set(label, number);
		return number;
	};
	return parts.flatMap(({ start, transcript }, index): TranscriptCue[] =>
		transcript
			? transcript.words.map((word) => ({
					start: toMilliseconds(start + word.start),
					end: toMilliseconds(start + word.end),
					speaker:
						speakers && word.speaker !== undefined
							? numberOf(`${index}:${word.speaker}`)
							: undefined,
					text: word.text,
				}))
			: [{ start: toMilliseconds(start), text: failedPartMarker(index) }],
	);
}

/** Sentences, grouped until a paragraph passes 500 characters. */
function paragraphsOf(text: string): string[] {
	const paragraphs: string[] = [];
	let paragraph = "";
	for (const sentence of text
		.trim()
		.replace(/([.!?]["')\]]*)\s+/g, "$1\n")
		.split("\n")) {
		paragraph = paragraph ? `${paragraph} ${sentence}` : sentence;
		if (paragraph.length >= PARAGRAPH_LENGTH) {
			paragraphs.push(paragraph);
			paragraph = "";
		}
	}
	if (paragraph) paragraphs.push(paragraph);
	return paragraphs;
}
