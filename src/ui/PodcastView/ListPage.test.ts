// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import * as obsidian from "obsidian";
import { tick } from "svelte";
import { get } from "svelte/store";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_SETTINGS } from "src/constants";
import type { ParsedFeedEpisodes } from "src/parser/feedDocumentParser";
import { FeedRepository } from "src/services/FeedRepository";
import type { Episode } from "src/types/Episode";
import type { PodcastFeed } from "src/types/PodcastFeed";
import { isPrivateFeedPlaceholder } from "src/utility/privateFeedUrl";
import { feedDocument, MemoryStorage } from "../../../tests/mocks/feeds";
import { createTestServices, type TestServices } from "../../../tests/mocks/services";
import WithServices from "../../../tests/mocks/WithServices.svelte";
import ListPage from "./ListPage.svelte";
import type { ListPage as ListPageKind } from "./pages";

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

function renderPage(
	page: ListPageKind,
	feeds: PodcastFeed[] = [show],
	seed: (services: TestServices) => void = () => {},
) {
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
	seed(services);
	render(WithServices, { props: { services, component: ListPage, props: { page } } });
	return services;
}

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
	test("lists nothing for a playlist that is gone, not the latest episodes", async () => {
		load.mockResolvedValue(feedDocument(show.title, [episode("First")]));
		renderPage({ kind: "playlist", name: "Gone" });

		await services.feeds.load([show.title], "network");
		await tick();

		expect(listed()).toEqual([]);
	});
});

describe("a list page", () => {
	const meta = (title: string) =>
		[...row(title).querySelectorAll(".pn-ep-meta > span:not(.pn-brk, .sep)")].map(
			(part) => part.textContent,
		);

	test.each<ListPageKind>([
		{ kind: "latest" },
		{ kind: "played" },
		{ kind: "playlist", name: "Walks" },
		{ kind: "local" },
	])("%j has no search, Hide played or refresh of its own", async (page) => {
		renderPage(page);
		await tick();

		expect(screen.queryByRole("searchbox")).toBeNull();
		expect(screen.queryByRole("button", { name: /played episodes$/ })).toBeNull();
		expect(screen.queryByRole("button", { name: /^Refresh/ })).toBeNull();
		expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
	});

	test("Latest names each episode's podcast and date; a playlist names the podcast", async () => {
		load.mockResolvedValue(
			feedDocument(show.title, [episode("First", { episodeDate: new Date(2019, 9, 8) })]),
		);
		renderPage({ kind: "latest" });
		await services.feeds.load([show.title], "network");
		await tick();
		expect(meta("First")).toEqual(["Field Notes", "Oct 8, 2019"]);

		dispose();
		document.body.innerHTML = "";
		renderPlaylist([episode("First", { episodeDate: new Date(2019, 9, 8) })]);
		await tick();
		expect(meta("First")).toEqual(["Field Notes", "48 min"]);
	});

	test("Played loads the podcasts of its records in full when it opens", async () => {
		load.mockResolvedValue(feedDocument(show.title, [episode("First")]));
		const other = { ...show, title: "Other", url: "https://feeds.other.test/rss" };
		renderPage({ kind: "played" }, [show, other], ({ library }) =>
			library.playedEpisodes.set({
				"Field Notes::First": {
					title: "First",
					podcastName: show.title,
					time: 1,
					duration: 1,
					finished: true,
				},
			}),
		);

		expect(await screen.findByRole("button", { name: "First, played" })).toBeInTheDocument();
		expect(load.mock.calls).toEqual([[show.url]]);
	});
});
