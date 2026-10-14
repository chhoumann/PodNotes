import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type AST, parse } from "svelte/compiler";
import { describe, expect, test } from "vitest";

type Sources = Readonly<Record<string, string>>;
type Selector = AST.CSS.SimpleSelector | AST.CSS.RelativeSelector;

const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/ui");

function components(): Sources {
	return Object.fromEntries(
		readdirSync(UI, { recursive: true, encoding: "utf8" })
			.filter((file) => file.endsWith(".svelte"))
			.map((file) => [file, readFileSync(path.join(UI, file), "utf8")]),
	);
}

/**
 * The view's classes a component's sheet scopes to itself. A class under `:global(...)`,
 * or after a bare `:global`, is a reference to another component's element instead.
 */
function ownedClasses(file: string, source: string): Set<string> {
	const owned = new Set<string>();
	const visitList = (list: AST.CSS.SelectorList, global: boolean): boolean => {
		let opensGlobal = false;
		for (const complex of list.children) {
			let inGlobal = global;
			for (const relative of complex.children) {
				for (const simple of relative.selectors as Selector[]) {
					if (
						simple.type === "ClassSelector" &&
						!inGlobal &&
						/^(pn-|podcast-view$)/.test(simple.name)
					)
						owned.add(simple.name);
					if (simple.type !== "PseudoClassSelector") continue;
					if (simple.name === "global" && !simple.args) inGlobal = opensGlobal = true;
					else if (simple.args)
						visitList(simple.args, inGlobal || simple.name === "global");
				}
			}
		}
		return opensGlobal;
	};
	const visitBlock = (nodes: AST.CSS.Block["children"], global: boolean) => {
		for (const node of nodes) {
			if (node.type === "Rule")
				visitBlock(node.block.children, visitList(node.prelude, global) || global);
			else if (node.type === "Atrule" && node.block) visitBlock(node.block.children, global);
		}
	};
	const ast = parse(source, { filename: file, modern: true });
	if (ast.css) visitBlock(ast.css.children, false);
	return owned;
}

/** Classes that more than one component scopes to itself, with those components. */
function sharedOwners(sources: Sources): Record<string, string[]> {
	const owners = new Map<string, string[]>();
	for (const [file, source] of Object.entries(sources)) {
		for (const name of ownedClasses(file, source))
			owners.set(name, [...(owners.get(name) ?? []), file]);
	}
	return Object.fromEntries([...owners].filter(([, files]) => files.length > 1));
}

/** Elements with two tooltips: Obsidian shows an aria-label as one, and a title is another. */
function doubleTooltips(sources: Sources): string[] {
	const found: string[] = [];
	const visit = (node: unknown, file: string): void => {
		if (!node || typeof node !== "object") return;
		const { type, name, attributes } = node as {
			type?: string;
			name?: string;
			attributes?: Array<{ name?: string }>;
		};
		const names = attributes?.map((attribute) => attribute.name) ?? [];
		if (
			(type === "RegularElement" || type === "SvelteElement") &&
			names.includes("aria-label") &&
			names.includes("title")
		)
			found.push(`${file} <${name}>`);
		for (const [key, value] of Object.entries(node)) if (key !== "metadata") visit(value, file);
	};
	for (const [file, source] of Object.entries(sources))
		visit(parse(source, { filename: file, modern: true }).fragment, file);
	return found;
}

describe("component style sheets", () => {
	test("each of the view's classes is scoped by one component at most", () => {
		expect(sharedOwners(components())).toEqual({});
	});

	test("finds a class two components scope, also inside a media query or :is()", () => {
		expect(
			sharedOwners({
				"A.svelte": `<div class="pn-a"></div><style>.pn-a { color: red; } .pn-a:hover { color: blue; }</style>`,
				"B.svelte": `<i class="pn-a pn-b"></i><style>@media (hover: hover) { :is(.pn-a, .pn-b) { color: red; } }</style>`,
				"C.svelte": `<i class="pn-b pn-c"></i><style>.pn-c :is(.pn-b) { color: red; }</style>`,
			}),
		).toEqual({ "pn-a": ["A.svelte", "B.svelte"], "pn-b": ["B.svelte", "C.svelte"] });
	});

	test("lets other components refer to a class through :global", () => {
		expect(
			sharedOwners({
				"A.svelte": `<div class="pn-a"></div><style>.pn-a { color: red; }</style>`,
				"B.svelte": `<div class="pn-b"></div><style>.pn-b :global(.pn-a) { color: red; } .pn-b :global { .pn-a, .x:is(.pn-a) { color: red; } }</style>`,
				"C.svelte": `<div class="pn-c"></div><style>:global(.pn-a) .pn-c, .pn-c:global(.pn-a) { color: red; }</style>`,
			}),
		).toEqual({});
	});
});

describe("tooltips", () => {
	test("no element has both an aria-label and a title", () => {
		expect(doubleTooltips(components())).toEqual([]);
	});

	test("finds an element with both, also in a block or a snippet, and not a component's props", () => {
		expect(
			doubleTooltips({
				"A.svelte": `<button aria-label="Play" title="Play"></button><i title="Downloaded"></i>`,
				"B.svelte": `{#if on}{#snippet row()}<span aria-label={label} title={label}></span>{/snippet}{/if}`,
				"C.svelte": `<Cover title="Show" aria-label="Show" /><b aria-label="Name"></b>`,
			}),
		).toEqual(["A.svelte <button>", "B.svelte <span>"]);
	});
});
