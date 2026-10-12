// Labels each cell of a table with three or more columns with its column
// header, so phones can show each row as a stacked entry (see custom.css).
// Settings tables also get fixed columns, so each one lines up with the next.
// Paths in any table may break after a slash, so they wrap in whole pieces.
const escapeAttribute = (text) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

const withPathBreaks = (html) =>
	html.replace(
		/<code([^>]*)>([^<]*)<\/code>/g,
		(code, attributes, text) => `<code${attributes}>${text.replaceAll("/", "/<wbr>")}</code>`,
	);

export function withStackedTables(html) {
	return html.replace(/<table([^>]*)>([\s\S]*?)<\/table>/g, (table, attributes, cells) => {
		const inner = withPathBreaks(cells);
		const headers = [...inner.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((match) =>
			match[1].replace(/<[^>]+>/g, "").trim(),
		);
		if (headers.length < 3) return `<table${attributes}>${inner}</table>`;
		const body = inner.replace(/<tr>([\s\S]*?)<\/tr>/g, (row, rowCells) => {
			let column = 0;
			const labeled = rowCells.replace(
				/<td([^>]*)>/g,
				(cell, cellAttributes) =>
					`<td${cellAttributes} data-label="${escapeAttribute(headers[column++] ?? "")}">`,
			);
			return `<tr>${labeled}</tr>`;
		});
		const settings = headers.join("|") === "Setting|Default|What it does" ? " settings" : "";
		return `<table${attributes} class="stack${settings}">${body}</table>`;
	});
}
