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
	test("in a narrow panel's head, clips its label out of sight but keeps it as its name, and shows it in an empty panel", () => {
		const css = componentCss(["PodcastView", "TranscriptPanel"], {
			media: ["(width < 340px)"],
		});
		const button =
			'<button class="pn-btn pn-tx-save"><span></span><span>Open note</span></button>';
		styled(
			css,
			`<div class="podcast-view pn-PodcastView"><div class="pn-tx pn-TranscriptPanel"><div class="pn-panel-head">${button}</div><div class="pn-panel-empty">${button}</div></div></div>`,
			".pn-tx",
		);
		const label = (place: string) => {
			const { display, visibility, position, clipPath } = getComputedStyle(
				document.querySelector(`.${place} .pn-tx-save span:last-child`)!,
			);
			return { display, visibility, position, clipPath };
		};

		expect([label("pn-panel-head"), label("pn-panel-empty")]).toEqual([
			{
				display: "inline",
				visibility: "visible",
				position: "absolute",
				clipPath: "inset(50%)",
			},
			{ display: "inline", visibility: "visible", position: "static", clipPath: "none" },
		]);
	});
});

describe("on a tablet", () => {
	test("the rail's add button keeps its own padding over Obsidian's for every button", () => {
		const obsidian =
			".is-tablet button:not(.clickable-icon) { padding: var(--size-4-1) var(--size-4-5); }";
		// jsdom drops a var() in a shorthand, so Obsidian's 4 px spacing steps stand in.
		const css = (obsidian + componentCss(["PodcastView", "Rail"])).replace(
			/var\(--size-4-(\d)\)/g,
			(_, step: string) => `${Number(step) * 4}px`,
		);
		const { padding } = getComputedStyle(
			styled(
				css,
				`<div class="is-tablet">${inView("Rail", '<nav class="pn-rail {}"><button class="pn-railsearch"></button></nav>')}</div>`,
				".pn-railsearch",
			),
		);

		expect(padding).toBe("0px 8px");
	});
});

describe("the player's stage", () => {
	test("dresses its own artwork, not the covers of a panel's rows shown in it", () => {
		const css = componentCss(["PodcastView", "Player", "EpisodeRow"]);
		const tile = (id: string) => `<span id="${id}" class="pn-cover pn-filetile"></span>`;
		styled(
			css,
			`<div class="podcast-view pn-PodcastView"><section class="pn-player pn-Player"><div class="pn-stage">${tile("art")}<div class="pn-panel"><div class="pn-ep pn-EpisodeRow"><button class="pn-ep-main">${tile("row")}</button></div></div></div></section></div>`,
			"#art",
		);
		const look = (id: string) => {
			const style = getComputedStyle(document.getElementById(id)!);
			return { shadow: style.boxShadow, icon: style.getPropertyValue("--icon-size") };
		};

		expect([look("art"), look("row")]).toEqual([
			{ shadow: "var(--shadow-s)", icon: "25cqw" },
			{ shadow: "", icon: "18px" },
		]);
	});
});

describe("a disabled control", () => {
	test("shows at Obsidian's 0.4 for a disabled icon, dimmed once, hovered or not; the scrubber at its own 0.5", () => {
		const obsidian = 'button[disabled], button[aria-disabled="true"] { opacity: 0.7; }';
		const css =
			obsidian +
			componentCss(["PodcastView", "Player", "EpisodeRow", "Scrubber"], {
				media: ["(hover: hover)"],
				states: ["hover"],
			});
		styled(
			css,
			`<div class="podcast-view pn-PodcastView">
				<button id="icon" class="pn-iconbtn hover" disabled></button>
				<button id="cta" class="pn-btn mod-cta hover" disabled></button>
				<section class="pn-player pn-Player"><button id="switch" class="pn-sw hover" aria-pressed="true" disabled></button></section>
				<div class="pn-ep pn-EpisodeRow hover"><button id="row" class="pn-bare pn-ep-main" aria-disabled="true"><span id="cover" class="pn-cover"></span></button></div>
				<div id="scrub" class="pn-scrub pn-Scrubber" aria-disabled="true"></div>
			</div>`,
			"#icon",
		);
		const shown = (id: string) => {
			let opacity = 1;
			for (let at: Element | null = document.getElementById(id); at; at = at.parentElement)
				opacity *= parseFloat(getComputedStyle(at).opacity) || 1;
			return Math.round(opacity * 100) / 100;
		};

		expect(["icon", "cta", "switch", "row", "cover", "scrub"].map(shown)).toEqual([
			0.4, 0.4, 0.4, 0.4, 0.4, 0.5,
		]);
	});
});

describe("the search field", () => {
	test.each([
		["on a desktop", "", ""],
		["on a phone", "is-phone", ""],
		["on a phone's first run", "is-phone", "is-large"],
	])("%s, ends its text where the clear button starts", (_name, device, size) => {
		const css = componentCss(["PodcastView", "SearchField"]);
		styled(
			css,
			`<div class="${device}"><div class="podcast-view pn-PodcastView"><div class="pn-search pn-SearchField ${size}"><input class="pn-input"><button class="pn-iconbtn pn-clear"></button></div></div></div>`,
			".pn-input",
		);
		const { paddingRight } = getComputedStyle(document.querySelector(".pn-input")!);
		const { right, width } = getComputedStyle(document.querySelector(".pn-clear")!);

		expect(parseFloat(paddingRight)).toBeGreaterThanOrEqual(
			parseFloat(right) + parseFloat(width),
		);
	});
});
