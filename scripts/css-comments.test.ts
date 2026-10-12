import { describe, expect, it } from "vitest";
import { stripCssComments } from "./css-comments";

describe("stripCssComments", () => {
	it("removes comments between and inside rules", () => {
		expect(
			stripCssComments("/* card */ .a { /* why */ color: red; }\n/*\n * block\n */.b{}"),
		).toBe(" .a {  color: red; }\n.b{}");
	});

	it("keeps license notices", () => {
		expect(stripCssComments("/*! MIT notice */.a{}/* note */")).toBe("/*! MIT notice */.a{}");
	});

	it("keeps comment-like text inside quoted strings", () => {
		expect(
			stripCssComments(
				`.a::after { content: "/* not a comment */"; } .b { content: '\\'/*'; }`,
			),
		).toBe(`.a::after { content: "/* not a comment */"; } .b { content: '\\'/*'; }`);
	});

	it("removes a comment that contains a quote", () => {
		expect(stripCssComments(".a { /* the modal's own buttons */ color: red; }")).toBe(
			".a {  color: red; }",
		);
	});

	it("keeps strings after a license notice that contains a quote", () => {
		expect(
			stripCssComments("/*! author's notice */ .a::after { content: '/* literal */'; }"),
		).toBe("/*! author's notice */ .a::after { content: '/* literal */'; }");
	});

	it("keeps a string that continues across a CRLF line break", () => {
		expect(stripCssComments('.a::after { content: "one \\\r\ntwo /* literal */"; }')).toBe(
			'.a::after { content: "one \\\r\ntwo /* literal */"; }',
		);
	});

	it("keeps a license notice that contains a comment opener whole", () => {
		expect(stripCssComments("/*! notice /* inner */ .a { color: red; } /* gone */")).toBe(
			"/*! notice /* inner */ .a { color: red; } ",
		);
	});
});
