const PARENTHESIS_REGEXP = /[()]/g;
const PARENTHESIS_LOOKUP: Record<string, string> = {
	"(": "%28",
	")": "%29",
};

/**
 * Ensures URLs are safe to send over the network by percent-encoding
 * whitespace plus characters that certain private feed hosts require,
 * such as parentheses.
 */
export function encodeUrlForRequest(rawUrl: string): string {
	const trimmed = rawUrl.trim();
	if (!trimmed) return trimmed;

	let normalized = trimmed;
	try {
		normalized = decodeURI(trimmed);
	} catch {
		// If decoding fails we fall back to the trimmed value, which we will encode below.
	}

	const encoded = encodeURI(normalized);
	return encoded.replace(
		PARENTHESIS_REGEXP,
		(char) => PARENTHESIS_LOOKUP[char] ?? char,
	);
}
