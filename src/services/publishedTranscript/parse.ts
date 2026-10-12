import { isPlainObject } from "src/persistence/codecUtils";

/** The transcript formats of the podcast namespace that PodNotes reads. */
export type TranscriptFormat = "vtt" | "srt" | "json" | "html" | "text";

/** One timed piece of a transcript, in seconds from the start of the episode. */
export interface TranscriptCue {
	readonly start: number;
	readonly end?: number;
	readonly speaker?: string;
	readonly text: string;
}

export type NonEmpty<T> = readonly [T, ...T[]];

export type ParsedTranscript =
	| { readonly kind: "timed"; readonly cues: NonEmpty<TranscriptCue> }
	| { readonly kind: "untimed"; readonly paragraphs: NonEmpty<string> };

/**
 * The transcript in `text`, read as `format`. Undefined when nothing is
 * readable: the text is not in that format, or it has no words.
 */
export function parseTranscript(
	format: TranscriptFormat,
	text: string,
): ParsedTranscript | undefined {
	const source = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
	switch (format) {
		case "vtt":
		case "srt":
			return timed(parseCueBlocks(source));
		case "json":
			return timed(parseJsonSegments(source));
		case "html":
			return parseHtml(source);
		case "text":
			return untimed(paragraphsOf(source));
	}
}

/** Whitespace and control characters become one space, trimmed. */
export function collapseWhitespace(text: string): string {
	return text.replace(/[\s\p{Cc}]+/gu, " ").trim();
}

const TIMING_LINE = /^\s*(\S+)\s+-->\s+(\S+)/;
const VOICE_TAG = /<v(?:\.[^\s>]*)?\s+([^>]*)>/;

/**
 * VTT and SRT cues: blank-line separated blocks whose timing line holds `-->`.
 * Lines before it (a cue identifier or index) are skipped. A VTT voice names
 * the speaker until another voice does, because hosts tag only the changes.
 */
function parseCueBlocks(source: string): TranscriptCue[] {
	const cues: TranscriptCue[] = [];
	let speaker: string | undefined;
	for (const block of source.split(/\n[ \t]*\n/)) {
		const lines = block.split("\n");
		const timing = lines.findIndex((line) => line.includes("-->"));
		const clocks = timing < 0 ? null : TIMING_LINE.exec(lines[timing]);
		if (!clocks) continue;
		const raw = lines.slice(timing + 1).join(" ");
		const voice = VOICE_TAG.exec(raw);
		if (voice) speaker = collapseWhitespace(decodeEntities(voice[1])) || undefined;
		const start = parseClock(clocks[1]);
		const text = collapseWhitespace(decodeEntities(raw.replace(/<[^>]*>/g, "")));
		if (start === undefined || !text) continue;
		cues.push({ start, end: parseClock(clocks[2]), speaker, text });
	}
	return cues;
}

/** `{ segments: [{ speaker?, startTime, endTime?, body }] }`, times as numbers or numeric strings. */
function parseJsonSegments(source: string): TranscriptCue[] {
	let data: unknown;
	try {
		data = JSON.parse(source);
	} catch {
		return [];
	}
	const segments: unknown[] =
		isPlainObject(data) && Array.isArray(data.segments) ? data.segments : [];
	return segments.flatMap((segment): TranscriptCue[] => {
		if (!isPlainObject(segment)) return [];
		const start = toSeconds(segment.startTime);
		const text = typeof segment.body === "string" ? collapseWhitespace(segment.body) : "";
		if (start === undefined || !text) return [];
		const speaker =
			typeof segment.speaker === "string" ? collapseWhitespace(segment.speaker) : "";
		return [{ start, end: toSeconds(segment.endTime), speaker: speaker || undefined, text }];
	});
}

/** Each `<time>` starts a cue: the `<cite>` before it names the speaker, the `<p>` after it holds the words. */
function parseHtml(source: string): ParsedTranscript | undefined {
	const body = new DOMParser().parseFromString(source, "text/html").body;
	const cues = Array.from(body.querySelectorAll("time")).flatMap((time): TranscriptCue[] => {
		const start =
			parseClock(time.getAttribute("datetime") ?? "") ?? parseClock(time.textContent ?? "");
		const words = time.nextElementSibling;
		const text = words?.tagName === "P" ? collapseWhitespace(words.textContent ?? "") : "";
		if (start === undefined || !text) return [];
		const cite = time.previousElementSibling;
		const speaker = cite?.tagName === "CITE" ? collapseWhitespace(cite.textContent ?? "") : "";
		return [{ start, speaker: speaker || undefined, text }];
	});
	if (cues.length > 0) return timed(cues);
	const paragraphs = Array.from(body.querySelectorAll("p"), (p) =>
		collapseWhitespace(p.textContent ?? ""),
	).filter(Boolean);
	return untimed(paragraphs.length > 0 ? paragraphs : paragraphsOf(body.textContent ?? ""));
}

function paragraphsOf(source: string): string[] {
	return source
		.split(/\n[ \t]*\n/)
		.map(collapseWhitespace)
		.filter(Boolean);
}

const CLOCK = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d+))?$/;

/** `HH:MM:SS.mmm`, `MM:SS,mmm` or `H:MM:SS` in seconds. */
function parseClock(text: string): number | undefined {
	const clock = CLOCK.exec(text.trim());
	if (!clock) return undefined;
	const [, hours = "0", minutes, seconds, fraction = "0"] = clock;
	return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(`0.${fraction}`);
}

function toSeconds(value: unknown): number | undefined {
	const seconds =
		typeof value === "number"
			? value
			: typeof value === "string" && value.trim()
				? Number(value)
				: NaN;
	return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

const NAMED_ENTITIES = new Map([
	["amp", "&"],
	["lt", "<"],
	["gt", ">"],
	["quot", '"'],
	["apos", "'"],
	["nbsp", "\u00a0"],
	["lrm", "\u200e"],
	["rlm", "\u200f"],
]);

/** Cue text entities, decoded once. Anything else, a bare `&` included, stays as written. */
function decodeEntities(text: string): string {
	return text.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (match, decimal, hex, name) => {
		if (name) return NAMED_ENTITIES.get(name) ?? match;
		const codePoint = decimal ? Number(decimal) : Number.parseInt(hex, 16);
		return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
	});
}

function timed(cues: TranscriptCue[]): ParsedTranscript | undefined {
	return isNonEmpty(cues) ? { kind: "timed", cues } : undefined;
}

function untimed(paragraphs: string[]): ParsedTranscript | undefined {
	return isNonEmpty(paragraphs) ? { kind: "untimed", paragraphs } : undefined;
}

function isNonEmpty<T>(items: readonly T[]): items is NonEmpty<T> {
	return items.length > 0;
}
