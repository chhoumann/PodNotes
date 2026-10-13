// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/svelte";
import * as obsidian from "obsidian";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_SETTINGS } from "src/constants";
import { favorites, playedEpisodes, playlists } from "src/store";
import type { Episode } from "src/types/Episode";
import type { Playlist } from "src/types/Playlist";
import {
	createTestServices,
	pluginLibrary,
	type TestServices,
} from "../../../tests/mocks/services";
import WithServices from "../../../tests/mocks/WithServices.svelte";
import PlaylistsPage from "./PlaylistsPage.svelte";

const episode = (title: string, duration?: number): Episode => ({
	title,
	streamUrl: `https://media.test/${title}.mp3`,
	url: "",
	description: "",
	content: "",
	podcastName: "Pod",
	duration,
});
const list = (name: string, episodes: Episode[] = [], icon = "list-music"): Playlist => ({
	...structuredClone(DEFAULT_SETTINGS.favorites),
	name,
	icon: icon as Playlist["icon"],
	episodes,
});

let services: TestServices;
let dispose = () => {};

beforeEach(() => {
	({ services, dispose } = createTestServices({ library: pluginLibrary }));
});

afterEach(() => {
	dispose();
	favorites.set(structuredClone(DEFAULT_SETTINGS.favorites));
	playlists.set({});
	playedEpisodes.set({});
	vi.restoreAllMocks();
});

const rows = () =>
	[...document.querySelectorAll(".pn-plrow")].map((row) => [
		row.querySelector(".t")?.textContent,
		row.querySelector(".s")?.textContent ?? null,
		row.querySelector(".pn-plicon")?.getAttribute("data-icon"),
	]);

function renderPage() {
	render(WithServices, { props: { services, component: PlaylistsPage } });
}

describe("the Playlists page", () => {
	test("lists Favorites with a heart, the user's playlists in order, then New playlist", () => {
		favorites.update((fav) => ({ ...fav, episodes: [episode("A", 45 * 60)] }));
		playlists.set({
			Walks: list("Walks", [episode("A", 45 * 60), episode("B")], "bike"),
			Runs: list("Runs"),
		});
		playedEpisodes.set({
			"Pod::B": {
				title: "B",
				podcastName: "Pod",
				time: 60,
				duration: 30 * 60,
				finished: false,
			},
		});
		renderPage();

		expect(rows()).toEqual([
			["Favorites", "1 episode · 45 min", "heart"],
			["Walks", "2 episodes · 1 h 15 min", "bike"],
			["Runs", "0 episodes", "list-music"],
			["New playlist", null, "plus"],
		]);
		expect(document.querySelector(".pn-plicon.is-fav")?.closest(".pn-plrow")).toHaveTextContent(
			"Favorites",
		);
	});

	test("a row opens its playlist", async () => {
		playlists.set({ Walks: list("Walks") });
		renderPage();

		await fireEvent.click(screen.getByRole("button", { name: /^Walks/ }));

		expect(services.navigation.current.page).toEqual({ kind: "playlist", name: "Walks" });
	});

	test("New playlist asks for a name and adds the playlist's row", async () => {
		renderPage();

		await fireEvent.click(screen.getByRole("button", { name: "New playlist" }));
		const prompt = within(document.body);
		await fireEvent.input(prompt.getByRole("textbox", { name: "Playlist name" }), {
			target: { value: "Commute" },
		});
		await fireEvent.keyDown(prompt.getByRole("textbox", { name: "Playlist name" }), {
			key: "Enter",
		});

		expect(await screen.findByRole("button", { name: /^Commute/ })).toBeInTheDocument();
		expect(get(playlists).Commute).toMatchObject({ icon: "list-music", episodes: [] });
		expect(services.navigation.current.page).toEqual({ kind: "library" });
	});

	test("a playlist of the user's opens its menu on right-click; Favorites has none", async () => {
		playlists.set({ Walks: list("Walks") });
		const titles = vi.spyOn(obsidian.MenuItem.prototype, "setTitle");
		renderPage();

		await fireEvent.contextMenu(screen.getByRole("button", { name: /^Favorites/ }));
		expect(titles).not.toHaveBeenCalled();
		await fireEvent.contextMenu(screen.getByRole("button", { name: /^Walks/ }));
		expect(titles.mock.calls).toEqual([["Delete playlist"]]);
	});
});
