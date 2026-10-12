// A quoted string or a comment. Strings match first at their position, so
// comment-like text inside them is kept.
const STRING_OR_COMMENT =
	/("(?:[^"\\\n]|\\[\s\S])*"|'(?:[^'\\\n]|\\[\s\S])*')|\/\*(?!!)[\s\S]*?\*\//g;

/** Removes CSS comments, keeping license notices that start with `/*!`. */
export function stripCssComments(css: string): string {
	return css.replace(STRING_OR_COMMENT, (_match, quoted: string | undefined) => quoted ?? "");
}
