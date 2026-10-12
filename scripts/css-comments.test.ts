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
});
