// Labels each cell of a table with three or more columns with its column
// header, so phones can show each row as a stacked entry (see custom.css).
const escapeAttribute = (text) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

export function withStackedTables(html) {
	return html.replace(/<table([^>]*)>([\s\S]*?)<\/table>/g, (table, attributes, inner) => {
		const headers = [...inner.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((match) =>
			match[1].replace(/<[^>]+>/g, "").trim(),
		);
		if (headers.length < 3) return table;
		const body = inner.replace(/<tr>([\s\S]*?)<\/tr>/g, (row, cells) => {
			let column = 0;
			const labeled = cells.replace(
				/<td([^>]*)>/g,
				(cell, cellAttributes) =>
					`<td${cellAttributes} data-label="${escapeAttribute(headers[column++] ?? "")}">`,
			);
			return `<tr>${labeled}</tr>`;
		});
		return `<table${attributes} class="stack">${body}</table>`;
	});
}
