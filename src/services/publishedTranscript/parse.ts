import { isPlainObject } from "src/persistence/codecUtils";

export type TranscriptFormat = "vtt" | "srt" | "json" | "html" | "text";

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
			// A sign-in or error page served in place of the transcript.
			return source.trimStart().startsWith("<") ? undefined : untimed(paragraphsOf(source));
	}
}

export function collapseWhitespace(text: string): string {
	return text.replace(/[\s\p{Cc}]+/gu, " ").trim();
}

const TIMING_LINE = /^\s*(\S+)\s+-->\s+(\S+)/;
const VOICE_TAG = /<v(?:\.[^\s>]*)?\s+([^>]*)>/;

/** A VTT voice names the speaker until another voice does, because hosts tag only the changes. */
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

function parseHtml(source: string): ParsedTranscript | undefined {
	const body = new DOMParser().parseFromString(source, "text/html").body;
	const cues = Array.from(body.querySelectorAll("time")).flatMap((time): TranscriptCue[] => {
		const start =
			parseClock(time.getAttribute("datetime") ?? "") ?? parseClock(time.textContent ?? "");
		const words: string[] = [];
		for (let p = time.nextElementSibling; p?.tagName === "P"; p = p.nextElementSibling) {
			words.push(p.textContent ?? "");
		}
		const text = collapseWhitespace(words.join(" "));
		if (start === undefined || !text) return [];
		const cite = time.previousElementSibling;
		const speaker = cite?.tagName === "CITE" ? collapseWhitespace(cite.textContent ?? "") : "";
		return [{ start, speaker: speaker || undefined, text }];
	});
	if (cues.length > 0) return timed(cues);
	return untimed(
		Array.from(body.querySelectorAll("p"), (p) =>
			collapseWhitespace(p.textContent ?? ""),
		).filter(Boolean),
	);
}

function paragraphsOf(source: string): string[] {
	return source
		.split(/\n[ \t]*\n/)
		.map(collapseWhitespace)
		.filter(Boolean);
}

const CLOCK = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d+))?$/;

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
