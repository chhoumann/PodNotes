// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import * as obsidian from "obsidian";
import { tick } from "svelte";
import { get } from "svelte/store";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ParsedFeedEpisodes } from "src/parser/feedDocumentParser";
import { FeedRepository } from "src/services/FeedRepository";
import type { Episode } from "src/types/Episode";
import type { PodcastFeed } from "src/types/PodcastFeed";
import { isPrivateFeedPlaceholder, privateFeedPlaceholder } from "src/utility/privateFeedUrl";
import { deferred, feedDocument, MemoryStorage } from "../../../tests/mocks/feeds";
import { createTestServices, type TestServices } from "../../../tests/mocks/services";
import WithServices from "../../../tests/mocks/WithServices.svelte";
import EpisodesPage from "./EpisodesPage.svelte";

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

function renderPage(key: string, feeds: PodcastFeed[] = [show], { online = true } = {}) {
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
	services.online.set(online);
	render(WithServices, { props: { services, component: EpisodesPage, props: { key } } });
	return services;
}

const listed = () =>
	screen.queryAllByRole("listitem").map((row) => row.querySelector(".pn-ep-title")?.textContent);

describe("a podcast's page", () => {
	test("is headed by the podcast's artwork, title and author", async () => {
		load.mockResolvedValue(feedDocument(show.title, [episode("First")]));
		renderPage(show.title);

		expect(screen.getByRole("heading", { name: "Field Notes" })).toBeInTheDocument();
		expect(screen.getByText("Maya Lind")).toBeInTheDocument();
		expect(await screen.findByText("First")).toBeInTheDocument();
	});

	test("says it is loading until the feed answers", async () => {
		const answer = deferred<ParsedFeedEpisodes>();
		load.mockReturnValue(answer.promise);
		renderPage(show.title);

		expect(await screen.findByRole("status")).toHaveTextContent("Loading episodes");
		answer.resolve(feedDocument(show.title, [episode("First")]));

		expect(await screen.findByText("First")).toBeInTheDocument();
		expect(screen.queryByRole("status")).toBeNull();
	});

	test("keeps its episodes when the feed fails, names the server, and retries", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		load.mockResolvedValueOnce(feedDocument(show.title, [episode("First")]));
		renderPage(show.title);
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

	test("lists nothing for a podcast that is gone, not the latest episodes", async () => {
		load.mockResolvedValue(feedDocument(show.title, [episode("First")]));
		renderPage("Gone");

		await services.feeds.load([show.title], "network");
		await tick();

		expect(listed()).toEqual([]);
	});

	test("asks for a private feed's address where this device lacks it, instead of retrying", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		const patron = { ...show, title: "Patron", url: privateFeedPlaceholder("Patron") };
		renderPage("Patron", [patron]);
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
		renderPage("Patron", [patron]);

		const banner = await screen.findByRole("alert");
		expect(banner).toHaveTextContent("Private feed");
		expect(banner).not.toHaveTextContent("private.test");
		expect(within(banner).getByRole("button", { name: "Retry" })).toBeInTheDocument();
	});

	test("filters by a search and says when nothing matches", async () => {
		load.mockResolvedValue(
			feedDocument(show.title, [episode("Reading slowly"), episode("Margin notes")]),
		);
		renderPage(show.title);
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
		load.mockResolvedValue(feedDocument(show.title, [episode("Played"), episode("New")]));
		renderPage(show.title);
		services.library.playedEpisodes.set({
			"Field Notes::Played": {
				title: "Played",
				podcastName: show.title,
				time: 1,
				duration: 1,
				finished: true,
			},
		});
		await waitFor(() => expect(listed()).toEqual(["Played", "New"]));
		const toggle = screen.getByRole("button", { name: "Hide played episodes" });

		await fireEvent.click(toggle);

		expect(get(services.library.hidePlayedEpisodes)).toBe(true);
		expect(screen.getByRole("button", { name: "Show played episodes" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(listed()).toEqual(["New"]);
	});

	test("of two episodes that share a podcast and a title, calls only the downloaded one downloaded", async () => {
		const rerun = (n: number) => episode("Rerun", { streamUrl: `https://media.test/${n}.mp3` });
		load.mockResolvedValue(feedDocument(show.title, [rerun(2), rerun(1)]));
		renderPage(show.title);
		services.library.downloadedEpisodes.set({
			[show.title]: [{ ...rerun(2), filePath: "Downloads/Rerun.mp3", size: 1 }],
		});
		await waitFor(() => expect(listed()).toEqual(["Rerun", "Rerun"]));
		const [downloaded, streamed] = screen.getAllByRole("listitem");
		const menuOf = async (item: HTMLElement) => {
			const titles = vi.spyOn(obsidian.MenuItem.prototype, "setTitle");
			await fireEvent.click(
				within(item).getByRole("button", { name: "More options for Rerun" }),
			);
			const shown = titles.mock.calls.map(([title]) => title);
			titles.mockRestore();
			return shown;
		};

		expect(within(downloaded).getByRole("button", { name: "Rerun, downloaded" })).toBeVisible();
		expect(downloaded.querySelector('[title="Downloaded"]')).not.toBeNull();
		expect(within(streamed).getByRole("button", { name: "Rerun" })).toBeVisible();
		expect(streamed.querySelector('[title="Downloaded"]')).toBeNull();
		expect(await menuOf(downloaded)).toContain("Remove download");
		const streamedMenu = await menuOf(streamed);
		expect(streamedMenu).toContain("Download");
		expect(streamedMenu).not.toContain("Remove download");
	});

	test("offline, cannot refresh, and shows no failure, since the Offline strip says why", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		load.mockRejectedValue(new Error("down"));
		renderPage(show.title);
		await screen.findByRole("alert");

		services.online.set(false);
		await tick();

		expect(screen.queryByRole("alert")).toBeNull();
		expect(screen.getByRole("button", { name: "Refresh episodes" })).toBeDisabled();

		services.online.set(true);
		await tick();
		expect(screen.getByRole("alert")).toHaveTextContent("Feed didn't load");
	});

	test("offline, still asks for a private feed's address this device lacks", async () => {
		const patron = { ...show, title: "Patron", url: privateFeedPlaceholder("Patron") };
		renderPage("Patron", [patron]);
		await screen.findByRole("alert");

		services.online.set(false);
		await tick();

		const banner = screen.getByRole("alert");
		expect(banner).toHaveTextContent("Address not on this device");
		expect(within(banner).getByRole("button", { name: "Set feed address" })).toBeEnabled();
	});

	test("opened offline, loads its episodes once the connection returns", async () => {
		load.mockResolvedValue(feedDocument(show.title, [episode("First")]));
		renderPage(show.title, [show], { online: false });
		await tick();
		expect(load).not.toHaveBeenCalled();

		services.online.set(true);

		expect(await screen.findByText("First")).toBeInTheDocument();
		expect(load.mock.calls).toEqual([[show.url]]);
	});
});
