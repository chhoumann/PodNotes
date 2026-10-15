import { compile, preprocess } from "svelte/compiler";
import { describe, expect, it } from "vitest";
import { stripCssComments } from "../../scripts/css-comments";
import { compactCss } from "../../scripts/compact-css";

describe("compactCss", () => {
	it("removes formatting around rules, at-rules, and ordinary declarations", () => {
		expect(compactCss("@media (width > 10px) { .a \n\t{ color: red; } }")).toBe(
			"@media (width > 10px){.a{color:red}}",
		);
	});

	it.each([
		['.a .b { content: "two  words"; }', '.a .b{content:"two  words"}'],
		[".a { width: calc(100% - 2px); }", ".a{width:calc(100% - 2px)}"],
		[".a { --empty: ; --tokens: one  two; }", ".a{--empty: ;--tokens: one  two}"],
		[".a { background: url(/a/*b*/c.png); }", ".a{background:url(/a/*b*/c.png)}"],
		[".a /**/ .b { color: r/**/ed; }", ".a /**/ .b{color:r/**/ed}"],
		["/*! Keep this */ .a { color: red; }", "/*! Keep this */.a{color:red}"],
		["@import url(example.css) screen;", "@import url(example.css) screen;"],
		[".a\u00a0{ color: red; }", ".a\u00a0{color:red}"],
		[".a { --empty: ; }", ".a{--empty: }"],
		[".a /* keep */ { color: red; }", ".a /* keep */ {color:red}"],
		[".a { color /* keep */ : red; }", ".a{color /* keep */ : red}"],
		[".a { color: red; background: blue; }", ".a{color:red;background:blue}"],
		[".a { color: red; /*! keep */ }", ".a{color:red/*! keep */}"],
		[" \n\t", ""],
	])("preserves tokens in %s", (input, expected) => {
		expect(compactCss(input)).toBe(expected);
		expect(compactCss(expected)).toBe(expected);
	});

	it("compiles compact CSS into the injected stylesheet without changing values", async () => {
		const source = `<div class="a">Example</div><style>
			.a { --empty: ; width: calc(100% - 2px); }
			@media (min-width: 10px) { .a { color: red; } }
		</style>`;
		const processed = await preprocess(source, {
			style: ({ content }) => ({ code: compactCss(stripCssComments(content)) }),
		});
		const result = compile(processed.code, {
			css: "injected",
			cssHash: () => "podnotes-test",
		});
		expect(result.js.code).toContain(".a.podnotes-test{--empty: ;width:calc(100% - 2px)}");
		expect(result.js.code).toContain("@media (min-width: 10px){.a.podnotes-test{color:red}");
		expect(result.js.code).toContain("$.append_styles");
	});
});
