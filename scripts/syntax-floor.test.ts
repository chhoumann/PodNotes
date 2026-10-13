import { describe, expect, it } from "vitest";
import { assertSafari15Syntax } from "./syntax-floor";

describe("assertSafari15Syntax", () => {
	it("accepts ES2021 syntax such as logical assignment and named groups", () => {
		expect(() =>
			assertSafari15Syntax("main.js", "let a; a ??= {}; a?.b; module.exports = /(?<x>a)/;"),
		).not.toThrow();
	});

	it.each([
		["a class field", "class A { x = 1; }"],
		["a private method", "class A { #m() {} }"],
		["a class static block", "class A { static {} }"],
		["a lookbehind", "module.exports = /(?<=a)b/;"],
		["a negative lookbehind", "module.exports = /(?<!a)b/;"],
	])("rejects %s", (_name, code) => {
		expect(() => assertSafari15Syntax("main.js", code)).toThrow(
			/^main\.js uses syntax Safari 15 cannot run/,
		);
	});
});
