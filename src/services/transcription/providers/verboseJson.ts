import { isPlainObject } from "src/persistence/codecUtils";
import type { PartTranscript, Segment, Word } from "./types";

/**
 * The times in an answer in OpenAI's verbose_json shape, which OpenRouter and OpenAI-compatible
 * servers answer in: its words when it lists any, else its segments, else undefined.
 */
export function verboseJsonTimes(answer: unknown): PartTranscript | undefined {
	if (!isPlainObject(answer)) return undefined;
	const words = Array.isArray(answer.words) ? answer.words.flatMap(wordOf) : [];
	if (words.length > 0) return { words: punctuated(joined(words), answer.text) };
	const segments = Array.isArray(answer.segments) ? answer.segments.flatMap(segmentOf) : [];
	return segments.length > 0 ? { segments } : undefined;
}

/**
 * Whisper lists each word with its leading space, and a piece without one continues the word
 * before it, as " sci" and "-fi" in "sci-fi". Lists of bare words are left as they are.
 */
function joined(words: Word[]): Word[] {
	if (!words.some((word) => /^\s/.test(word.text))) return words;
	const out: Word[] = [];
	for (const word of words) {
		const last = out[out.length - 1];
		if (last && !/^\s/.test(word.text)) {
			out[out.length - 1] = { ...last, text: last.text + word.text, end: word.end };
		} else {
			out.push(word);
		}
	}
	return out.map((word) => ({ ...word, text: word.text.trim() }));
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
	const keys = tokens.map(bare);
	const single = firstFrom(keys);
	const pair = firstFrom(keys.slice(1).map((key, index) => `${keys[index]} ${key}`));
	let next = 0;
	return words.map((word, index) => {
		const key = bare(word.text);
		const near = single(key, next);
		// A word `text` spells differently, such as "re-running" listed as "re" and "running",
		// matches no token. A token past the few after the last match counts only when the next
		// word follows it there too, which finds the words again after any stretch they leave out.
		const at =
			near !== undefined && near - next < 3
				? near
				: index + 1 < words.length
					? pair(`${key} ${bare(words[index + 1].text)}`, next)
					: undefined;
		if (at === undefined) return word;
		next = at + 1;
		return { ...word, text: tokens[at] };
	});
}

/**
 * Finds the first index at or after `from` that holds a key. Each call's `from` must be at least
 * the last one's, which lets every lookup together take time linear in the keys.
 */
function firstFrom(keys: string[]): (key: string, from: number) => number | undefined {
	const later = new Map<string, number[]>();
	for (let index = keys.length - 1; index >= 0; index--) {
		const list = later.get(keys[index]);
		if (list) list.push(index);
		else later.set(keys[index], [index]);
	}
	return (key, from) => {
		const list = later.get(key);
		while (list && list[list.length - 1] < from) list.pop();
		return list?.[list.length - 1];
	};
}

function segmentOf(item: unknown): Segment[] {
	if (!isPlainObject(item)) return [];
	const { text, start, end } = item;
	return typeof text === "string" && typeof start === "number" && typeof end === "number"
		? [{ text, start, end }]
		: [];
}
