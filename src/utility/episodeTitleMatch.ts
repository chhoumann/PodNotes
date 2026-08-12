/**
 * Token-overlap matching for episode titles that have been rearranged or
 * lightly rewritten (guest name moved, punctuation changed) while still
 * referring to the same episode.
 */

export const MIN_TITLE_SIMILARITY = 0.75;

export function titleTokens(title: string): Set<string> {
	const tokens = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.split(/\s+/)
		.filter(Boolean);

	return new Set(tokens);
}

function canonicalizeTokens(tokens: Set<string>): Set<string> {
	const canonical = new Set<string>();
	for (const token of tokens) {
		canonical.add(/^\d+$/.test(token) ? String(Number(token)) : token);
	}
	return canonical;
}

function numericTokens(tokens: Set<string>): Set<string> {
	const numbers = new Set<string>();
	for (const token of tokens) {
		if (/^\d+$/.test(token)) numbers.add(token);
	}
	return numbers;
}

function numericTokenSetsConflict(left: Set<string>, right: Set<string>): boolean {
	const a = numericTokens(left);
	const b = numericTokens(right);
	if (a.size === 0 || b.size === 0) return false;
	if (a.size !== b.size) return true;
	for (const value of a) {
		if (!b.has(value)) return true;
	}
	return false;
}

export function titleTokenSimilarity(left: string, right: string): number {
	const a = canonicalizeTokens(titleTokens(left));
	const b = canonicalizeTokens(titleTokens(right));
	if (a.size === 0 || b.size === 0) return 0;
	if (numericTokenSetsConflict(a, b)) return 0;

	let intersection = 0;
	for (const token of a) {
		if (b.has(token)) intersection += 1;
	}

	return intersection / (a.size + b.size - intersection);
}

/**
 * Return the single candidate whose title is a strong unique match for any of
 * `targets`. Ties (two candidates at the same top score) return undefined so
 * we never open or play the wrong episode.
 */
export function findUniqueTitleMatch<T>(
	targets: readonly string[],
	candidates: readonly T[],
	getTitle: (candidate: T) => string,
	minSimilarity = MIN_TITLE_SIMILARITY,
): T | undefined {
	const scored: Array<{ candidate: T; score: number }> = [];

	for (const candidate of candidates) {
		const title = getTitle(candidate);
		let score = 0;
		for (const target of targets) {
			score = Math.max(score, titleTokenSimilarity(target, title));
		}
		if (score >= minSimilarity) {
			scored.push({ candidate, score });
		}
	}

	if (scored.length === 0) return undefined;

	scored.sort((left, right) => right.score - left.score);
	if (scored.length > 1 && scored[0].score === scored[1].score) {
		return undefined;
	}

	return scored[0].candidate;
}
