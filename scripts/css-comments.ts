import postcss from "postcss";

/**
 * Removes comments that sit between rules and declarations, keeping license
 * notices that start with `/*!`. Comments inside a selector or a value stay,
 * because removing one there can join two tokens into one.
 */
export function stripCssComments(css: string): string {
	const root = postcss.parse(css);
	root.walkComments((comment) => {
		if (!comment.text.startsWith("!")) comment.remove();
	});
	return root.toString();
}
