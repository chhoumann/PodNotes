// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import * as obsidian from "obsidian";
import { get } from "svelte/store";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_SETTINGS } from "src/constants";
import type { ParsedFeedEpisodes } from "src/parser/feedDocumentParser";
import { FeedRepository } from "src/services/FeedRepository";
import type { Episode } from "src/types/Episode";
import type { PodcastFeed } from "src/types/PodcastFeed";
import { isPrivateFeedPlaceholder, privateFeedPlaceholder } from "src/utility/privateFeedUrl";
import { deferred, feedDocument, MemoryStorage } from "../../../tests/mocks/feeds";
import { createTestServices, type TestServices } from "../../../tests/mocks/services";
import WithServices from "../../../tests/mocks/WithServices.svelte";
import EpisodesPage from "./EpisodesPage.svelte";
import type { Page } from "./pages";

const show: PodcastFeed = {
	title: "Field Notes",
	url: "https://feeds.fieldnotes.test/rss",
	artworkUrl: "https://art.test/field-notes.jpg",
	author: "Maya Lind",
};

function episode(title: string, changes: Partial<Episode> = {}): Episode {
	return {
		title,
		streamUrl: `https://media.test/${encodeURIComponent(title)}.mp3`,
		url: `https://show.test/${encodeURIComponent(title)}`,
		description: "",
		content: "",
		podcastName: show.title,
		duration: 48 * 60,
		...changes,
	};
}

const load = vi.fn<(url: string) => Promise<ParsedFeedEpisodes>>();
let services: TestServices;
let dispose = () => {};

afterEach(() => {
	dispose();
	load.mockReset();
	vi.restoreAllMocks();
});

/** Renders `page` over a library of its own, whose feeds `load` answers. */
function renderPage(page: Page, feeds: PodcastFeed[] = [show]) {
	const repository = new FeedRepository({
		load: (url) => load(url),
		resolveUrl: (feed) =>
			isPrivateFeedPlaceholder(feed.url)
				? feed.urlSecretId
					? "https://private.test/rss"
					: null
				: feed.url,
		storage: new MemoryStorage(),
		cache: () => ({ enabled: false, ttlHours: 6 }),
		now: Date.now,
	});
	({ services, dispose } = createTestServices({ feeds: repository }));
	services.library.savedFeeds.set(Object.fromEntries(feeds.map((feed) => [feed.title, feed])));
	render(WithServices, { props: { services, component: EpisodesPage, props: { page } } });
	return services;
}

/** Renders a custom playlist of `episodes`, a list whose episodes the test controls. */
function renderPlaylist(episodes: Episode[]) {
	const shown = renderPage({ kind: "playlist", name: "Walks" });
	setPlaylist(episodes);
	return shown;
}

function setPlaylist(episodes: Episode[]) {
	services.library.playlists.set({
		Walks: { ...structuredClone(DEFAULT_SETTINGS.favorites), name: "Walks", episodes },
	});
}

const listed = () =>
	screen.queryAllByRole("listitem").map((row) => row.querySelector(".pn-ep-title")?.textContent);
const row = (title: string) => screen.getByRole("button", { name: new RegExp(`^${title}`) });

describe("a podcast's page", () => {
	test("is headed by the podcast's artwork, title and author", async () => {
		load.mockResolvedValue(feedDocument(show.title, [episode("First")]));
		renderPage({ kind: "feed", key: show.title });

		expect(screen.getByRole("heading", { name: "Field Notes" })).toBeInTheDocument();
		expect(screen.getByText("Maya Lind")).toBeInTheDocument();
		expect(await screen.findByText("First")).toBeInTheDocument();
	});

	test("says it is loading until the feed answers", async () => {
		const answer = deferred<ParsedFeedEpisodes>();
		load.mockReturnValue(answer.promise);
		renderPage({ kind: "feed", key: show.title });

		expect(await screen.findByRole("status")).toHaveTextContent("Loading episodes");
		answer.resolve(feedDocument(show.title, [episode("First")]));

		expect(await screen.findByText("First")).toBeInTheDocument();
		expect(screen.queryByRole("status")).toBeNull();
	});

	test("keeps its episodes when the feed fails, names the server, and retries", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		load.mockResolvedValueOnce(feedDocument(show.title, [episode("First")]));
		renderPage({ kind: "feed", key: show.title });
		await screen.findByText("First");

		load.mockRejectedValueOnce(
			new Error("HTTP 404 at https://feeds.fieldnotes.test/rss?token=x"),
		);
		await fireEvent.click(screen.getByRole("button", { name: "Refresh episodes" }));
		const banner = await screen.findByRole("alert");

		expect(banner).toHaveTextContent("Feed didn't load");
		expect(within(banner).getByText("feeds.fieldnotes.test")).toBeInTheDocument();
		expect(banner).not.toHaveTextContent("404");
		expect(listed()).toEqual(["First"]);

		load.mockResolvedValueOnce(feedDocument(show.title, [episode("Second"), episode("First")]));
		await fireEvent.click(within(banner).getByRole("button", { name: "Retry" }));

		await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
		expect(listed()).toEqual(["Second", "First"]);
		expect(load).toHaveBeenCalledTimes(3);
	});

	test("asks for a private feed's address where this device lacks it, instead of retrying", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		const patron = { ...show, title: "Patron", url: privateFeedPlaceholder("Patron") };
		renderPage({ kind: "feed", key: "Patron" }, [patron]);
		const setFeedAddress = vi.spyOn(services.actions, "setFeedAddress").mockResolvedValue();

		const banner = await screen.findByRole("alert");
		expect(banner).toHaveTextContent("Address not on this device");
		expect(within(banner).queryByRole("button", { name: "Retry" })).toBeNull();
		await fireEvent.click(within(banner).getByRole("button", { name: "Set feed address" }));

		expect(setFeedAddress).toHaveBeenCalledWith("Patron");
		expect(load).not.toHaveBeenCalled();
		expect(notice).not.toHaveBeenCalled();
	});

	test("names a private feed that failed without its address", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		load.mockRejectedValue(new Error("down"));
		const patron = {
			...show,
			title: "Patron",
			url: privateFeedPlaceholder("Patron"),
			urlSecretId: "podnotes-feed-url-1",
		};
		renderPage({ kind: "feed", key: "Patron" }, [patron]);

		const banner = await screen.findByRole("alert");
		expect(banner).toHaveTextContent("Private feed");
		expect(banner).not.toHaveTextContent("private.test");
		expect(within(banner).getByRole("button", { name: "Retry" })).toBeInTheDocument();
	});
});

describe("an episode list", () => {
	test("plays a tapped episode and opens the full player", async () => {
		renderPlaylist([episode("First"), episode("Second")]);
		await waitFor(() => expect(listed()).toEqual(["First", "Second"]));

		await fireEvent.click(row("Second"));

		expect(get(services.player.state).episode).toMatchObject({ title: "Second" });
		expect(services.navigation.current.expanded).toBe(true);
	});

	test("only opens the player for the episode it already has", async () => {
		renderPlaylist([episode("First")]);
		services.player.play(episode("First"));
		services.navigation.collapse();
		const play = vi.spyOn(services.player, "play");

		await fireEvent.click(await screen.findByRole("button", { name: "First, playing" }));

		expect(play).not.toHaveBeenCalled();
		expect(services.navigation.current.expanded).toBe(true);
	});

	test("plays a same-titled episode with other media, and marks only the one playing", async () => {
		const trailer = (n: number) =>
			episode("Trailer", { streamUrl: `https://media.test/trailer-${n}.mp3` });
		renderPlaylist([trailer(1), trailer(2)]);
		const [first, second] = await screen.findAllByRole("button", { name: /^Trailer/ });
		await fireEvent.click(first);
		services.navigation.collapse();

		await fireEvent.click(second);

		expect(get(services.player.state).episode).toEqual(trailer(2));
		expect(services.navigation.current.expanded).toBe(true);
		expect([first, second].map((button) => button.getAttribute("aria-label"))).toEqual([
			"Trailer",
			"Trailer, playing",
		]);
	});

	test("shows each episode's state in its row and its label", async () => {
		const [played, inProgress, fresh] = [episode("Played"), episode("Halfway"), episode("New")];
		renderPlaylist([played, inProgress, fresh]);
		services.library.playedEpisodes.set({
			"Field Notes::Played": {
				title: "Played",
				podcastName: show.title,
				time: 2880,
				duration: 2880,
				finished: true,
			},
			"Field Notes::Halfway": {
				title: "Halfway",
				podcastName: show.title,
				time: 840,
				duration: 2880,
				finished: false,
			},
		});
		services.rowHasNote.set(({ title }) => title === "New");

		expect(await screen.findByRole("button", { name: "Played, played" })).toBeInTheDocument();
		expect(row("Played").closest(".pn-ep")).toHaveClass("is-played");
		expect(row("Halfway, 34 min left")).toHaveTextContent("34 min left");
		expect(row("Halfway").querySelector(".pn-bar span")).toHaveStyle({
			width: `${(840 / 2880) * 100}%`,
		});
		expect(row("New, has note")).toHaveTextContent("48 min");
	});

	test("shows that an episode has a note once its note is written", async () => {
		renderPlaylist([episode("First")]);
		await screen.findByRole("button", { name: "First" });

		services.rowHasNote.set(() => true);

		expect(await screen.findByRole("button", { name: "First, has note" })).toBeInTheDocument();
	});

	test("filters by a search and says when nothing matches", async () => {
		renderPlaylist([episode("Reading slowly"), episode("Margin notes")]);
		await waitFor(() => expect(listed()).toHaveLength(2));

		await fireEvent.input(screen.getByRole("searchbox", { name: "Search episodes" }), {
			target: { value: "margin" },
		});
		expect(listed()).toEqual(["Margin notes"]);

		await fireEvent.input(screen.getByRole("searchbox", { name: "Search episodes" }), {
			target: { value: "zzzz" },
		});
		expect(screen.getByText("No episodes match")).toBeInTheDocument();
	});

	test("hides played episodes while hide played is pressed", async () => {
		renderPlaylist([episode("Played"), episode("New")]);
		services.library.playedEpisodes.set({
			"Field Notes::Played": {
				title: "Played",
				podcastName: show.title,
				time: 1,
				duration: 1,
				finished: true,
			},
		});
		const toggle = await screen.findByRole("button", { name: "Hide played episodes" });

		await fireEvent.click(toggle);

		expect(get(services.library.hidePlayedEpisodes)).toBe(true);
		expect(screen.getByRole("button", { name: "Show played episodes" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(listed()).toEqual(["New"]);
	});

	test("opens an episode's menu under its More button, a button beside the title, not over it", async () => {
		renderPlaylist([episode("A long title that would run under the button")]);
		const shown = vi.spyOn(obsidian.Menu.prototype, "showAtPosition");
		const titles = vi.spyOn(obsidian.MenuItem.prototype, "setTitle");
		const more = await screen.findByRole("button", {
			name: "More options for A long title that would run under the button",
		});
		more.getBoundingClientRect = () => ({ left: 280, bottom: 90 }) as DOMRect;

		await fireEvent.click(more);

		expect(more.closest(".pn-ep-main")).toBeNull();
		expect(more.previousElementSibling).toHaveClass("pn-ep-main");
		expect(shown).toHaveBeenCalledWith({ x: 280, y: 90, doc: document }, document);
		expect(titles.mock.calls[0]).toEqual(["Play"]);
	});

	test("opens the same menu where a row is right-clicked", async () => {
		renderPlaylist([episode("First")]);
		const shown = vi.spyOn(obsidian.Menu.prototype, "showAtPosition");

		await fireEvent.contextMenu(await screen.findByText("First"), { clientX: 12, clientY: 34 });

		expect(shown).toHaveBeenCalledWith({ x: 12, y: 34, doc: document }, document);
	});

	test("lists every episode, also two that share a podcast and a title", async () => {
		const rerun = (n: number) => episode("Rerun", { streamUrl: `https://media.test/${n}.mp3` });
		renderPlaylist([rerun(1), rerun(2)]);
		await waitFor(() => expect(listed()).toEqual(["Rerun", "Rerun"]));

		setPlaylist([rerun(3), rerun(2), rerun(1)]);

		await waitFor(() => expect(listed()).toEqual(["Rerun", "Rerun", "Rerun"]));
	});

	test("an episode that stays listed keeps its row, and its broken artwork, when an earlier one leaves", async () => {
		const art = (title: string) =>
			episode(title, { artworkUrl: `https://art.test/${title}.jpg` });
		renderPage({ kind: "latest" });
		load.mockResolvedValue(feedDocument(show.title, [art("First"), art("Second")]));
		await services.feeds.load([show.title], "network");
		const second = await screen.findByRole("button", { name: /^Second/ });
		await fireEvent.error(second.querySelector("img")!);
		expect(second.querySelector("img")).toBeNull();

		load.mockResolvedValue(feedDocument(show.title, [art("Second")]));
		await services.feeds.load([show.title], "network");

		await waitFor(() => expect(listed()).toEqual(["Second"]));
		expect(row("Second")).toBe(second);
		expect(second.querySelector("img")).toBeNull();
	});

	test("a Played record whose episode left every feed is dimmed and says why it does not play", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		renderPage({ kind: "played" });
		services.library.playedEpisodes.set({
			"Gone Show::Old Episode": {
				title: "Old Episode",
				podcastName: "Gone Show",
				time: 9,
				duration: 9,
				finished: true,
			},
		});
		const gone = await screen.findByRole("button", {
			name: "Old Episode, played, unavailable",
		});

		await fireEvent.click(gone);

		expect(gone).toHaveAttribute("aria-disabled", "true");
		expect(get(services.player.state).episode).toBeUndefined();
		expect(notice).toHaveBeenCalledWith(
			"This played episode is no longer available in current feeds.",
		);
		expect(screen.queryByRole("button", { name: /^Hide played/ })).toBeNull();
	});
});
