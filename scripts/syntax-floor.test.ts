import { describe, expect, it } from "vitest";
import { assertEs2021 } from "./syntax-floor";

describe("assertEs2021", () => {
	it("accepts ES2021 syntax such as logical assignment and optional chaining", () => {
		expect(() =>
			assertEs2021("main.js", "let a; a ??= {}; a?.b; module.exports = a;"),
		).not.toThrow();
	});

	it.each([
		["a class field", "class A { x = 1; }"],
		["a private method", "class A { #m() {} }"],
		["a class static block", "class A { static {} }"],
	])("rejects %s", (_name, code) => {
		expect(() => assertEs2021("main.js", code)).toThrow(
			/^main\.js uses syntax newer than ES2021/,
		);
	});
});
