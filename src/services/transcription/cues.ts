import {
	type ParsedTranscript,
	timed,
	type TranscriptCue,
	untimed,
} from "src/services/publishedTranscript/parse";
import type { PartTranscript, Segment, Word } from "./providers/types";

/** What one part of the episode gave back. `transcript` is absent when its request failed. */
export interface TranscribedPart {
	/** Seconds into the episode where the part starts. */
	readonly start: number;
	readonly transcript?: PartTranscript;
}

type TimedTranscript = Exclude<PartTranscript, { readonly text: string }>;
type TimedPart = TranscribedPart & { readonly transcript?: TimedTranscript };

const PARAGRAPH_LENGTH = 500;

/** Stands in the note for a part whose request failed, so the reader sees where speech is missing. */
function failedPartMarker(index: number): string {
	return `[Error transcribing chunk ${index + 1}]`;
}

/**
 * The episode's transcript from its parts in order, or undefined when no part holds speech.
 * Words, or segments from a model that times no single word, become one cue each, timed from
 * the start of the episode, and the renderer folds them into paragraphs as it does for a
 * published transcript. Text from a model that returns no times becomes untimed paragraphs.
 * Without `speakers` no cue names one, whatever the provider answered.
 */
export function transcriptFromParts(
	parts: readonly TranscribedPart[],
	speakers: boolean,
	sameSpeaker: SameSpeaker = new Map(),
): ParsedTranscript | undefined {
	if (!parts.some(({ transcript }) => transcript && textOf(transcript).trim())) return undefined;
	if (isTimed(parts)) return timed(cuesOf(parts, speakers, sameSpeaker));
	const text = parts.map(({ transcript }, index) =>
		transcript ? textOf(transcript) : failedPartMarker(index),
	);
	return untimed(paragraphsOf(text.join(" ")));
}

function textOf(transcript: PartTranscript): string {
	return "text" in transcript
		? transcript.text
		: timesOf(transcript)
				.map((item) => item.text)
				.join(" ");
}

function timesOf(transcript: TimedTranscript): readonly (Word | Segment)[] {
	return "words" in transcript ? transcript.words : transcript.segments;
}

function isTimed(parts: readonly TranscribedPart[]): parts is readonly TimedPart[] {
	return parts.every(({ transcript }) => !transcript || !("text" in transcript));
}

/**
 * Seconds to the millisecond, as finely as providers time words. A part's start is a sum of
 * frame lengths, so a word's time in the episode would otherwise carry float noise into its link.
 */
function toMilliseconds(seconds: number): number {
	return Math.round(seconds * 1000) / 1000;
}

/** Names a speaker label of one part. A provider's label names a speaker only within its own part. */
export function speakerKey(part: number, label: string): string {
	return `${part}:${label}`;
}

/** Speaker keys of labels heard as one person, each mapped to the key that stands for them all. */
export type SameSpeaker = ReadonlyMap<string, string>;

/** Speakers are numbered in the order they first speak. */
function cuesOf(
	parts: readonly TimedPart[],
	speakers: boolean,
	sameSpeaker: SameSpeaker,
): TranscriptCue[] {
	const numbers = new Map<string, string>();
	const numberOf = (part: number, label: string) => {
		const key = speakerKey(part, label);
		const speaker = sameSpeaker.get(key) ?? key;
		const number = numbers.get(speaker) ?? `${numbers.size + 1}`;
		numbers.set(speaker, number);
		return number;
	};
	return parts.flatMap(({ start, transcript }, index): TranscriptCue[] =>
		transcript
			? timesOf(transcript).map((item) => ({
					start: toMilliseconds(start + item.start),
					end: toMilliseconds(start + item.end),
					speaker:
						speakers && "speaker" in item && item.speaker !== undefined
							? numberOf(index, item.speaker)
							: undefined,
					text: item.text,
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
