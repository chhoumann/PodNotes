import { readFileSync } from "node:fs";
import path from "node:path";
import postcss, { type AtRule, type ChildNode, type Container } from "postcss";
import { compile } from "svelte/compiler";

const COMPONENTS = path.resolve(import.meta.dirname, "../../src/ui/PodcastView");

/**
 * The CSS of the view's components as jsdom cascades it. Each component is scoped by the
 * class `pn-<Component>`, so markup takes that class where its own sheet scopes an element.
 * Nesting is flattened, which jsdom lacks, and sheets keep the order given: shell first, as
 * it mounts first. jsdom applies no media or container query but `all`, so `media` names the
 * queries that match, as the user's device, setting or the container's size would make them.
 * `states` turns pseudo-classes such as `:focus-visible` into classes a test can set.
 */
export function componentCss(
	files: readonly string[],
	{ media = [], states = [] }: { media?: string[]; states?: string[] } = {},
): string {
	const out = postcss.root();
	const visit = (node: ChildNode, selectors: string[] | null, within: Container) => {
		if (node.type === "rule") {
			const own = selectors
				? selectors.flatMap((outer) =>
						node.selectors.map((inner) =>
							inner.includes("&")
								? inner.replaceAll("&", outer)
								: `${outer} ${inner}`,
						),
					)
				: node.selectors;
			const declarations = node.nodes.filter((child) => child.type === "decl");
			if (declarations.length > 0)
				within.append(
					postcss.rule({ selectors: own, nodes: declarations.map((d) => d.clone()) }),
				);
			for (const child of node.nodes) if (child.type !== "decl") visit(child, own, within);
		} else if (node.type === "atrule" && (node.name === "media" || node.name === "container")) {
			const query = media.includes(node.params) ? "all" : node.params;
			const copy = postcss.atRule({ name: "media", params: query });
			within.append(copy);
			for (const child of (node as AtRule).nodes ?? []) visit(child, selectors, copy);
		} else if (node.type === "atrule") within.append(node.clone());
	};
	for (const file of files) {
		const source = readFileSync(path.join(COMPONENTS, `${file}.svelte`), "utf8");
		const { css } = compile(source, { css: "external", cssHash: () => `pn-${file}` });
		postcss.parse(css?.code ?? "").each((node) => visit(node, null, out));
	}
	let text = out.toString();
	for (const state of states) text = text.replaceAll(`:${state}`, `.${state}`);
	return text;
}

/** Puts `css` and `html` in the test document, and returns the element `selector` finds. */
export function styled(css: string, html: string, selector: string): HTMLElement {
	const style = document.createElement("style");
	style.textContent = css;
	document.head.replaceChildren(style);
	document.body.innerHTML = html;
	return document.querySelector<HTMLElement>(selector)!;
}
