import { describe, expect, it } from "vitest";
import { withStackedTables } from "./tables.mjs";

const table = (headers, cells) =>
	`<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>` +
	`<tbody><tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr></tbody></table>`;

const labels = (html) => [...html.matchAll(/data-label="([^"]*)"/g)].map((match) => match[1]);

describe("withStackedTables", () => {
	it("labels each cell with its column header", () => {
		const html = withStackedTables(
			table(["Setting", "Default", "What it does"], ["A", "B", "C"]),
		);

		expect(labels(html)).toEqual(["Setting", "Default", "What it does"]);
		expect(html).toContain('class="stack settings"');
	});

	it("keeps no markup from a header with a nested tag in the label", () => {
		const html = withStackedTables(
			table(["<scr<b>ipt>x", "Default", "Notes"], ["A", "B", "C"]),
		);

		const [first] = labels(html);
		expect(first).not.toMatch(/[<>]/);
		expect(first).toBe("ipt&gt;x");
	});

	it("leaves tables with fewer than three columns unchanged", () => {
		const input = table(["Tag", "Value"], ["A", "B"]);

		expect(withStackedTables(input)).toBe(input);
	});
});
