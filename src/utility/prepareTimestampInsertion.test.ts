import { describe, expect, it } from "vitest";
import {
	escapeForTableCell,
	isInsideTable,
	isTableDelimiterRow,
	prepareTimestampForInsertion,
} from "./prepareTimestampInsertion";

// Build a line-accessor pair (getLine, lineCount) over an array of lines, the
// shape the editor exposes, so detection can be exercised without a real editor.
function fromLines(lines: string[]): {
	getLine: (line: number) => string;
	lineCount: number;
} {
	return { getLine: (line: number) => lines[line] ?? "", lineCount: lines.length };
}

const TABLE = ["| Time | Note |", "| ---- | ---- |", "| 0:00 | intro |", "| 1:23 | topic |"];

describe("isTableDelimiterRow", () => {
	it("recognises plain, aligned, and tight delimiter rows", () => {
		expect(isTableDelimiterRow("| --- | --- |")).toBe(true);
		expect(isTableDelimiterRow("| :--- | ---: | :--: |")).toBe(true);
		expect(isTableDelimiterRow("|---|---|")).toBe(true);
		expect(isTableDelimiterRow("   | ---- | ---- |   ")).toBe(true);
	});

	it("rejects content rows and pipe-free lines", () => {
		expect(isTableDelimiterRow("| Time | Note |")).toBe(false);
		expect(isTableDelimiterRow("| 0:00 | intro |")).toBe(false);
		// A bare thematic break / setext underline has no pipe and must not count.
		expect(isTableDelimiterRow("---")).toBe(false);
		expect(isTableDelimiterRow("")).toBe(false);
	});

	it("recognises a delimiter row nested in a blockquote or callout", () => {
		expect(isTableDelimiterRow("> | ---- | ---- |")).toBe(true);
		expect(isTableDelimiterRow(">| ---- | ---- |")).toBe(true);
		expect(isTableDelimiterRow("> > | --- | --- |")).toBe(true);
	});
});

describe("isInsideTable", () => {
	it("is true on the header, delimiter, and body rows", () => {
		const { getLine, lineCount } = fromLines(TABLE);
		expect(isInsideTable(getLine, lineCount, 0)).toBe(true);
		expect(isInsideTable(getLine, lineCount, 1)).toBe(true);
		expect(isInsideTable(getLine, lineCount, 2)).toBe(true);
		expect(isInsideTable(getLine, lineCount, 3)).toBe(true);
	});

	it("is false in ordinary prose, even when the line contains a pipe", () => {
		const lines = ["Some prose here.", "a | b is not a table", "More prose."];
		const { getLine, lineCount } = fromLines(lines);
		expect(isInsideTable(getLine, lineCount, 0)).toBe(false);
		expect(isInsideTable(getLine, lineCount, 1)).toBe(false);
		expect(isInsideTable(getLine, lineCount, 2)).toBe(false);
	});

	it("is false on a blank line separating a table from following text", () => {
		const lines = [...TABLE, "", "After the table."];
		const { getLine, lineCount } = fromLines(lines);
		expect(isInsideTable(getLine, lineCount, 4)).toBe(false);
		expect(isInsideTable(getLine, lineCount, 5)).toBe(false);
	});

	it("detects a table nested inside a callout/blockquote", () => {
		const lines = [
			"> [!note] Timestamps",
			"> | Time | Note |",
			"> | ---- | ----- |",
			"> | 0:00 | intro |",
		];
		const { getLine, lineCount } = fromLines(lines);
		expect(isInsideTable(getLine, lineCount, 1)).toBe(true);
		expect(isInsideTable(getLine, lineCount, 3)).toBe(true);
	});
});

describe("escapeForTableCell", () => {
	it("escapes unescaped pipes so they stay textual in a cell", () => {
		expect(escapeForTableCell("a | b")).toBe("a \\| b");
	});

	it("does not double-escape an already-escaped pipe", () => {
		expect(escapeForTableCell("a \\| b")).toBe("a \\| b");
	});

	it("escapes a live pipe that follows an escaped backslash (\\\\|)", () => {
		// `\\|` is an escaped backslash followed by a genuinely live pipe. A
		// naive `(?<!\\)` lookbehind sees the backslash and skips the pipe,
		// leaving it active and breaking the row. The even-length (2) backslash
		// run means the pipe is live and must be escaped.
		expect(escapeForTableCell("a\\\\|b")).toBe("a\\\\\\|b");
	});

	it("leaves a pipe escaped after an odd-length backslash run (\\\\\\|)", () => {
		// Three backslashes = an escaped backslash plus an already-escaped pipe;
		// the pipe must be left alone so the cell is never double-escaped.
		expect(escapeForTableCell("a\\\\\\|b")).toBe("a\\\\\\|b");
	});

	it("escapes both of two adjacent live pipes", () => {
		expect(escapeForTableCell("a||b")).toBe("a\\|\\|b");
	});

	it("collapses newlines (LF, CRLF, CR) to single spaces", () => {
		expect(escapeForTableCell("line1\nline2")).toBe("line1 line2");
		expect(escapeForTableCell("line1\r\nline2")).toBe("line1 line2");
		expect(escapeForTableCell("line1\rline2")).toBe("line1 line2");
	});

	it("leaves a plain timestamp link untouched", () => {
		const link = "[1:23](obsidian://podnotes?episodeName=Show&time=83)";
		expect(escapeForTableCell(link)).toBe(link);
	});
});

describe("prepareTimestampForInsertion", () => {
	it("escapes a pipe/newline capture when the cursor is in a table cell", () => {
		const { getLine, lineCount } = fromLines(TABLE);
		const result = prepareTimestampForInsertion("[1:23](x) | note\nmore", {
			getLine,
			lineCount,
			cursorLine: 2,
		});
		expect(result).toBe("[1:23](x) \\| note more");
	});

	it("leaves the default '- {{time}} ' style capture unchanged in a table", () => {
		const { getLine, lineCount } = fromLines(TABLE);
		const result = prepareTimestampForInsertion("- 0:01:23 ", {
			getLine,
			lineCount,
			cursorLine: 2,
		});
		expect(result).toBe("- 0:01:23 ");
	});

	it("never escapes outside a table", () => {
		const lines = ["Notes:", ""];
		const { getLine, lineCount } = fromLines(lines);
		const capture = "[1:23](x) | note\nmore";
		const result = prepareTimestampForInsertion(capture, {
			getLine,
			lineCount,
			cursorLine: 0,
		});
		expect(result).toBe(capture);
	});
});
