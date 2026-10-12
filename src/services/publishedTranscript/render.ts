import type { Episode } from "src/types/Episode";
import { DEFAULT_SPEAKER_TEMPLATE, formatSpeakerLabel } from "src/services/diarization/segments";
import { formatEpisodeTimestamp } from "src/utility/formatEpisodeTimestamp";
import {
	collapseWhitespace,
	type NonEmpty,
	type ParsedTranscript,
	type TranscriptCue,
} from "./parse";

export interface TimestampStyle {
	readonly format: string;
	readonly linkify: boolean;
}

const TIME_TAG = /\{\{\s*(link)?(?:time|segment)\s*(?::\s*(.*?))?\}\}/i;

/** The timestamp style the user's capture template asks for: its first time tag's format and whether it links. */
export function timestampStyle(timestampTemplate: string): TimestampStyle {
	const tag = TIME_TAG.exec(timestampTemplate);
	return { format: tag?.[2] || "HH:mm:ss", linkify: tag?.[1] !== undefined };
}

export interface TranscriptParagraph {
	readonly start: number;
	readonly end: number;
	readonly speaker?: string;
	readonly text: string;
}

/** A silence this long starts a new paragraph. */
const PARAGRAPH_GAP_SECONDS = 5;
/** A paragraph this long ends at its next sentence end. */
const PARAGRAPH_SOFT_SECONDS = 30;
/** A paragraph this long ends at its next cue. */
const PARAGRAPH_HARD_SECONDS = 60;
const ENDS_SENTENCE = /[.!?]["')\]]*$/;

/**
 * Cues joined into readable paragraphs, in feed order. A cue is never split, and
 * a cue without a speaker continues the paragraph before it.
 */
export function groupCues(cues: NonEmpty<TranscriptCue>): TranscriptParagraph[] {
	const paragraphs: TranscriptParagraph[] = [];
	for (const cue of cues) {
		const end = cue.end ?? cue.start;
		const last = paragraphs[paragraphs.length - 1];
		if (last && continues(last, cue)) {
			paragraphs[paragraphs.length - 1] = {
				...last,
				end: Math.max(last.end, end),
				text: `${last.text} ${cue.text}`,
			};
		} else {
			paragraphs.push({ start: cue.start, end, speaker: cue.speaker, text: cue.text });
		}
	}
	return paragraphs;
}

function continues(paragraph: TranscriptParagraph, cue: TranscriptCue): boolean {
	const span = paragraph.end - paragraph.start;
	return (
		(cue.speaker === undefined || cue.speaker === paragraph.speaker) &&
		cue.start - paragraph.end < PARAGRAPH_GAP_SECONDS &&
		span < PARAGRAPH_HARD_SECONDS &&
		!(span >= PARAGRAPH_SOFT_SECONDS && ENDS_SENTENCE.test(paragraph.text))
	);
}

/**
 * The note body for `{{transcript}}`: one paragraph per line with a blank line
 * between. A timed paragraph starts with its timestamp, in the feed's time with
 * no capture offset.
 */
export function renderTranscriptBody(
	transcript: ParsedTranscript,
	options: { episode: Episode; speakerTemplate: string; timestamp: TimestampStyle },
): string {
	if (transcript.kind === "untimed") {
		return transcript.paragraphs.map(escapeTranscriptText).join("\n\n");
	}
	const { episode, timestamp } = options;
	const speakerTemplate = options.speakerTemplate || DEFAULT_SPEAKER_TEMPLATE;
	return groupCues(transcript.cues)
		.map(({ start, speaker, text }) => {
			const time = formatEpisodeTimestamp(
				episode,
				start,
				timestamp.format,
				timestamp.linkify,
			);
			const label = speaker
				? formatSpeakerLabel(speakerTemplate, escapeTranscriptText(speaker))
				: "";
			return `${time} ${label}${escapeTranscriptText(text)}`;
		})
		.join("\n\n");
}

/**
 * Feed text as inert Markdown prose on one line. The escaped characters start
 * HTML and Templater (`<`), embeds and links (`[`), code and Dataview queries
 * (`` ` `` and `~`), tags (`#`), comments (`%`) and math (`$`). Escaping `\`
 * first keeps every escape reversible.
 */
export function escapeTranscriptText(text: string): string {
	return collapseWhitespace(text).replace(/[\\`<[#%$~]/g, "\\$&");
}
