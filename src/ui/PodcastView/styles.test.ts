// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postcss, { type AtRule, type Node } from "postcss";
import { compile } from "svelte/compiler";
import { describe, expect, test } from "vitest";
import { componentCss, styled } from "../../../tests/mocks/componentCss";

const REDUCE = "(prefers-reduced-motion: reduce)";
const UI = path.resolve(import.meta.dirname, "..");

/** `html` in the view, with `{}` standing for the component's own scoping class. */
const inView = (component: string, html: string) =>
	`<div class="podcast-view pn-PodcastView">${html.replaceAll("{}", `pn-${component}`)}</div>`;

describe("reduced motion", () => {
	test.each([
		[
			"the play button",
			"Deck",
			'<div class="pn-deck {}"><button class="pn-play"></button></div>',
			".pn-play",
			["transform 120ms ease", ""],
		],
		[
			"a podcast card",
			"LibraryPage",
			'<div class="pn-grid {}"><button class="pn-gridcard"></button></div>',
			".pn-gridcard",
			["transform 120ms ease", ""],
		],
		[
			"a playing row's bars",
			"EpisodeRow",
			'<div class="pn-ep {}"><span class="pn-eq"><i></i></span></div>',
			".pn-eq i",
			["", "pn-eq 1s ease-in-out infinite"],
		],
	])(
		"%s stops moving when the user prefers reduced motion",
		(_name, component, html, selector, moving) => {
			const motion = (media: string[]) => {
				const css = componentCss(["PodcastView", component], { media });
				const { transition, animation } = getComputedStyle(
					styled(css, inView(component, html), selector),
				);
				return [transition, animation];
			};

			expect([motion([]), motion([REDUCE])]).toEqual([moving, ["none", "none"]]);
		},
	);
});

describe("focus ring", () => {
	test("draws the video's play button ring inside the frame that clips it, and others outside", () => {
		const css = componentCss(["PodcastView", "Player"], { states: ["focus-visible"] });
		styled(
			css,
			inView(
				"Player",
				'<section class="pn-player {}"><div class="pn-video"><button class="pn-vplay focus-visible"></button></div><button class="pn-iconbtn focus-visible"></button></section>',
			),
			".pn-vplay",
		);
		const ring = (selector: string) => {
			const { outline, outlineOffset } = getComputedStyle(document.querySelector(selector)!);
			return [outline, outlineOffset];
		};

		expect([ring(".pn-vplay"), ring(".pn-iconbtn")]).toEqual([
			["2px solid var(--interactive-accent)", "-2px"],
			["2px solid var(--interactive-accent)", "1px"],
		]);
	});
});

describe("hover", () => {
	const HOVER = "(hover: hover)";

	test("only a device that can hover lights up anything in the view", () => {
		const unguarded: string[] = [];
		for (const file of readdirSync(UI, { recursive: true, encoding: "utf8" })) {
			if (!file.endsWith(".svelte")) continue;
			const { css } = compile(readFileSync(path.join(UI, file), "utf8"), { css: "external" });
			postcss.parse(css?.code ?? "").walkRules((rule) => {
				let guarded = false;
				for (let at: Node | undefined = rule.parent; at; at = at.parent)
					if (at.type === "atrule" && (at as AtRule).params === HOVER) guarded = true;
				if (rule.selector.includes(":hover") && !guarded)
					unguarded.push(`${file} ${rule.selector}`);
			});
		}

		expect(unguarded).toEqual([]);
	});

	// % in each markup is where a hovered element takes the `hover` class.
	test.each([
		[
			"Back",
			"PodcastView",
			'<button class="pn-back%"></button>',
			".pn-back",
			"rgba(0, 0, 0, 0)",
		],
		["a row", "EpisodeRow", '<div class="pn-ep {}%"></div>', ".pn-ep", ""],
		[
			"the skip button",
			"Deck",
			'<div class="pn-deck {}"><button class="pn-skip%"></button></div>',
			".pn-skip",
			"",
		],
		[
			"the panel switch that is on",
			"Player",
			'<section class="pn-player {}"><button class="pn-sw%" aria-pressed="true"></button></section>',
			".pn-sw",
			"var(--background-modifier-border)",
		],
	])(
		"%s keeps its resting background after a tap",
		(_name, component, html, selector, resting) => {
			const background = (hovered: boolean, media: string[] = []) => {
				const css = componentCss(["PodcastView", component], { media, states: ["hover"] });
				const markup = inView(component, html.replace("%", hovered ? " hover" : ""));
				return getComputedStyle(styled(css, markup, selector)).background;
			};

			expect([background(false), background(true), background(true, [HOVER])]).toEqual([
				resting,
				resting,
				"var(--background-modifier-hover)",
			]);
		},
	);
});

describe("the transcript's note button", () => {
	test("shows only its icon in a compact panel's head, and its label in an empty panel", () => {
		const css = componentCss(["PodcastView", "TranscriptPanel"]);
		const button =
			'<button class="pn-btn pn-tx-save"><span></span><span>Open note</span></button>';
		styled(
			css,
			`<div class="podcast-view is-compact pn-PodcastView"><div class="pn-tx pn-TranscriptPanel"><div class="pn-panel-head">${button}</div><div class="pn-panel-empty">${button}</div></div></div>`,
			".pn-tx",
		);
		const label = (place: string) =>
			getComputedStyle(document.querySelector(`.${place} .pn-tx-save span:last-child`)!)
				.display;

		expect([label("pn-panel-head"), label("pn-panel-empty")]).toEqual(["none", "inline"]);
	});
});
