// A quoted string or a comment, whichever starts first, so comment-like text
// inside strings and quotes inside comments are both left alone.
const STRING_OR_COMMENT =
	/("(?:[^"\\\r\n]|\\(?:\r\n|[\s\S]))*"|'(?:[^'\\\r\n]|\\(?:\r\n|[\s\S]))*')|\/\*[\s\S]*?\*\//g;

/** Removes CSS comments, keeping license notices that start with `/*!`. */
export function stripCssComments(css: string): string {
	return css.replace(STRING_OR_COMMENT, (match, quoted: string | undefined) =>
		quoted !== undefined || match.startsWith("/*!") ? match : "",
	);
}
