import type { EditorPosition } from "obsidian";

/** Enough of CodeMirror for a capture and its Undo: text, a selection, offsets and ranges. */
export function fakeEditor(text: string, caret = text.length) {
	let value = text;
	let from = caret;
	let to = caret;
	const lines = () => value.split("\n");
	const pos = (offset: number) => {
		if (offset < 0 || offset > value.length)
			throw new RangeError(`Offset ${offset} is outside`);
		const before = value.slice(0, offset).split("\n");
		return { line: before.length - 1, ch: before[before.length - 1].length };
	};
	const offset = ({ line, ch }: EditorPosition) =>
		lines()
			.slice(0, line)
			.reduce((sum, text) => sum + text.length + 1, ch);
	return {
		getValue: () => value,
		getLine: (line: number) => lines()[line] ?? "",
		lineCount: () => lines().length,
		getCursor: (side?: "from" | "to") => pos(side === "from" ? from : to),
		getSelection: () => value.slice(from, to),
		setSelection(anchor: EditorPosition, head = anchor) {
			from = offset(anchor);
			to = offset(head);
		},
		replaceSelection: (replacement: string) => {
			value = value.slice(0, from) + replacement + value.slice(to);
			from = to = from + replacement.length;
		},
		posToOffset: offset,
		offsetToPos: pos,
		getRange: (start: EditorPosition, end: EditorPosition) =>
			value.slice(offset(start), offset(end)),
		replaceRange(replacement: string, start: EditorPosition, end = start) {
			value = value.slice(0, offset(start)) + replacement + value.slice(offset(end));
		},
	};
}

/**
 * A Live Preview cell has an editor of its own that holds its pipes unescaped, and Obsidian escapes
 * them as it writes the cell to the note at the offsets the cell had when it opened. An edit
 * made through the note's editor inside the cell reaches the cell only later, so here it
 * is dropped until Obsidian ends the cell.
 */
export function editInTableCell(note: ReturnType<typeof fakeEditor>, cell: string) {
	const start = note.getValue().indexOf(cell);
	note.setSelection(note.offsetToPos(start + cell.length));
	const escape = (text: string) =>
		text.replace(/(\\*)\|/g, (pipe, slashes: string) =>
			slashes.length % 2 ? pipe : `${slashes}\\|`,
		);
	const { replaceSelection, replaceRange: write } = note;
	const cellEditor = {
		text: cell,
		getValue() {
			return this.text;
		},
		replaceSelection(text: string) {
			const end = note.offsetToPos(start + escape(this.text).length);
			this.text += text;
			write(escape(this.text), note.offsetToPos(start), end);
		},
	};
	const inCell = (from: EditorPosition, to: EditorPosition) =>
		note.posToOffset(from) >= start &&
		note.posToOffset(to) <= start + escape(cellEditor.text).length;
	const tableCell = { editor: cellEditor, containerEl: { isConnected: true } };
	const editorComponent = {
		tableCell: tableCell as typeof tableCell | null,
		destroyTableCell() {
			editorComponent.tableCell = null;
			Object.assign(note, { replaceSelection, replaceRange: write });
		},
	};
	Object.assign(note, {
		editorComponent,
		replaceSelection: () => {},
		replaceRange(text: string, from: EditorPosition, to = from) {
			if (!inCell(from, to)) write(text, from, to);
		},
	});
	return tableCell;
}
