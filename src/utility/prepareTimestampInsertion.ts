// Helpers for inserting a captured timestamp at the editor cursor without
// breaking the markdown around it. See issue #165: capturing a timestamp into a
// markdown table cell would land the text in the wrong cell, scatter the cursor,
// or break the row. The root causes were (1) deriving a position with
// `getCursor()` and feeding it to `replaceRange` + a hand-computed `setCursor`,
// which fights Obsidian's Live Preview table-editing widget, and (2) inserting
// raw `|`/newline characters that are structural inside a table.
//
// The command now inserts with `editor.replaceSelection` (which lets CodeMirror
// own cursor placement) and, when the cursor sits inside a table, runs the
// capture through `escapeForTableCell` so pipes and newlines stay textual.

/**
 * Strip a leading blockquote/callout marker chain (`>`, `> >`, ...) so a table
 * nested inside a callout or blockquote is detected the same as a top-level one.
 * Obsidian renders `> | a | b |` as a table inside the callout, so for cell
 * detection the `>` prefix is not part of the row.
 */
function stripBlockquotePrefix(line: string): string {
	return line.replace(/^\s*(?:>\s?)+/, "");
}

/** Does the line contain a table cell pipe, ignoring any blockquote prefix? */
function lineHasCellPipe(line: string): boolean {
	return stripBlockquotePrefix(line).includes("|");
}

/**
 * Is `line` a GFM table delimiter row (e.g. `| --- | :--: |`)? A delimiter row
 * is what distinguishes a real table from an ordinary line that merely contains
 * pipes, so it is the signal we key table detection on. Requires at least one
 * pipe so a bare `---` thematic break / setext underline is not misread. A
 * leading blockquote/callout marker is ignored so nested tables still match.
 */
export function isTableDelimiterRow(line: string): boolean {
	const trimmed = stripBlockquotePrefix(line).trim();
	if (!trimmed.includes("|")) return false;

	const cells = trimmed
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|");

	return cells.length > 0 && cells.every((cell) => /^\s*:?-+:?\s*$/.test(cell));
}

/**
 * Is the cursor inside a markdown table? True when the cursor line contains a
 * pipe and the contiguous block of pipe-bearing lines around it includes a
 * delimiter row. Scanning the block (rather than just an adjacent line) keeps
 * detection correct whether the cursor is on the header, the delimiter, or any
 * body row, while the "must contain a pipe" gate avoids escaping ordinary prose.
 * Blockquote/callout markers are ignored so tables nested in a callout match.
 */
export function isInsideTable(
	getLine: (line: number) => string,
	lineCount: number,
	cursorLine: number,
): boolean {
	const current = getLine(cursorLine);
	if (!current || !lineHasCellPipe(current)) return false;

	for (let i = cursorLine; i >= 0; i--) {
		const line = getLine(i);
		if (!line || !lineHasCellPipe(line)) break;
		if (isTableDelimiterRow(line)) return true;
	}

	for (let i = cursorLine; i < lineCount; i++) {
		const line = getLine(i);
		if (!line || !lineHasCellPipe(line)) break;
		if (isTableDelimiterRow(line)) return true;
	}

	return false;
}

/**
 * Make `text` safe to drop into a single table cell: collapse newlines to a
 * space (a raw newline would end the row) and escape any unescaped pipe (a raw
 * pipe would open a new column). Already-escaped pipes (`\|`) are left alone so
 * the cell is never double-escaped.
 */
export function escapeForTableCell(text: string): string {
	return text.replace(/\r\n?|\n/g, " ").replace(/(?<!\\)\|/g, "\\|");
}

/**
 * Resolve the exact string to insert for a captured timestamp: the raw capture
 * everywhere except inside a table cell, where it is escaped so the row stays
 * intact. Callers insert the result with `editor.replaceSelection`.
 */
export function prepareTimestampForInsertion(
	capture: string,
	context: {
		getLine: (line: number) => string;
		lineCount: number;
		cursorLine: number;
	},
): string {
	return isInsideTable(context.getLine, context.lineCount, context.cursorLine)
		? escapeForTableCell(capture)
		: capture;
}
