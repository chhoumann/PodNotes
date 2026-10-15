import { jsLiteral, VIEW_TYPE } from "../runtime";

export type UiTarget = Readonly<{
	name: string;
	elements: string;
}>;

function byCss(name: string, selector: string, text?: string): UiTarget {
	const filter =
		text === undefined ? "" : `.filter((el) => el.textContent.trim() === ${jsLiteral(text)})`;
	return { name, elements: `[...document.querySelectorAll(${jsLiteral(selector)})]${filter}` };
}

function byAttribute(name: string, selector: string, attribute: string, value: string): UiTarget {
	return {
		name,
		elements: `[...document.querySelectorAll(${jsLiteral(`${selector}[${attribute}]`)})].filter((el) => el.getAttribute(${jsLiteral(attribute)}) === ${jsLiteral(value)})`,
	};
}

const QUEUE = '[role="list"][aria-label="Queue"]';
export const PLAYER_VIEW = `.workspace-leaf-content[data-type="${VIEW_TYPE}"] .podcast-view`;

function navItem(name: string, nav: string, label: string): UiTarget {
	return {
		name,
		elements: `[...document.querySelectorAll(${jsLiteral(`${PLAYER_VIEW} ${nav} button.pn-navitem`)})].filter((el) => el.querySelector(".lbl")?.textContent.trim() === ${jsLiteral(label)})`,
	};
}

export const ui = {
	firstRun: byCss("first run", `${PLAYER_VIEW} .pn-first-run h1`, "Add your first podcast"),
	firstRunSettings: byCss(
		"first run settings button",
		`${PLAYER_VIEW} .pn-first-run button[aria-label="PodNotes settings"]`,
	),
	libraryHead: byCss("Library page", `${PLAYER_VIEW} h1.pn-head-title`, "Library"),
	pageTitle: (title: string) =>
		byCss(`${title} page`, `${PLAYER_VIEW} :is(h1.pn-head-title, .pn-title h1)`, title),
	podcastPage: (title: string) => byCss(`${title}'s page`, `${PLAYER_VIEW} .pn-hero h1`, title),
	back: byCss("Back button", `${PLAYER_VIEW} .pn-head button[aria-label^="Back to "]`),
	backTo: (label: string) =>
		byAttribute(`Back to ${label}`, `${PLAYER_VIEW} button`, "aria-label", `Back to ${label}`),
	listRow: (label: string) => navItem(`Library row ${label}`, ".pn-scroll > nav.pn-nav", label),
	rail: byCss("rail", `${PLAYER_VIEW} nav.pn-rail`),
	railItem: (label: string) => navItem(`rail item ${label}`, "nav.pn-rail", label),
	miniPlayer: byCss("mini player", `${PLAYER_VIEW} section.pn-mini`),
	openPlayer: byCss("mini player", `${PLAYER_VIEW} section.pn-mini button.pn-mini-open`),
	openPlayerFor: (title: string) =>
		byAttribute(
			`mini player of ${title}`,
			`${PLAYER_VIEW} section.pn-mini button`,
			"aria-label",
			`Open player: ${title}`,
		),
	miniPlay: byCss("mini player Play", `${PLAYER_VIEW} section.pn-mini button[aria-label="Play"]`),
	miniPlayback: byCss(
		"mini player play/pause",
		`${PLAYER_VIEW} section.pn-mini :is(button[aria-label="Play"], button[aria-label="Pause"])`,
	),
	fullPlayer: byCss("full player", `${PLAYER_VIEW} section.pn-player`),
	collapsePlayer: byCss(
		"Collapse player",
		`${PLAYER_VIEW} section.pn-player button[aria-label="Collapse player"]`,
	),
	podcastCard: (title: string): UiTarget => ({
		name: `podcast card ${title}`,
		elements: `[...document.querySelectorAll(${jsLiteral(`${PLAYER_VIEW} button.pn-gridcard`)})].filter((button) => ${jsLiteral([title, `${title}, feed didn't load`])}.includes(button.getAttribute("aria-label")))`,
	}),
	failedPodcastCard: (title: string) =>
		byAttribute(
			`podcast card ${title} with its feed error badge`,
			`${PLAYER_VIEW} button.pn-gridcard`,
			"aria-label",
			`${title}, feed didn't load`,
		),
	episode: (title: string): UiTarget => ({
		name: `episode ${title}`,
		elements: `[...document.querySelectorAll(${jsLiteral(`${PLAYER_VIEW} .pn-ep-main`)})].filter((el) => !el.closest(".pn-player") && el.querySelector(".pn-ep-title")?.textContent.trim() === ${jsLiteral(title)})`,
	}),
	episodeLoading: byCss(
		"episode list loading",
		`${PLAYER_VIEW} .pn-count[role="status"]`,
		"Loading episodes",
	),
	noEpisodes: byCss("No episodes", `${PLAYER_VIEW} .pn-panel-empty`, "No episodes"),
	refreshEpisodes: byCss("Refresh episodes", `${PLAYER_VIEW} [aria-label="Refresh episodes"]`),
	podcastOptions: byCss(
		"Podcast options",
		`${PLAYER_VIEW} .pn-head button[aria-label="Podcast options"]`,
	),
	feedError: byCss("feed error banner", `${PLAYER_VIEW} .pn-banner[role="alert"]`),
	feedErrorAction: (label: string) =>
		byCss(
			`feed error banner ${label}`,
			`${PLAYER_VIEW} .pn-banner[role="alert"] button`,
			label,
		),
	playbackToggle: byCss(
		"full player's play/pause",
		`${PLAYER_VIEW} section.pn-player button.pn-play`,
	),
	playerControl: (label: string) =>
		byAttribute(
			`full player's ${label}`,
			`${PLAYER_VIEW} section.pn-player button`,
			"aria-label",
			label,
		),
	playerTitle: byCss("full player's title", `${PLAYER_VIEW} section.pn-player h2.pn-np-title`),
	playerPodcast: byCss(
		"full player's podcast link",
		`${PLAYER_VIEW} section.pn-player button.pn-np-pod`,
	),
	playerVolume: byCss("full player's volume", `${PLAYER_VIEW} section.pn-player button.pn-vol`),
	/** It reads Timestamp, then Added for a moment after a capture. */
	playerTimestamp: byCss(
		"full player's Timestamp",
		`${PLAYER_VIEW} section.pn-player button.pn-cap.mod-cta`,
	),
	volumeSlider: byCss(
		"volume slider",
		`${PLAYER_VIEW} section.pn-player input[type="range"][aria-label="Volume"]`,
	),
	playerPanel: (name: string) =>
		byCss(
			`player panel ${name}`,
			`${PLAYER_VIEW} section.pn-player :is(.pn-sw, .pn-tab)`,
			name,
		),
	miniCapture: byAttribute(
		"mini player's Capture timestamp",
		`${PLAYER_VIEW} section.pn-mini button`,
		"aria-label",
		"Capture timestamp",
	),
	episodeMenu: (title: string) =>
		byAttribute(
			`More options for ${title}`,
			`${PLAYER_VIEW} button`,
			"aria-label",
			`More options for ${title}`,
		),
	menuItem: (title: string): UiTarget => ({
		name: `menu item ${title}`,
		elements: `[...document.querySelectorAll(".menu .menu-item")].filter((el) => el.querySelector(".menu-item-title")?.textContent.trim() === ${jsLiteral(title)})`,
	}),
	fileExplorerItem: (filePath: string) =>
		byAttribute(`file explorer item ${filePath}`, ".nav-file-title", "data-path", filePath),
	leftDrawerToggle: byCss("left sidebar toggle", ".sidebar-toggle-button.mod-left"),
	ribbonAction: (label: string) =>
		byAttribute(`ribbon action ${label}`, ".side-dock-ribbon-action", "aria-label", label),
	readingLink: (text: string) =>
		byCss(
			`Reading view link ${text}`,
			".workspace-leaf.mod-active .markdown-reading-view a",
			text,
		),
	settingsSearch: byCss(
		"Settings search",
		'.modal.mod-settings input[placeholder="Search settings..."]',
	),
	settingsTab: (name: string) =>
		byCss(`settings tab ${name}`, ".modal.mod-settings .vertical-tab-nav-item", name),
	settingControl: (settingName: string, control: string): UiTarget => ({
		name: `${control} of setting ${settingName}`,
		elements: `[...document.querySelectorAll(".modal.mod-settings .setting-item")].filter((row) => row.querySelector(".setting-item-name")?.textContent.trim() === ${jsLiteral(settingName)}).map((row) => row.querySelector(${jsLiteral(control)})).filter(Boolean)`,
	}),
	settingHeading: (name: string) =>
		byCss(
			`settings heading ${name}`,
			".modal.mod-settings .setting-item-heading .setting-item-name",
			name,
		),
	/** First run's field, or Add podcast's in the head. They share the label. */
	podcastSearch: byCss(
		"podcast search",
		`${PLAYER_VIEW} input[aria-label="Search or paste a link"]`,
	),
	addPodcastButton: byCss(
		"Library's Add podcast",
		`${PLAYER_VIEW} .pn-head button[aria-label="Add podcast"]`,
	),
	railSearch: byCss("rail's Add podcast", `${PLAYER_VIEW} nav.pn-rail button.pn-railsearch`),
	addPodcast: (title: string) =>
		byAttribute(
			`Add ${title}`,
			`${PLAYER_VIEW} button.pn-result`,
			"aria-label",
			`Add ${title}`,
		),
	podcastViewport: byCss("PodNotes view", PLAYER_VIEW),
	headAction: (label: string) =>
		byAttribute(`${label} button`, `${PLAYER_VIEW} .pn-head button`, "aria-label", label),
	offlineStrip: byCss("Offline strip", `${PLAYER_VIEW} .pn-strip[role="status"]`, "Offline"),
	queueRow: (title: string): UiTarget => ({
		name: `queue row ${title}`,
		elements: `[...document.querySelectorAll(${jsLiteral(`${PLAYER_VIEW} ${QUEUE} .pn-ep`)})].filter((el) => el.querySelector(".pn-ep-title")?.textContent.trim() === ${jsLiteral(title)})`,
	}),
	queueGrip: (title: string): UiTarget => ({
		name: `grip of ${title}`,
		elements: `[...document.querySelectorAll(${jsLiteral(`${PLAYER_VIEW} ${QUEUE} button.pn-grip`)})].filter((el) => el.getAttribute("aria-label").startsWith(${jsLiteral(`Reorder ${title}, position `)}))`,
	}),
	playlistRow: (name: string): UiTarget => ({
		name: `playlist row ${name}`,
		elements: `[...document.querySelectorAll(${jsLiteral(`${PLAYER_VIEW} button.pn-plrow`)})].filter((el) => el.querySelector(".t")?.textContent.trim() === ${jsLiteral(name)})`,
	}),
	textPrompt: byCss("text prompt", ".modal.pn-prompt"),
	textPromptField: byCss("text prompt field", ".modal.pn-prompt input"),
	undo: (message: string): UiTarget => ({
		name: `Undo of "${message}"`,
		elements: `[...document.querySelectorAll(".notice")].filter((el) => el.textContent.trim().startsWith(${jsLiteral(message)})).map((el) => el.querySelector("button.pn-undo")).filter(Boolean)`,
	}),
	promptInput: byCss("prompt input", ".prompt .prompt-input"),
	suggestion: (text: string) => byCss(`suggestion ${text}`, ".prompt .suggestion-item", text),
	paletteCommand: (name: string): UiTarget => ({
		name: `palette command PodNotes: ${name}`,
		elements: `[...document.querySelectorAll(".prompt .suggestion-item")].filter((el) => el.querySelector(".suggestion-prefix")?.textContent === "PodNotes" && el.querySelector(".suggestion-title")?.textContent === ${jsLiteral(`PodNotes${name}`)})`,
	}),
	pageScroller: byCss("page scroller", `${PLAYER_VIEW} .pn-scroll`),
} as const;
