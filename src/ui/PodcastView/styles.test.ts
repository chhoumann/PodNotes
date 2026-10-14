// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { componentCss, styled } from "../../../tests/mocks/componentCss";

const REDUCE = "(prefers-reduced-motion: reduce)";

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
			["", "pn-EpisodeRow-pn-eq 1s ease-in-out infinite"],
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
