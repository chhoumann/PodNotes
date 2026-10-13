// @vitest-environment jsdom
import * as obsidian from "obsidian";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_SETTINGS } from "src/constants";
import {
	downloadedEpisodes,
	favorites,
	playedEpisodes,
	playlists,
	plugin,
	queue,
	savedFeeds,
} from "src/store";
import type { Episode } from "src/types/Episode";
import type { Playlist } from "src/types/Playlist";
import { privateFeedPlaceholder } from "src/utility/privateFeedUrl";
import {
	createTestServices,
	pluginLibrary,
	type TestServices,
} from "../../../tests/mocks/services";
import {
	anchorOf,
	episodeMenu,
	podcastMenu,
	showMenu,
	type EpisodeMenuOptions,
	type MenuAnchor,
	type MenuEntry,
} from "./menus";

const episode: Episode = {
	title: "Episode",
	streamUrl: "https://media.test/a.mp3",
	url: "https://show.test/a",
	description: "",
	content: "",
	podcastName: "Podcast",
	feedUrl: "https://show.test/feed.xml",
};
const at: MenuAnchor = { x: 3, y: 4, doc: document };

let services: TestServices;
let dispose: () => void;

const playlist = (name: string, episodes: Episode[] = []): Playlist => ({
	...structuredClone(DEFAULT_SETTINGS.favorites),
	name,
	icon: "list-music",
	episodes,
});

beforeEach(() => {
	({ services, dispose } = createTestServices({ library: pluginLibrary }));
	queue.set(structuredClone(DEFAULT_SETTINGS.queue));
	favorites.set(structuredClone(DEFAULT_SETTINGS.favorites));
	playlists.set({});
	playedEpisodes.set({});
	downloadedEpisodes.set({});
	savedFeeds.set({});
});

afterEach(() => {
	dispose();
	plugin.set(undefined as never);
	vi.restoreAllMocks();
});

function menu(target = episode, options: Partial<EpisodeMenuOptions> = {}) {
	return episodeMenu(target, services, { place: "list", at, ...options });
}
const titles = (entries: MenuEntry[]) =>
	entries.map((entry) => (entry === "separator" ? "---" : entry.title));
function choose(entries: MenuEntry[], title: string) {
	const entry = entries.find(
		(candidate) => candidate !== "separator" && candidate.title === title,
	);
	if (!entry || entry === "separator") throw new Error(`no ${title} in ${titles(entries)}`);
	entry.onClick();
	return entry;
}

describe("an episode's menu", () => {
	test("offers SPEC 5.1's actions in order", () => {
		expect(titles(menu())).toEqual([
			"Play",
			"Add to queue",
			"---",
			"Create note",
			"Download",
			"Add to Favorites",
			"Add to playlist",
			"---",
			"Mark as played",
			"Copy episode link",
		]);
	});

	test("offers to undo each state the episode is in", () => {
		services.player.play(episode);
		queue.add(episode);
		favorites.update((list) => ({ ...list, episodes: [episode] }));
		playedEpisodes.markAsPlayed(episode);
		downloadedEpisodes.addEpisode(episode, "Podcasts/Episode.mp3", 4);
		services.hasNote.mockReturnValue(true);

		expect(titles(menu())).toEqual([
			"Open player",
			"Remove from queue",
			"---",
			"Open note",
			"Remove download",
			"Remove from Favorites",
			"Add to playlist",
			"---",
			"Mark as unplayed",
			"Copy episode link",
		]);
	});

	test("Play plays the episode and opens the full player", () => {
		choose(menu(), "Play");

		expect(get(services.player.state).episode).toEqual(episode);
		expect(services.navigation.current.expanded).toBe(true);
	});

	test("Open player opens the current episode without playing it again", () => {
		services.player.play(episode);
		const play = vi.spyOn(services.player, "play");

		choose(menu(), "Open player");

		expect(play).not.toHaveBeenCalled();
		expect(services.navigation.current.expanded).toBe(true);
	});

	test("offers Play for a same-titled episode of the podcast with other media", () => {
		services.player.play(episode);

		expect(titles(menu({ ...episode, streamUrl: "https://media.test/b.mp3" }))[0]).toBe("Play");
	});

	test("adds a same-titled episode from another podcast to the queue, keeping both (#356)", () => {
		const fromOtherPodcast = { ...episode, podcastName: "Other Podcast" };
		queue.add(episode);

		choose(menu(fromOtherPodcast), "Add to queue");

		expect(get(queue).episodes.map(({ podcastName }) => podcastName)).toEqual([
			"Podcast",
			"Other Podcast",
		]);
		expect(titles(menu())).toContain("Remove from queue");
	});

	test("moves an episode in the queue only from a row of the queue", () => {
		const second = { ...episode, title: "Second" };
		queue.add(episode);
		queue.add(second);

		expect(titles(menu(second))).not.toContain("Move up in queue");
		const fromQueue = menu(second, { place: "queue" });
		expect(titles(fromQueue).slice(0, 5)).toEqual([
			"Play",
			"Remove from queue",
			"---",
			"Move to top of queue",
			"Move up in queue",
		]);
		choose(fromQueue, "Move to top of queue");
		expect(get(queue).episodes.map(({ title }) => title)).toEqual(["Second", "Episode"]);
	});

	test("in the full player offers neither Play nor Mark as played", () => {
		expect(titles(menu(episode, { place: "player" }))).toEqual([
			"Add to queue",
			"---",
			"Create note",
			"Download",
			"Add to Favorites",
			"Add to playlist",
			"---",
			"Copy episode link",
		]);
	});

	test("for a played episode that left every feed offers only its note, Favorites and played", () => {
		playedEpisodes.markAsPlayed(episode);

		expect(titles(menu(episode, { available: false }))).toEqual([
			"Create note",
			"Add to Favorites",
			"---",
			"Mark as unplayed",
		]);
	});

	test("marks a Played record unplayed under the key it is stored by", () => {
		playedEpisodes.set({
			[episode.title]: {
				title: episode.title,
				podcastName: "",
				time: 9,
				duration: 9,
				finished: true,
			},
		});

		choose(menu(episode, { playedKey: episode.title }), "Mark as unplayed");

		expect(get(playedEpisodes)[episode.title]).toMatchObject({ finished: false, time: 0 });
	});

	test("forgets a tracked local file from Local Files instead of offering a download", () => {
		const local = { ...episode, title: "Interview", podcastName: "local file" };
		expect(titles(menu(local))).not.toContain("Download");

		downloadedEpisodes.addEpisode(local, "Recordings/Interview.wav", 4);
		expect(titles(menu(local))).toContain("Remove from Local Files");
	});

	test("Favorites asks for the state the menu showed, so a second click changes nothing", () => {
		const entries = menu();
		choose(entries, "Add to Favorites");
		choose(entries, "Add to Favorites");

		expect(get(favorites).episodes).toEqual([episode]);
	});

	test("Add to playlist is there but disabled without a playlist of the user's", () => {
		const entry = choose(menu(), "Add to playlist");
		expect(entry).toMatchObject({ disabled: true });
	});

	/** Chooses Add to playlist and reads the second menu it opens. */
	function playlistMenu(entries: MenuEntry[]) {
		const shown = vi.spyOn(obsidian.Menu.prototype, "showAtPosition");
		const title = vi.spyOn(obsidian.MenuItem.prototype, "setTitle");
		const checked = vi.spyOn(obsidian.MenuItem.prototype, "setChecked");
		const click = vi.spyOn(obsidian.MenuItem.prototype, "onClick");
		choose(entries, "Add to playlist");
		expect(shown).toHaveBeenCalledWith(at, document);
		return title.mock.calls.map(([name], index) => ({
			name,
			checked: checked.mock.contexts.includes(title.mock.contexts[index]),
			click: click.mock.calls[index][0] as () => void,
		}));
	}

	test("Add to playlist lists each playlist, checked when the episode is in it", () => {
		playlists.set({ Walks: playlist("Walks", [episode]), Runs: playlist("Runs") });

		const [walks, runs] = playlistMenu(menu());
		expect([walks, runs].map(({ name, checked }) => [name, checked])).toEqual([
			["Walks", true],
			["Runs", false],
		]);
		runs.click();
		walks.click();

		expect(get(playlists).Runs.episodes).toEqual([episode]);
		expect(get(playlists).Walks.episodes).toEqual([]);
	});

	test("a playlist deleted while its menu was open stays deleted", () => {
		playlists.set({ Walks: playlist("Walks") });
		const [walks] = playlistMenu(menu());
		playlists.set({});

		walks.click();

		expect(get(playlists)).toEqual({});
	});

	test("Create note says what is missing when no note template is set", () => {
		const notice = vi.spyOn(obsidian, "Notice");
		plugin.update(
			(current) =>
				({
					...current,
					settings: { ...DEFAULT_SETTINGS, note: { path: "", template: "" } },
				}) as never,
		);

		choose(menu(), "Create note");

		expect(notice).toHaveBeenCalledWith("Please set a note path and template in the settings.");
	});

	test("Copy episode link copies a link that reopens the episode", async () => {
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

		choose(menu(), "Copy episode link");

		expect(writeText).toHaveBeenCalledWith(
			expect.stringMatching(
				/^obsidian:\/\/podnotes\?episodeName=Episode&url=https%3A%2F%2Fshow\.test%2Ffeed\.xml/,
			),
		);
	});

	test("offers no episode link for an episode opened by a private feed's own address", () => {
		const opened = { ...episode, feedUrl: "https://show.test/feed.xml?auth=s3cret" };
		const subscribed = { ...episode, feedUrl: privateFeedPlaceholder("Podcast") };
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

		expect(titles(menu(opened))).not.toContain("Copy episode link");
		choose(menu(subscribed), "Copy episode link");

		expect(writeText).toHaveBeenCalledWith(
			expect.stringContaining("url=podnotes-private-feed%3APodcast"),
		);
	});
});

describe("a podcast's menu", () => {
	const feed = { title: "Show", url: "https://show.test/feed.xml", artworkUrl: "" };

	beforeEach(() => {
		savedFeeds.set({ Show: feed, Other: { ...feed, title: "Other", url: "https://o.test/" } });
		Object.assign(services.app, { vault: { getAbstractFileByPath: () => null } });
		plugin.update((current) => ({ ...current, app: services.app }) as never);
	});

	test("offers the podcast note and removal, and a feed address only where it is missing", () => {
		expect(titles(podcastMenu("Show", services))).toEqual([
			"Create podcast note",
			"---",
			"Remove podcast",
		]);
		expect(podcastMenu("Show", services)[2]).toMatchObject({ warning: true });
	});

	test("removing the open podcast returns to the Library first", () => {
		services.navigation.go({ kind: "feed", key: "Show" });

		choose(podcastMenu("Show", services), "Remove podcast");

		expect(services.navigation.current).toMatchObject({ page: { kind: "library" }, stack: [] });
		expect(Object.keys(get(savedFeeds))).toEqual(["Other"]);
	});

	test("removing another podcast stays where the user is", () => {
		services.navigation.go({ kind: "feed", key: "Show" });

		choose(podcastMenu("Other", services), "Remove podcast");

		expect(services.navigation.current.page).toEqual({ kind: "feed", key: "Show" });
	});
});

describe("a menu", () => {
	test("opens where it was anchored, in that anchor's window", () => {
		const shown = vi.spyOn(obsidian.Menu.prototype, "showAtPosition");
		const popout = document.implementation.createHTMLDocument();

		showMenu([], { x: 12, y: 34, doc: popout });

		expect(shown).toHaveBeenCalledWith({ x: 12, y: 34, doc: popout }, popout);
	});

	test("marks checked, destructive and disabled items", () => {
		const checked = vi.spyOn(obsidian.MenuItem.prototype, "setChecked");
		const warning = vi.spyOn(obsidian.MenuItem.prototype, "setWarning");
		const disabled = vi.spyOn(obsidian.MenuItem.prototype, "setDisabled");
		const separator = vi.spyOn(obsidian.Menu.prototype, "addSeparator");
		const entry = { title: "x", icon: "x", onClick: () => {} } as const;

		showMenu(
			[
				entry,
				{ ...entry, checked: true },
				"separator",
				{ ...entry, warning: true, disabled: true },
			],
			at,
		);

		expect([checked, warning, disabled, separator].map((spy) => spy.mock.calls.length)).toEqual(
			[1, 1, 1, 1],
		);
	});

	test("opens at the pointer for a right-click and under a button for a click", () => {
		const button = document.body.appendChild(document.createElement("button"));
		button.getBoundingClientRect = () => ({ left: 7, bottom: 30 }) as DOMRect;
		const anchors: MenuAnchor[] = [];
		const record = (event: MouseEvent) => anchors.push(anchorOf(event));
		button.addEventListener("contextmenu", record);
		button.addEventListener("click", record);

		const rightClick = new MouseEvent("contextmenu", {
			clientX: 50,
			clientY: 60,
			cancelable: true,
		});
		button.dispatchEvent(rightClick);
		button.click();

		expect(anchors).toEqual([
			{ x: 50, y: 60, doc: document },
			{ x: 7, y: 30, doc: document },
		]);
		expect(rightClick.defaultPrevented).toBe(true);
		button.remove();
	});
});
