// @vitest-environment jsdom
import * as obsidian from "obsidian";
import { get } from "svelte/store";
import { fireEvent, screen } from "@testing-library/svelte";
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
import { FeedRepository } from "src/services/FeedRepository";
import { isPrivateFeedPlaceholder, privateFeedPlaceholder } from "src/utility/privateFeedUrl";
import { feedDocument, MemoryStorage } from "../../../tests/mocks/feeds";
import {
	createTestServices,
	pluginLibrary,
	type TestServices,
} from "../../../tests/mocks/services";
import {
	anchorOf,
	episodeMenu,
	openEpisode,
	playlistMenu,
	podcastMenu,
	queueMenu,
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

	test("for a played episode that left every feed offers only Mark as unplayed", () => {
		playedEpisodes.markAsPlayed(episode);

		expect(titles(menu(episode, { resolved: false }))).toEqual(["Mark as unplayed"]);
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

	function secondMenu(entries: MenuEntry[]) {
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

	test("Add to playlist lists each playlist, checked when the episode is in it, then New playlist", () => {
		playlists.set({ Walks: playlist("Walks", [episode]), Runs: playlist("Runs") });
		const separators = vi.spyOn(obsidian.Menu.prototype, "addSeparator");

		const [walks, runs, add] = secondMenu(menu());
		expect([walks, runs, add].map(({ name, checked }) => [name, checked])).toEqual([
			["Walks", true],
			["Runs", false],
			["New playlist", false],
		]);
		expect(separators).toHaveBeenCalledTimes(1);
		runs.click();
		walks.click();

		expect(get(playlists).Runs.episodes).toEqual([episode]);
		expect(get(playlists).Walks.episodes).toEqual([]);
	});

	test("without a playlist, Add to playlist offers New playlist, which creates one holding the episode", async () => {
		const separators = vi.spyOn(obsidian.Menu.prototype, "addSeparator");
		const [add, ...rest] = secondMenu(menu());
		expect([add.name, rest]).toEqual(["New playlist", []]);
		expect(separators).not.toHaveBeenCalled();

		add.click();
		await fireEvent.input(screen.getByRole("textbox", { name: "Playlist name" }), {
			target: { value: "Walks" },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Create" }));

		await vi.waitFor(() => expect(get(playlists).Walks?.episodes).toEqual([episode]));
	});

	test("a playlist deleted while its menu was open stays deleted", () => {
		playlists.set({ Walks: playlist("Walks") });
		const [walks] = secondMenu(menu());
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

describe("opening an episode offline", () => {
	const other = { ...episode, title: "Other", streamUrl: "https://media.test/other.mp3" };
	const fetched = { ...episode, title: "Fetched", streamUrl: "https://media.test/fetched.mp3" };

	beforeEach(() => {
		services.player.play(episode);
		services.navigation.collapse();
		services.online.set(false);
	});

	test("refuses an episode with no copy, before the player queues the one playing", () => {
		const notice = vi.spyOn(obsidian, "Notice");

		openEpisode(services, other);

		expect(notice).toHaveBeenCalledWith("Not downloaded");
		expect(get(services.player.state).episode).toEqual(episode);
		expect(get(queue).episodes).toEqual([]);
		expect(services.navigation.current.expanded).toBe(false);
	});

	test("plays a downloaded episode, and opens the player for the one playing", () => {
		downloadedEpisodes.set({ Podcast: [{ ...fetched, filePath: "Fetched.mp3", size: 1 }] });
		const play = vi.spyOn(services.player, "play").mockReturnValue(true);

		openEpisode(services, episode);
		expect(services.navigation.current.expanded).toBe(true);
		openEpisode(services, fetched);

		expect(play.mock.calls).toEqual([[fetched]]);
	});

	test("a menu opened online refuses Play once the connection is gone", () => {
		services.online.set(true);
		const open = menu(other);
		services.online.set(false);

		choose(open, "Play");

		expect(get(services.player.state).episode).toEqual(episode);
	});
});

describe("a podcast's menu", () => {
	const feed = { title: "Show", url: "https://show.test/feed.xml", artworkUrl: "" };

	beforeEach(() => {
		savedFeeds.set({ Show: feed, Other: { ...feed, title: "Other", url: "https://o.test/" } });
		Object.assign(services.app, { vault: { getAbstractFileByPath: () => null } });
		plugin.update((current) => ({ ...current, app: services.app }) as never);
	});

	test("offers the podcast note, its public address and removal", () => {
		expect(titles(podcastMenu("Show", services))).toEqual([
			"Create podcast note",
			"Copy feed URL",
			"---",
			"Remove podcast",
		]);
		expect(podcastMenu("Show", services)[3]).toMatchObject({ warning: true });
	});

	test("Copy feed URL copies the address the feed has when it is clicked", async () => {
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
		const notice = vi.spyOn(obsidian, "Notice");
		const open = podcastMenu("Show", services);

		choose(open, "Copy feed URL");
		await vi.waitFor(() => expect(notice).toHaveBeenCalledWith("Feed URL copied"));
		savedFeeds.update((all) => ({
			...all,
			Show: {
				...feed,
				url: privateFeedPlaceholder("Show"),
				urlSecretId: "podnotes-feed-url-1",
			},
		}));
		choose(open, "Copy feed URL");

		expect(writeText.mock.calls).toEqual([["https://show.test/feed.xml"]]);
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

describe("a podcast's menu, by how its feed loaded", () => {
	beforeEach(async () => {
		dispose();
		vi.spyOn(console, "error").mockImplementation(() => {});
		const feeds = new FeedRepository({
			load: async (url) => {
				if (url.startsWith("https://down.")) throw new Error("503");
				return feedDocument("", []);
			},
			resolveUrl: (feed) =>
				feed.urlSecretId === "down"
					? "https://down.patron.test/feed.xml"
					: isPrivateFeedPlaceholder(feed.url)
						? null
						: feed.url,
			storage: new MemoryStorage(),
			cache: () => ({ enabled: false, ttlHours: 6 }),
			now: Date.now,
		});
		({ services, dispose } = createTestServices({ library: pluginLibrary, feeds }));
		Object.assign(services.app, { vault: { getAbstractFileByPath: () => null } });
		plugin.update((current) => ({ ...current, app: services.app }) as never);
		savedFeeds.set({
			Up: { title: "Up", url: "https://up.test/feed.xml", artworkUrl: "" },
			Down: { title: "Down", url: "https://down.test/feed.xml", artworkUrl: "" },
			Patron: {
				title: "Patron",
				url: privateFeedPlaceholder("Patron"),
				urlSecretId: "podnotes-feed-url-1",
				artworkUrl: "",
			},
			"Patron Down": {
				title: "Patron Down",
				url: privateFeedPlaceholder("Patron Down"),
				urlSecretId: "down",
				artworkUrl: "",
			},
		});
		await services.feeds.load(["Up", "Down", "Patron", "Patron Down"], "network");
	});

	test.each([
		["loaded", "Up", ["Create podcast note", "Copy feed URL", "---", "Remove podcast"]],
		[
			"failed",
			"Down",
			["Create podcast note", "Copy feed URL", "Edit feed URL", "---", "Remove podcast"],
		],
		[
			"has no address on this device",
			"Patron",
			["Create podcast note", "Set feed address", "---", "Remove podcast"],
		],
		["is private and failed", "Patron Down", ["Create podcast note", "---", "Remove podcast"]],
	])("of a feed that %s", (_, key, items) => {
		expect(titles(podcastMenu(key, services))).toEqual(items);
	});

	test("Edit feed URL asks for the failed feed's address", () => {
		const setFeedAddress = vi.spyOn(services.actions, "setFeedAddress").mockResolvedValue();

		choose(podcastMenu("Down", services), "Edit feed URL");

		expect(setFeedAddress).toHaveBeenCalledWith("Down");
	});
});

describe("a playlist's menu", () => {
	test("deletes the playlist, from its own page by going to Playlists first, with Undo", () => {
		const notice = vi.spyOn(obsidian, "Notice");
		playlists.set({ Walks: playlist("Walks"), Runs: playlist("Runs") });
		services.navigation.go({ kind: "playlist", name: "Runs" });

		expect(titles(playlistMenu("Runs", services))).toEqual(["Delete playlist"]);
		expect(playlistMenu("Runs", services)[0]).toMatchObject({ warning: true });
		choose(playlistMenu("Runs", services), "Delete playlist");

		expect(services.navigation.current.page).toEqual({ kind: "playlists" });
		expect(Object.keys(get(playlists))).toEqual(["Walks"]);
		(notice.mock.calls[0][0] as DocumentFragment).querySelector("button")?.click();
		expect(Object.keys(get(playlists))).toEqual(["Walks", "Runs"]);
	});

	test("deleting another playlist stays where the user is", () => {
		playlists.set({ Walks: playlist("Walks") });
		services.navigation.go({ kind: "queue" });

		choose(playlistMenu("Walks", services), "Delete playlist");

		expect(services.navigation.current.page).toEqual({ kind: "queue" });
		expect(get(playlists)).toEqual({});
	});
});

describe("the Queue page's menu", () => {
	const queueSettings = () => get(services.settings).autoQueue;

	test("offers the auto-queue preference, checked while it is on, and Clear queue", () => {
		queue.add(episode);

		expect(titles(queueMenu(services))).toEqual([
			"Queue episodes I switch from",
			"---",
			"Clear queue",
		]);
		expect(queueMenu(services)[0]).toMatchObject({ checked: true });
		expect(queueMenu(services)[2]).toMatchObject({ warning: true, disabled: false });
	});

	test("the preference item sets the opposite of what its menu showed, so a stale menu repeats", () => {
		const open = queueMenu(services);

		choose(open, "Queue episodes I switch from");
		expect(queueSettings()).toBe(false);
		expect(queueMenu(services)[0]).toMatchObject({ checked: false });
		choose(open, "Queue episodes I switch from");
		expect(services.setAutoQueue.mock.calls).toEqual([[false], [false]]);
	});

	test("Clear queue is disabled for an empty queue, and clears a full one", () => {
		expect(queueMenu(services)[2]).toMatchObject({ disabled: true });

		queue.add(episode);
		choose(queueMenu(services), "Clear queue");

		expect(get(queue).episodes).toEqual([]);
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
