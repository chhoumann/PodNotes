// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/svelte";
import * as obsidian from "obsidian";
import { tick } from "svelte";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_SETTINGS } from "src/constants";
import { favorites, localFiles, queue, savedFeeds } from "src/store";
import type { Episode } from "src/types/Episode";
import {
	installResizeObserver,
	type FakeResizeObservers,
} from "../../../tests/mocks/resizeObserver";
import { createTestServices, type TestServices } from "../../../tests/mocks/services";
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
	savedFeeds.set({ [feed.title]: feed });
	({ services, doc, dispose } = createTestServices());
	widths = installResizeObserver();
});

afterEach(() => {
	widths.uninstall();
	dispose();
	savedFeeds.set({});
	localFiles.set(structuredClone(DEFAULT_SETTINGS.localFiles));
	queue.set(structuredClone(DEFAULT_SETTINGS.queue));
	favorites.set(structuredClone(DEFAULT_SETTINGS.favorites));
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
		await fireEvent.click(screen.getByAltText(feed.title));
		expect(button(`Back to Library`)).toBeInTheDocument();

		await fireEvent.click(button(/^Latest episodes/));

		expect(services.navigation.current.stack).toEqual([]);
		expect(screen.queryByRole("button", { name: /^Back to/ })).toBeNull();
		expect(button(/^Latest episodes/)).toHaveAttribute("aria-current", "page");
	});

	test("a saved page whose podcast is gone opens Latest episodes", async () => {
		services.navigation.restore({ kind: "feed", key: "Gone" });
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

describe("pages", () => {
	test("an episode's menu can move it in the queue on the Queue page only", async () => {
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
		savedFeeds.set({});
		renderView(820);

		expect(screen.getByRole("heading", { name: "Add your first podcast" })).toBeInTheDocument();
		expect(screen.queryByRole("navigation", { name: "PodNotes" })).toBeNull();

		savedFeeds.set({ [feed.title]: feed });
		await tick();
		expect(screen.queryByRole("heading", { name: "Add your first podcast" })).toBeNull();
		expect(screen.getByRole("heading", { name: "Podcasts" })).toBeInTheDocument();
	});

	test("a library of local files only is no first run", () => {
		savedFeeds.set({});
		localFiles.set({
			...structuredClone(DEFAULT_SETTINGS.localFiles),
			episodes: [{ ...episode, podcastName: "local file" }],
		});
		renderView();

		expect(screen.queryByRole("heading", { name: "Add your first podcast" })).toBeNull();
		expect(screen.getByRole("heading", { name: "Library" })).toBeInTheDocument();
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
		services.captureTimestamp.mockResolvedValueOnce("Episode 1 Launch");
		await fireEvent.click(button("Capture timestamp"));
		await tick();

		expect(services.captureTimestamp).toHaveBeenCalledTimes(2);
		expect(notice.mock.calls).toEqual([["Timestamp added to Episode 1 Launch"]]);
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
		const covered = [button(/^Latest episodes/), screen.getByAltText(feed.title)];

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
