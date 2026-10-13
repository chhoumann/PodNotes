// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/svelte";
import * as obsidian from "obsidian";
import { tick } from "svelte";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_SETTINGS } from "src/constants";
import { favorites, localFiles, playedEpisodes, playlists, queue, savedFeeds } from "src/store";
import type { Episode } from "src/types/Episode";
import type { Playlist } from "src/types/Playlist";
import {
	installResizeObserver,
	type FakeResizeObservers,
} from "../../../tests/mocks/resizeObserver";
import {
	createTestServices,
	pluginLibrary,
	type TestLibrary,
	type TestServices,
} from "../../../tests/mocks/services";
import type { FakeDocument } from "../../../tests/mocks/fakeMedia";
import type { Keymap as FakeKeymap } from "../../../tests/mocks/obsidian";
import { openPopout } from "../../../tests/mocks/popout";
import PodcastView from "./PodcastView.svelte";

const feed = {
	title: "Test Podcast",
	url: "https://pod.example.com/feed.xml",
	artworkUrl: "https://pod.example.com/art.jpg",
};

const episode: Episode = {
	title: "Episode 1: Launch",
	streamUrl: "https://pod.example.com/audio.mp3",
	url: "https://pod.example.com/episode-1",
	description: "",
	content: "",
	podcastName: feed.title,
	artworkUrl: feed.artworkUrl,
};

let services: TestServices;
let doc: FakeDocument;
let dispose: () => void;
let widths: FakeResizeObservers;

beforeEach(() => {
	({ services, doc, dispose } = createTestServices());
	services.library.savedFeeds.set({ [feed.title]: feed });
	widths = installResizeObserver();
});

afterEach(() => {
	widths.uninstall();
	dispose();
	savedFeeds.set({});
	localFiles.set(structuredClone(DEFAULT_SETTINGS.localFiles));
	queue.set(structuredClone(DEFAULT_SETTINGS.queue));
	favorites.set(structuredClone(DEFAULT_SETTINGS.favorites));
	playlists.set({});
	playedEpisodes.set({});
	vi.restoreAllMocks();
});

function renderView(width?: number) {
	const result = render(PodcastView, { props: { services } });
	const view = result.container.querySelector<HTMLElement>(".podcast-view")!;
	if (width) widths.resize(view, width);
	return { ...result, view, resize: (to: number) => widths.resize(view, to) };
}

const button = (name: string | RegExp) => screen.getByRole("button", { name });
const scroller = () => document.querySelector<HTMLElement>(".pn-scroll")!;

/** Plays `episode` until the media reports it playing. */
function playing() {
	services.player.play(episode);
	doc.media.duration = 3600;
	doc.media.emit("loadedmetadata");
}

describe("navigation", () => {
	test("Back returns to the previous page where it was scrolled", async () => {
		renderView();
		scroller().scrollTop = 120;
		await fireEvent.scroll(scroller());

		await fireEvent.click(button(/^Latest episodes/));
		expect(screen.getByRole("heading", { name: "Latest episodes" })).toBeInTheDocument();
		expect(scroller().scrollTop).toBe(0);
		await fireEvent.click(button("Back to Library"));

		expect(services.navigation.current.page).toEqual({ kind: "library" });
		expect(screen.getByRole("heading", { name: "Library" })).toBeInTheDocument();
		expect(scroller().scrollTop).toBe(120);
	});

	test("a rail item clears the pages visited before it", async () => {
		renderView(820);
		await fireEvent.click(screen.getByRole("button", { name: feed.title }));
		expect(button(`Back to Library`)).toBeInTheDocument();

		await fireEvent.click(button(/^Latest episodes/));

		expect(services.navigation.current.stack).toEqual([]);
		expect(screen.queryByRole("button", { name: /^Back to/ })).toBeNull();
		expect(button(/^Latest episodes/)).toHaveAttribute("aria-current", "page");
	});

	test("a saved page whose podcast is gone opens Latest episodes", async () => {
		services.navigation.replace({ kind: "feed", key: "Gone" });
		renderView();
		await tick();

		expect(services.navigation.current.page).toEqual({ kind: "latest" });
		expect(screen.getByRole("heading", { name: "Latest episodes" })).toBeInTheDocument();
	});

	test("the view is compact below 560 px wide and has a rail from 560 px", async () => {
		const { view, resize } = renderView(559);
		expect(screen.queryByRole("navigation", { name: "PodNotes" })).toBeNull();
		expect(view).toHaveClass("is-compact");

		resize(560);
		await tick();
		expect(screen.getByRole("navigation", { name: "PodNotes" })).toBeInTheDocument();
		expect(view).toHaveClass("is-wide");

		resize(0);
		await tick();
		expect(view).toHaveClass("is-wide");
	});
});

describe("landmarks", () => {
	// Obsidian shows the nearest `aria-label` as a tooltip wherever the pointer rests.
	const labelledNonControls = () =>
		[...document.querySelectorAll(".podcast-view [aria-label]")]
			.filter((el) => !el.matches("button, input, select, textarea, a, [role]"))
			.map((el) => el.outerHTML.slice(0, 80));

	test("are named without an aria-label, which Obsidian would show as a tooltip", async () => {
		const { resize } = renderView(820);
		playing();
		await tick();
		expect(screen.getByRole("navigation", { name: "PodNotes" })).toBeInTheDocument();
		expect(screen.getByRole("region", { name: "Now playing" })).toBeInTheDocument();
		expect(labelledNonControls()).toEqual([]);

		resize(320);
		await tick();
		expect(screen.getByRole("navigation", { name: "Lists" })).toBeInTheDocument();
		expect(labelledNonControls()).toEqual([]);

		await fireEvent.click(button(`Open player: ${episode.title}`));
		expect(screen.getByRole("region", { name: "Player" })).toBeInTheDocument();
		expect(labelledNonControls()).toEqual([]);
	});
});

describe("library", () => {
	const walk = { ...episode, title: "A walk" };
	const playlist = (name: string, episodes: Episode[]) => ({
		...structuredClone(DEFAULT_SETTINGS.favorites),
		name,
		episodes,
	});
	const flair = (name: RegExp) => button(name).querySelector(".flair")?.textContent;

	test("is the one the view's services hold", async () => {
		const { library } = services;
		library.queue.update((list) => ({ ...list, episodes: [episode, walk] }));
		library.playlists.set({ Walks: playlist("Walks", [walk]) });
		library.localFiles.update((list) => ({ ...list, episodes: [walk] }));
		library.playedEpisodes.set({
			[`${feed.title}::${walk.title}`]: {
				title: walk.title,
				podcastName: feed.title,
				time: 60,
				duration: 60,
				finished: true,
			},
		});
		renderView(820);
		await tick();

		expect(screen.getByRole("button", { name: feed.title })).toBeInTheDocument();
		expect([/^Queue/, /^Playlists/, /^Local files/, /^Played/].map(flair)).toEqual([
			"2",
			"2",
			"1",
			"1",
		]);
		await fireEvent.click(button(/^Queue/));
		expect(screen.getByText(episode.title)).toBeInTheDocument();
		expect(screen.getByText(walk.title)).toBeInTheDocument();
		await fireEvent.click(button(/^Playlists/));
		await fireEvent.click(button("Walks"));
		expect(screen.getByRole("heading", { name: "Walks" })).toBeInTheDocument();
		expect(screen.getByText(walk.title)).toBeInTheDocument();
	});

	test("refreshes every podcast from the wide Library's head", async () => {
		const loads: unknown[] = [];
		vi.spyOn(services.feeds, "load").mockImplementation(async (keys, mode) => {
			loads.push([[...keys], mode]);
			return true;
		});
		renderView(820);
		await tick();

		await fireEvent.click(button("Refresh all feeds"));

		expect(loads.at(-1)).toEqual([[feed.title], "network"]);
	});

	test("is not the plugin's stores", async () => {
		const other = { ...feed, title: "Other Podcast" };
		savedFeeds.set({ [other.title]: other });
		queue.add(walk);
		playlists.set({ Runs: playlist("Runs", [walk]) });
		localFiles.set({ ...structuredClone(DEFAULT_SETTINGS.localFiles), episodes: [walk] });
		playedEpisodes.markAsPlayed(walk);
		renderView(820);
		await tick();

		expect(screen.getByRole("button", { name: feed.title })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: other.title })).toBeNull();
		expect([/^Queue/, /^Playlists/, /^Local files/, /^Played/].map(flair)).toEqual([
			undefined,
			"1",
			undefined,
			undefined,
		]);
		await fireEvent.click(button(/^Queue/));
		expect(screen.queryByText(walk.title)).toBeNull();
		await fireEvent.click(button(/^Playlists/));
		expect(button("Favorites")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Runs" })).toBeNull();
	});
});

describe("pages", () => {
	test("an episode's menu can move it in the queue on the Queue page only", async () => {
		// The menu reads the plugin's stores, so the view reads them too, as in the plugin.
		dispose();
		({ services, doc, dispose } = createTestServices({ library: pluginLibrary }));
		savedFeeds.set({ [feed.title]: feed });
		const second = { ...episode, title: "Episode 2" };
		queue.add(episode);
		queue.add(second);
		Object.assign(services.app, { vault: { getAbstractFileByPath: () => null } });
		const titles = vi.spyOn(obsidian.MenuItem.prototype, "setTitle");
		const menuOf = async (title: string) => {
			titles.mockClear();
			await fireEvent.contextMenu(screen.getByText(title));
			return titles.mock.calls.map(([shown]) => shown);
		};
		renderView();

		await fireEvent.click(button(/^Queue/));
		expect(await menuOf("Episode 2")).toContain("Move up in queue");

		await fireEvent.click(button("Back to Library"));
		await fireEvent.click(button(/^Playlists/));
		await fireEvent.click(button("Favorites"));
		favorites.update((playlist) => ({ ...playlist, episodes: [second] }));
		await tick();
		expect(await menuOf("Episode 2")).not.toContain("Move up in queue");
	});
});

describe("first run", () => {
	test("an empty library shows the podcast search instead of the library", async () => {
		services.library.savedFeeds.set({});
		renderView(820);

		expect(screen.getByRole("heading", { name: "Add your first podcast" })).toBeInTheDocument();
		expect(screen.queryByRole("navigation", { name: "PodNotes" })).toBeNull();

		services.library.savedFeeds.set({ [feed.title]: feed });
		await tick();
		expect(screen.queryByRole("heading", { name: "Add your first podcast" })).toBeNull();
		expect(screen.getByRole("heading", { name: "Podcasts" })).toBeInTheDocument();
	});

	const withEpisode = (list: Playlist) => ({ ...list, episodes: [episode] });
	test.each([
		["a queued episode", (library: TestLibrary) => library.queue.update(withEpisode)],
		["a favorite", (library: TestLibrary) => library.favorites.update(withEpisode)],
		[
			"a local file",
			(library: TestLibrary) =>
				library.localFiles.update((list) => ({
					...list,
					episodes: [{ ...episode, podcastName: "local file" }],
				})),
		],
		[
			"a custom playlist",
			(library: TestLibrary) =>
				library.playlists.set({
					Walks: { ...structuredClone(DEFAULT_SETTINGS.favorites), name: "Walks" },
				}),
		],
		[
			"a finished episode",
			(library: TestLibrary) =>
				library.playedEpisodes.set({
					[`${feed.title}::${episode.title}`]: {
						title: episode.title,
						podcastName: feed.title,
						time: 60,
						duration: 60,
						finished: true,
					},
				}),
		],
	])("a library of only %s is no first run", (_source, add) => {
		services.library.savedFeeds.set({});
		add(services.library);
		renderView();

		expect(screen.queryByRole("heading", { name: "Add your first podcast" })).toBeNull();
		expect(screen.getByRole("heading", { name: "Library" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "Podcasts" })).toBeInTheDocument();
	});
});

describe("mini player", () => {
	test("shows only while an episode is loaded, including one restored paused", async () => {
		renderView();
		expect(screen.queryByRole("region", { name: "Now playing" })).toBeNull();

		services.player.restore(episode);
		await tick();

		expect(screen.getByRole("region", { name: "Now playing" })).toBeInTheDocument();
		expect(button(`Open player: ${episode.title}`)).toBeInTheDocument();
		expect(button("Play")).toBeInTheDocument();
	});

	test("Timestamp names the note it added to", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		services.player.restore(episode);
		renderView();

		services.captureTimestamp.mockResolvedValueOnce(null);
		await fireEvent.click(button("Capture timestamp"));
		services.captureTimestamp.mockResolvedValueOnce({
			destination: "note",
			path: "PodNotes/Pod/Episode 1 Launch.md",
			text: "- 00:00:01\n",
			created: false,
		});
		await fireEvent.click(button("Capture timestamp"));
		await tick();

		expect(services.captureTimestamp).toHaveBeenCalledTimes(2);
		expect(notice.mock.calls).toEqual([["Timestamp added to Episode 1 Launch"]]);
	});

	test("tells assistive technology its progress, compact or wide", async () => {
		const { resize, view } = renderView(320);
		services.player.play(episode);
		doc.media.duration = 2700.4;
		doc.media.emit("loadedmetadata");
		doc.media.currentTime = 754.6;
		doc.media.emit("timeupdate");
		await tick();

		for (const width of [320, 820]) {
			resize(width);
			await tick();
			expect(view).toHaveClass(width < 560 ? "is-compact" : "is-wide");
			const bars = screen.getAllByRole("progressbar", { name: "Episode progress" });
			expect(bars).toHaveLength(1);
			expect(bars[0]).toHaveAttribute("aria-valuemin", "0");
			expect(bars[0]).toHaveAttribute("aria-valuemax", "2700");
			expect(bars[0]).toHaveAttribute("aria-valuenow", "754");
			expect(bars[0]).toHaveAttribute("aria-valuetext", "12:34 of 45:00");
		}
	});

	test("tells the minutes left, and nothing once none are left", async () => {
		renderView();
		playing();
		await tick();
		const nowPlaying = () => screen.getByRole("button", { name: /^Open player/ });
		doc.media.currentTime = 3000;
		doc.media.emit("timeupdate");
		await tick();
		expect(nowPlaying()).toHaveTextContent(`${feed.title} · 10 min left`);

		doc.media.currentTime = 3600;
		doc.media.emit("timeupdate");
		await tick();

		expect(nowPlaying()).not.toHaveTextContent("left");
		expect(nowPlaying()).toHaveTextContent(new RegExp(`${feed.title}$`));
	});
});

describe("full player", () => {
	test("collapsing it keeps playing, and opening or closing it never plays or pauses", async () => {
		renderView();
		playing();
		await tick();
		const play = vi.spyOn(doc.media, "play");
		const pause = vi.spyOn(doc.media, "pause");

		await fireEvent.click(button(`Open player: ${episode.title}`));
		expect(screen.getByRole("region", { name: "Player" })).toBeInTheDocument();
		await fireEvent.click(button("Collapse player"));

		expect(screen.queryByRole("region", { name: "Player" })).toBeNull();
		expect(screen.getByRole("region", { name: "Now playing" })).toBeInTheDocument();
		expect(get(services.player.state).status).toBe("playing");
		expect(doc.media.paused).toBe(false);
		expect(play).not.toHaveBeenCalled();
		expect(pause).not.toHaveBeenCalled();
	});

	test("any navigation collapses it", async () => {
		renderView(820);
		playing();
		services.navigation.expand();
		await tick();
		expect(screen.getByRole("region", { name: "Player" })).toBeInTheDocument();

		services.navigation.goRoot("queue");
		await tick();

		expect(screen.queryByRole("region", { name: "Player" })).toBeNull();
		expect(screen.getByRole("heading", { name: "Queue" })).toBeInTheDocument();
	});

	test("covers the page and the rail for the keyboard too, while it is open", async () => {
		renderView(820);
		playing();
		await tick();
		const covered = [
			button(/^Latest episodes/),
			screen.getByRole("button", { name: feed.title }),
		];

		await fireEvent.click(button(`Open player: ${episode.title}`));
		for (const el of covered) expect(el.closest("[inert]")).not.toBeNull();

		await fireEvent.click(button("Collapse player"));
		for (const el of covered) expect(el.closest("[inert]")).toBeNull();
	});

	test("collapsing it puts focus that was in it on the mini player, and takes no other focus", async () => {
		services.player.restore(episode);
		renderView();
		await tick();
		expect(document.activeElement).toBe(document.body);

		await fireEvent.click(button(`Open player: ${episode.title}`));
		await fireEvent.click(button("Collapse player"));
		await tick();
		expect(document.activeElement).toBe(button(`Open player: ${episode.title}`));

		const note = document.body.appendChild(document.createElement("textarea"));
		note.focus();
		services.navigation.expand();
		await tick();
		await fireEvent.click(button("Collapse player"));
		await tick();
		expect(document.activeElement).toBe(note);
		note.remove();
	});

	describe("Escape", () => {
		const dispatch = (event: KeyboardEvent) =>
			(services.app.keymap as unknown as FakeKeymap).dispatch(event);
		const escape = (target = document.activeElement ?? document.body) =>
			fireEvent.keyDown(target, { key: "Escape" });

		beforeEach(() => document.addEventListener("keydown", dispatch));
		afterEach(() => document.removeEventListener("keydown", dispatch));

		test("closes a menu over the player first, then collapses the player", async () => {
			renderView();
			playing();
			await tick();
			await fireEvent.click(button(`Open player: ${episode.title}`));
			expect(document.activeElement).toBe(button("Collapse player"));
			const menu = new obsidian.Scope(services.app.scope);
			menu.register(null, "Escape", () => false);
			services.app.keymap.pushScope(menu);

			await escape();
			expect(services.navigation.current.expanded).toBe(true);

			services.app.keymap.popScope(menu);
			await escape();
			expect(services.navigation.current.expanded).toBe(false);
			expect(screen.queryByRole("region", { name: "Player" })).toBeNull();
			expect(await escape()).toBe(true);
		});

		test("leaves a modal above the player when its window regains focus", async () => {
			renderView();
			playing();
			await tick();
			await fireEvent.click(button(`Open player: ${episode.title}`));
			const modal = new obsidian.Scope(services.app.scope);
			modal.register(null, "Escape", () => false);
			services.app.keymap.pushScope(modal);

			window.dispatchEvent(new Event("focus"));
			await escape();

			expect(services.navigation.current.expanded).toBe(true);
			services.app.keymap.popScope(modal);
		});

		test("typed outside the view stays there", async () => {
			const note = document.body.appendChild(document.createElement("textarea"));
			renderView();
			playing();
			await tick();
			note.focus();

			services.navigation.expand();
			await tick();
			expect(document.activeElement).toBe(note);

			expect(await escape()).toBe(true);
			expect(services.navigation.current.expanded).toBe(true);
			note.remove();
		});

		test("from outside the view passes through, even with focus left in the player", async () => {
			const note = document.body.appendChild(document.createElement("textarea"));
			renderView();
			playing();
			await tick();
			await fireEvent.click(button(`Open player: ${episode.title}`));
			expect(document.activeElement).toBe(button("Collapse player"));

			expect(await escape(note)).toBe(true);
			expect(services.navigation.current.expanded).toBe(true);
			note.remove();
		});

		test("follows the player to a popout window, and Escape in the main window passes it by", async () => {
			const popout = openPopout();
			popout.win.document.addEventListener("keydown", dispatch);
			const note = document.body.appendChild(document.createElement("textarea"));
			const { container } = renderView();
			playing();
			await tick();
			await fireEvent.click(button(`Open player: ${episode.title}`));

			popout.moveIn(container);
			expect(await escape(note)).toBe(true);
			expect(services.navigation.current.expanded).toBe(true);

			popout.focus();
			const collapseButton = within(container).getByRole("button", {
				name: "Collapse player",
			});
			collapseButton.focus();
			expect(await escape(collapseButton)).toBe(false);
			expect(services.navigation.current.expanded).toBe(false);
			note.remove();
		});
	});
});
