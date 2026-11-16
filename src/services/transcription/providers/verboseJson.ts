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

/** Tokens a word that matches no nearby token may be found again in, where the next words follow. */
const RESYNC_TOKENS = 200;

/**
 * A word that gains marks: letters and digits, with apostrophes, hyphens, or a number's
 * `.,:/` between them, and a currency sign before or `%` after, as "3.5", "$5" or "5%".
 */
const PLAIN_WORD = /^[$€£¥]?[\p{L}\p{N}]+(?:['’.,:/-][\p{L}\p{N}]+)*%?$/u;
/** Opening quotes and brackets, and the closing punctuation, a word takes from its token. */
const OPENING = '“"‘([¿¡「『《【（';
const CLOSING = '.,?!;:…—–”"’)\\]。，、？！；：」』》】）';
const LEADING = new RegExp(`^['${OPENING}]+`, "u");
/** None of `%` or `#`, which are words' own. */
const TRAILING = new RegExp(`['${CLOSING}]+$`, "u");
/** A mark before a word's first letter or digit or after its last. Apostrophes, as in "dogs'", do not count. */
const MARKS = `${OPENING}${CLOSING}`.replace(/[‘’]/g, "");
const EDGE_MARK = new RegExp(`^[^\\p{L}\\p{N}]*[${MARKS}]|[${MARKS}][^\\p{L}\\p{N}]*$`, "u");

/**
 * A word from a model that punctuates its words itself: one with a mark before its first
 * letter or digit or after its last, as ",world", "world." or "world.🙂", or a mark listed
 * as a word of its own.
 */
const punctuatedAlready = ({ text }: Word): boolean =>
	EDGE_MARK.test(text) || !/[\p{L}\p{N}]/u.test(text);

/**
 * Qwen3 ASR, and the servers that run it or Whisper, can list words without punctuation and
 * keep it in `text`. Words are matched to the text letter by letter, so the words "re" and
 * "running" both fall in the token "re-running,". A word keeps its own text and gains only
 * the punctuation around its token: the word that starts a token takes its opening quote,
 * and the one that ends it, its closing punctuation.
 */
function punctuated(words: Word[], text: unknown): Word[] {
	if (typeof text !== "string" || words.some(punctuatedAlready)) return words;
	// Chinese and Japanese put no space between sentences, so their marks end a token too.
	const tokens = text
		.replace(/[。，、？！；：」』》】）]+/gu, "$& ")
		.replace(/[「『《【（]+/gu, " $&")
		.split(/\s+/)
		.filter(Boolean);
	// Apostrophes count inside a word, so "we'll" is not "well", and not at its ends, where
	// they quote it, as in "'Hello".
	const bare = (token: string) =>
		token
			.toLowerCase()
			.replace(/[^\p{L}\p{N}']/gu, "")
			.replace(/^'+|'+$/g, "");
	const keys = tokens.map(bare);
	const wordKeys = words.map((word) => bare(word.text));
	/** Where word `w` ends when it starts at offset `o` of token `t`. */
	const step = (w: number, t: number, o: number): [number, number] | undefined => {
		const key = wordKeys[w];
		if (!key || t >= keys.length || !keys[t].startsWith(key, o)) return undefined;
		const end = o + key.length;
		return end === keys[t].length ? [t + 1, 0] : [t, end];
	};
	/** Whether the two words after `w` follow on from where `w` ends. */
	const followed = (w: number, at: [number, number]): boolean => {
		for (let n = w + 1; n <= w + 2 && n < words.length; n++) {
			const next = step(n, ...at);
			if (!next) return false;
			at = next;
		}
		return true;
	};
	let [t, o] = [0, 0];
	return words.map((word, w) => {
		// A word the text spells differently matches none of the next few tokens. A token past
		// them counts only where the next two words follow, which finds the words again after a
		// stretch of text they leave out, such as filler.
		let start: [number, number] | undefined;
		for (let p = t; p < Math.min(keys.length, t + 3) && !start; p++) {
			if (step(w, p, p === t ? o : 0)) start = [p, p === t ? o : 0];
		}
		for (let p = t + 3; p < Math.min(keys.length, t + RESYNC_TOKENS) && !start; p++) {
			const at = step(w, p, 0);
			if (at && followed(w, at)) start = [p, 0];
		}
		const at = start && step(w, ...start);
		if (!start || !at) return word;
		[t, o] = at;
		const token = tokens[start[0]];
		// Only a plain word gains marks, so one with a mark, a symbol or an emoji anywhere keeps
		// its text as given and gains no second mark.
		const plain = PLAIN_WORD.test(word.text);
		const lead = plain && start[1] === 0 ? (LEADING.exec(token)?.[0] ?? "") : "";
		const trail = plain && o === 0 ? (TRAILING.exec(token)?.[0] ?? "") : "";
		return { ...word, text: lead + word.text + trail };
	});
}

function segmentOf(item: unknown): Segment[] {
	if (!isPlainObject(item)) return [];
	const { text, start, end } = item;
	return typeof text === "string" && typeof start === "number" && typeof end === "number"
		? [{ text, start, end }]
		: [];
}
