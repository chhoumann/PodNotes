import type { Episode } from "src/types/Episode";
import { DEFAULT_SPEAKER_TEMPLATE, formatSpeakerLabel } from "src/services/diarization/segments";
import { formatEpisodeTimestamp } from "src/utility/formatEpisodeTimestamp";
import { collapseWhitespace, type ParsedTranscript, type TranscriptCue } from "./parse";

export interface TimestampStyle {
	readonly format: string;
	readonly linkify: boolean;
}

// As in TemplateEngine, a tag's name fills the braces, so `{{ linktime }}` is no tag, and
// everything after the colon, spaces and line breaks included, is its format.
const TIME_TAG = /\{\{(link)?(?:time|segment)(?::(\s*.*?))?\}\}/i;

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

const PARAGRAPH_GAP_SECONDS = 5;
const PARAGRAPH_SOFT_SECONDS = 30;
const PARAGRAPH_HARD_SECONDS = 60;
const ENDS_SENTENCE = /[.!?]["')\]]*$/;

/**
 * Live Preview and Source mode take time superlinear in a line's escapes and
 * emphasis marks, and a note whose line takes minutes freezes Obsidian on every
 * launch that reopens it. A paragraph of real feed text stays under 1,900
 * characters. At 2,000, a note of 64,000 escaped `$`, the slowest escape, opens
 * in Live Preview at 2560x1440 in about 1.4 s; at 4,000 it took over 4 s.
 */
export const MAX_PARAGRAPH_LENGTH = 2000;
/** A speaker label repeats on each of its paragraphs. Real names stay under 20 characters. */
const MAX_SPEAKER_LENGTH = 100;

export function groupCues(cues: readonly TranscriptCue[]): TranscriptParagraph[] {
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
		!(span >= PARAGRAPH_SOFT_SECONDS && ENDS_SENTENCE.test(paragraph.text)) &&
		paragraph.text.length + 1 + cue.text.length <= MAX_PARAGRAPH_LENGTH
	);
}

/**
 * Splits written text into pieces of at most `max` characters at the last space
 * that fits. A piece without a space ends at the last character that fits,
 * stepping over each escape and each surrogate pair whole, so no piece ends in
 * a lone `\` or half a character.
 */
function splitText(text: string, max: number): string[] {
	const pieces: string[] = [];
	let rest = text;
	while (rest.length > max) {
		const space = rest.lastIndexOf(" ", max);
		if (space > 0) {
			pieces.push(rest.slice(0, space));
			rest = rest.slice(space + 1);
			continue;
		}
		const width = (at: number) =>
			rest[at] === "\\" || (rest.codePointAt(at) ?? 0) > 0xffff ? 2 : 1;
		let end = 0;
		while (end + width(end) <= max) end += width(end);
		pieces.push(rest.slice(0, end));
		rest = rest.slice(end);
	}
	pieces.push(rest);
	return pieces;
}

export function renderTranscriptBody(
	transcript: ParsedTranscript,
	options: { episode: Episode; speakerTemplate: string; timestamp: TimestampStyle },
): string {
	if (transcript.kind === "untimed") {
		return transcript.paragraphs
			.flatMap((text) => splitText(escapeTranscriptText(text), MAX_PARAGRAPH_LENGTH))
			.map(escapeParagraphStart)
			.join("\n\n");
	}
	const { episode, timestamp } = options;
	const speakerTemplate = options.speakerTemplate || DEFAULT_SPEAKER_TEMPLATE;
	const labels = new Map<string, string>();
	const label = (speaker: string) => {
		let written = labels.get(speaker);
		if (written === undefined) {
			const name = splitText(escapeTranscriptText(speaker), MAX_SPEAKER_LENGTH)[0];
			written = formatSpeakerLabel(speakerTemplate, name);
			labels.set(speaker, written);
		}
		return written;
	};
	const cues = transcript.cues.flatMap((cue) =>
		splitText(escapeTranscriptText(cue.text), MAX_PARAGRAPH_LENGTH).map((text) => ({
			...cue,
			text,
		})),
	);
	return groupCues(cues)
		.map(({ start, speaker, text }) => {
			const time = formatEpisodeTimestamp(
				episode,
				start,
				timestamp.format,
				timestamp.linkify,
			);
			return `${time} ${speaker ? label(speaker) : ""}${text}`;
		})
		.join("\n\n");
}

/** A list marker, quote or thematic break that starts an untimed paragraph stays text. */
function escapeParagraphStart(text: string): string {
	return text
		.replace(/^(?:[-+*](?= |$)|>|([-*_])(?: ?\1){2,}$)/, "\\$&")
		.replace(/^(\d+)([.)])(?= |$)/, "$1\\$2");
}

/**
 * The escaped characters start HTML and Templater (`<`), embeds and links (`[`),
 * code and Dataview queries (`` ` `` and `~`), tags (`#`), comments (`%`),
 * math (`$`), block IDs (`^`), tables (`|`, whose runs Obsidian parses in time
 * cubic in their length) and entities (`&lt;`, which the parser has already
 * decoded once). Escaping `\` too stops a backslash in the text from
 * cancelling the escape after it. Each colon after a colon is escaped as well,
 * because Dataview reads any `::` in the raw text as an inline field.
 */
export function escapeTranscriptText(text: string): string {
	return collapseWhitespace(text)
		.replace(/[\\`<[#%$~^|]|&(?=#?[a-z0-9]+;)/gi, "\\$&")
		.replace(/:(?=:)/g, ":\\");
}
