import { describe, expect, it } from "vitest";
import { assertSupportedSyntax } from "./syntax-floor";

describe("assertSupportedSyntax", () => {
	it.each([
		["String.raw", "String.raw`text`;", 0],
		["a custom tag in an uncalled function", "function unused() { tag`text`; }", 20],
		["a tag after non-ASCII text", '"🎧"; tag`text`;', 8],
	])("rejects %s with its byte offset and eval-cache explanation", (_name, code, offset) => {
		expect(() => assertSupportedSyntax("main.js", code)).toThrow(
			`main.js contains a tagged template at byte offset ${offset}: tagged templates disable Obsidian's eval cache for the whole plugin; use a plain string`,
		);
	});

	it.each([
		["an untagged template literal", "const text = `hello ${name}`;"],
		["a tagged template inside a string", 'const text = "String.raw`text`";'],
		["a tagged template inside a comment", "/* tag`text` */ const text = 'text';"],
	])("accepts %s", (_name, code) => {
		expect(() => assertSupportedSyntax("main.js", code)).not.toThrow();
	});

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
