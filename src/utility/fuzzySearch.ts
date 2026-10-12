/*
 * Ported from Fuse.js v7.5.0 (https://github.com/krisk/Fuse), Copyright Kiro Risk,
 * Apache License 2.0. Ported rather than rewritten so that search results rank
 * exactly as they did with Fuse.
 */

const THRESHOLD = 0.4;
const DISTANCE = 100;
const MAX_PATTERN_LENGTH = 32;
const TOKEN = /[^\t-\r \u00a0]+/g;

interface Chunk {
	pattern: string;
	alphabet: Map<string, number>;
	location: number;
}

/** Indices of the texts that match the query, best match first. */
export function fuzzySearch(
	query: string,
	texts: readonly string[],
	findAllMatches: boolean,
): number[] {
	if (!query.trim()) return texts.map((_, index) => index);

	const pattern = query.toLowerCase();
	const chunks = createChunks(pattern);
	const matches: { index: number; score: number }[] = [];
	texts.forEach((text, index) => {
		if (!text.trim()) return;
		const score = matchScore(text.toLowerCase(), pattern, chunks, findAllMatches);
		if (score === undefined) return;
		const fieldNorm = Math.round(1000 / Math.pow(text.match(TOKEN)?.length ?? 1, 0.5)) / 1000;
		matches.push({ index, score: Math.pow(score || Number.EPSILON, fieldNorm) });
	});
	return matches.sort((a, b) => a.score - b.score).map(({ index }) => index);
}

function createChunks(pattern: string): Chunk[] {
	const chunks: Chunk[] = [];
	const lastLocation = Math.max(0, pattern.length - MAX_PATTERN_LENGTH);
	for (let i = 0; i < pattern.length; i += MAX_PATTERN_LENGTH) {
		const location = Math.min(i, lastLocation);
		const chunk = pattern.slice(location, location + MAX_PATTERN_LENGTH);
		const alphabet = new Map<string, number>();
		for (let j = 0; j < chunk.length; j += 1) {
			alphabet.set(chunk[j], (alphabet.get(chunk[j]) ?? 0) | (1 << (chunk.length - j - 1)));
		}
		chunks.push({ pattern: chunk, alphabet, location });
	}
	return chunks;
}

function matchScore(
	text: string,
	pattern: string,
	chunks: Chunk[],
	findAllMatches: boolean,
): number | undefined {
	if (text === pattern) return 0;

	let isMatch = false;
	let totalScore = 0;
	for (const chunk of chunks) {
		const result = bitap(text, chunk, findAllMatches);
		isMatch = isMatch || result.isMatch;
		totalScore += result.score;
	}
	return isMatch ? totalScore / chunks.length : undefined;
}

function bitap(
	text: string,
	{ pattern, alphabet, location }: Chunk,
	findAllMatches: boolean,
): { isMatch: boolean; score: number } {
	const patternLen = pattern.length;
	const textLen = text.length;
	const expectedLocation = Math.max(0, Math.min(location, textLen));
	const score = (errors: number, currentLocation: number) =>
		errors / patternLen + Math.abs(expectedLocation - currentLocation) / DISTANCE;

	let threshold = THRESHOLD;
	for (
		let index = text.indexOf(pattern, expectedLocation);
		index > -1;
		index = text.indexOf(pattern, index + patternLen)
	) {
		threshold = Math.min(score(0, index), threshold);
	}

	let bestLocation = -1;
	let finalScore = 1;
	let binMax = patternLen + textLen;
	let lastBitArr: number[] = [];
	const mask = 1 << (patternLen - 1);
	for (let errors = 0; errors < patternLen; errors += 1) {
		let binMin = 0;
		let binMid = binMax;
		while (binMin < binMid) {
			if (score(errors, expectedLocation + binMid) <= threshold) binMin = binMid;
			else binMax = binMid;
			binMid = Math.floor((binMax - binMin) / 2 + binMin);
		}
		binMax = binMid;

		let start = Math.max(1, expectedLocation - binMid + 1);
		const finish = findAllMatches
			? textLen
			: Math.min(expectedLocation + binMid, textLen) + patternLen;
		// oxlint-disable-next-line unicorn/no-new-array -- A sparse array, as in Fuse: holes read as 0 in the bitwise operations, and it allocates faster than an Int32Array or Array.from.
		const bitArr: number[] = new Array(finish + 2);
		bitArr[finish + 1] = (1 << errors) - 1;
		for (let j = finish; j >= start; j -= 1) {
			const currentLocation = j - 1;
			const charMatch = alphabet.get(text[currentLocation]) ?? 0;
			bitArr[j] = ((bitArr[j + 1] << 1) | 1) & charMatch;
			if (errors) {
				bitArr[j] |= ((lastBitArr[j + 1] | lastBitArr[j]) << 1) | 1 | lastBitArr[j + 1];
			}
			if (bitArr[j] & mask) {
				finalScore = score(errors, currentLocation);
				if (finalScore <= threshold) {
					threshold = finalScore;
					bestLocation = currentLocation;
					if (bestLocation <= expectedLocation) break;
					start = Math.max(1, 2 * expectedLocation - bestLocation);
				}
			}
		}
		if (score(errors + 1, expectedLocation) > threshold) break;
		lastBitArr = bitArr;
	}
	return { isMatch: bestLocation >= 0, score: Math.max(0.001, finalScore) };
}
