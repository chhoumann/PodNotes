import { isPlainObject } from "src/persistence/codecUtils";
import type { PartTranscript, Segment, Word } from "./types";

/**
 * The times in an answer in OpenAI's verbose_json shape, which OpenRouter and OpenAI-compatible
 * servers answer in: its words when it lists any, else its segments, else undefined.
 */
export function verboseJsonTimes(answer: unknown): PartTranscript | undefined {
	if (!isPlainObject(answer)) return undefined;
	const words = Array.isArray(answer.words) ? answer.words.flatMap(wordOf) : [];
	if (words.length > 0) return { words: punctuated(words, answer.text) };
	const segments = Array.isArray(answer.segments) ? answer.segments.flatMap(segmentOf) : [];
	return segments.length > 0 ? { segments } : undefined;
}

function wordOf(item: unknown): Word[] {
	// Scribe v2 also lists sounds, such as "[gentle music]", as `audio_event` items.
	if (!isPlainObject(item) || (item.type ?? "word") !== "word") return [];
	const { word: text, start, end, speaker } = item;
	if (typeof text !== "string" || typeof start !== "number" || typeof end !== "number") {
		return [];
	}
	return [
		{
			text,
			start,
			end,
			speaker:
				typeof speaker === "number" || typeof speaker === "string"
					? `${speaker}`
					: undefined,
		},
	];
}

/**
 * Qwen3 ASR, and the servers that run it or Whisper, can list words without punctuation and
 * keep it in `text`, so each word takes its token from `text` when the two spell it alike.
 */
function punctuated(words: Word[], text: unknown): Word[] {
	if (typeof text !== "string" || words.some((word) => /[.,?!]/.test(word.text))) return words;
	const tokens = text.split(/\s+/).filter(Boolean);
	const bare = (token: string) => token.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
	let next = 0;
	return words.map((word) => {
		// A few tokens of lookahead get past a word `text` spells differently.
		for (let index = next; index < Math.min(tokens.length, next + 3); index++) {
			if (bare(tokens[index]) !== bare(word.text)) continue;
			next = index + 1;
			return { ...word, text: tokens[index] };
		}
		return word;
	});
}

function segmentOf(item: unknown): Segment[] {
	if (!isPlainObject(item)) return [];
	const { text, start, end } = item;
	return typeof text === "string" && typeof start === "number" && typeof end === "number"
		? [{ text, start, end }]
		: [];
}
