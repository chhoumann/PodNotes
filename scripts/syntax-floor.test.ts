import { describe, expect, it } from "vitest";
import { assertSupportedSyntax } from "./syntax-floor";

describe("assertSupportedSyntax", () => {
	it("accepts ES2020 syntax such as optional chaining, nullish coalescing and named groups", () => {
		expect(() =>
			assertSupportedSyntax(
				"main.js",
				"let a; a = a ?? {}; a?.b; module.exports = /(?<x>a)/;",
			),
		).not.toThrow();
	});

	it.each([
		["a nullish assignment", "let a; a ??= {};"],
		["an or assignment", "let a; a ||= {};"],
		["an and assignment", "let a; a &&= {};"],
		["a class field", "class A { x = 1; }"],
		["a private method", "class A { #m() {} }"],
		["a class static block", "class A { static {} }"],
		["a lookbehind", "module.exports = /(?<=a)b/;"],
		["a negative lookbehind", "module.exports = /(?<!a)b/;"],
	])("rejects %s", (_name, code) => {
		expect(() => assertSupportedSyntax("main.js", code)).toThrow(
			/^main\.js uses syntax newer than ES2020 or Safari 15/,
		);
	});
});
