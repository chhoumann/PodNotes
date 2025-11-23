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

	let normalized: string;
	try {
		normalized = new URL(trimmed).toString();
	} catch {
		normalized = encodeWhitespace(trimmed);
	}

	const encoded = normalized;
	return encoded.replace(
		PARENTHESIS_REGEXP,
		(char) => PARENTHESIS_LOOKUP[char] ?? char,
	);
}

function encodeWhitespace(value: string): string {
	return value.replace(/\s/g, (char) =>
		`%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
	);
}
