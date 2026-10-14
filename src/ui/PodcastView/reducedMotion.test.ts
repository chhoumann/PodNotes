// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import postcss, { type Rule } from "postcss";
import { compile } from "svelte/compiler";
import { expect, test } from "vitest";

/**
 * The play button's computed transition under Deck's own styles. jsdom cascades them
 * once their nesting is flattened, and applies only `all` media, so `reduced` turns the
 * reduced-motion query into `all` the way the user's setting would make it match.
 */
function playTransition(reduced: boolean): string {
	const source = readFileSync(`${import.meta.dirname}/Deck.svelte`, "utf8");
	const { css } = compile(source, { css: "external", cssHash: () => "pn-test" });
	const sheet = postcss.parse(css?.code ?? "");
	const nested: Rule[] = [];
	sheet.walkRules((rule) => {
		if (rule.parent?.type === "rule") nested.push(rule);
	});
	const last = new Map<Rule, Rule>();
	for (const rule of nested) {
		const parent = rule.parent as Rule;
		rule.selectors = parent.selectors.flatMap((outer) =>
			rule.selectors.map((s) => `${outer} ${s}`),
		);
		(last.get(parent) ?? parent).after(rule);
		last.set(parent, rule);
	}
	const style = document.createElement("style");
	style.textContent = reduced
		? sheet.toString().replaceAll("(prefers-reduced-motion: reduce)", "all")
		: sheet.toString();
	document.head.replaceChildren(style);
	document.body.innerHTML =
		'<div class="pn-deck pn-test"><button class="pn-play"></button></div>';
	return getComputedStyle(document.querySelector(".pn-play")!).transition;
}

test("the play button presses without a transition when the user prefers reduced motion", () => {
	expect([playTransition(false), playTransition(true)]).toEqual(["transform 120ms ease", "none"]);
});
