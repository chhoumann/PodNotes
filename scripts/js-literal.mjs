/**
 * A JavaScript expression that evaluates to `value`, safe to splice into code that
 * Obsidian evaluates. JSON alone is not: U+2028 and U+2029 end a line in older
 * engines, and `<` or `>` can close a surrounding script tag.
 * @param {unknown} value
 * @returns {string}
 */
export function jsLiteral(value) {
	if (value === undefined) return "undefined";
	/** @type {string | undefined} */
	const json = JSON.stringify(value, (_key, /** @type {unknown} */ item) => {
		if (typeof item === "number" && (!Number.isFinite(item) || Object.is(item, -0)))
			throw new TypeError(`${Object.is(item, -0) ? "-0" : item} has no JSON literal.`);
		return item;
	});
	if (json === undefined) throw new TypeError(`${String(value)} has no JavaScript literal.`);
	return json.replace(
		/[<>\u2028\u2029]/g,
		(char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
	);
}
