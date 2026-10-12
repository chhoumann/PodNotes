import { describe, expect, it } from "vitest";
import { stripCssComments } from "./css-comments";

describe("stripCssComments", () => {
	it("removes comments between rules and declarations", () => {
		expect(
			stripCssComments("/* card */ .a { /* why */ color: red; }\n/*\n * block\n */.b{}"),
		).toBe(".a { color: red; }.b{}");
	});

	it("keeps license notices, including one that contains a quote or a comment opener", () => {
		expect(stripCssComments("/*! MIT notice */.a{}/* note */")).toBe("/*! MIT notice */.a{}");
		expect(
			stripCssComments(
				"/*! author's notice /* inner */ .a::after { content: '/* literal */'; }",
			),
		).toBe("/*! author's notice /* inner */ .a::after { content: '/* literal */'; }");
	});

	it("keeps comment-like text inside quoted strings", () => {
		const css = `.a::after { content: "/* not a comment */"; } .b { content: '\\'/*'; } .c::after { content: "one \\\r\ntwo /* literal */"; }`;

		expect(stripCssComments(css)).toBe(css);
	});

	it("keeps comment-like text inside an unquoted url()", () => {
		const css = ".a { background-image: url(/a/*b*/c.png); }";

		expect(stripCssComments(css)).toBe(css);
	});

	it("keeps comments that separate tokens inside values and selectors", () => {
		const css =
			"div/**/p { color: r/**/ed; width: 1/**/px; --tokens: one/**/two; } .x /* c */ .y {}";

		expect(stripCssComments(css)).toBe(css);
	});

	it("removes a comment that contains a quote", () => {
		expect(stripCssComments(".a { /* the modal's own buttons */ color: red; }")).toBe(
			".a { color: red; }",
		);
	});
});
