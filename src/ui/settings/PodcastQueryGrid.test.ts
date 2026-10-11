// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/svelte";
import * as obsidian from "obsidian";
import { get } from "svelte/store";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type PodNotes from "src/main";
import { FeedUrlRepository } from "src/services/FeedUrlRepository";
import { plugin, savedFeeds } from "src/store";
import { fetchJsonWithTimeout, fetchTextWithTimeout } from "src/utility/networkRequest";
import { privateFeedPlaceholder } from "src/utility/privateFeedUrl";
import lookupAppleNewsToday from "../../../tests/fixtures/itunes/lookup-apple-news-today.json";
import lookupHubermanLab from "../../../tests/fixtures/itunes/lookup-huberman-lab.json";
import searchAppleNews from "../../../tests/fixtures/itunes/search-apple-news.json";
import searchHubermanLab from "../../../tests/fixtures/itunes/search-huberman-lab.json";
import searchPlanetMoney from "../../../tests/fixtures/itunes/search-planet-money.json";
import searchPlanetMoneyNamesake from "../../../tests/fixtures/itunes/search-planet-money-namesake.json";
import PodcastQueryGrid from "./PodcastQueryGrid.svelte";

vi.mock("src/utility/networkRequest", async (importOriginal) => {
	const actual = await importOriginal<typeof import("src/utility/networkRequest")>();
	return { ...actual, fetchJsonWithTimeout: vi.fn(), fetchTextWithTimeout: vi.fn() };
});

const fetchJsonMock = vi.mocked(fetchJsonWithTimeout);
const fetchTextMock = vi.mocked(fetchTextWithTimeout);

function renderGrid() {
	const view = render(PodcastQueryGrid);
	const input = view.getByPlaceholderText("Search or enter feed URL...") as HTMLInputElement;
	const type = (value: string) => {
		input.value = value;
		void fireEvent.input(input);
	};
	return { ...view, type };
}

function paste(value: string) {
	const view = renderGrid();
	view.type(value);
	return view;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

// Runs the debounced handler and every response already resolved.
const settle = () => new Promise((resolve) => setTimeout(resolve));

describe("PodcastQueryGrid", () => {
	beforeEach(() => {
		plugin.set({ feedUrls: {} } as PodNotes);
		savedFeeds.set({});
		fetchJsonMock.mockReset();
		fetchTextMock.mockReset();
		vi.restoreAllMocks();
	});

	test("shows a feed once when search lists it under several shows", async () => {
		fetchJsonMock.mockResolvedValue(searchPlanetMoney);

		const { findByRole, getAllByRole } = paste("planet money");
		await findByRole("button", { name: "Add Planet Money Summer School podcast" });

		expect(getAllByRole("button", { name: "Add Planet Money podcast" })).toHaveLength(1);
	});

	test("names each search result's author", async () => {
		fetchJsonMock.mockResolvedValue(searchPlanetMoneyNamesake);

		const { findAllByRole } = paste("planet money");
		const [npr, namesake] = await findAllByRole("listitem");

		expect(within(npr).getByText("NPR")).toBeInTheDocument();
		expect(within(namesake).getByText("fert")).toBeInTheDocument();
	});

	test("adding a namesake keeps the saved podcast", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		fetchJsonMock.mockResolvedValue(searchPlanetMoneyNamesake);

		const { findAllByRole, getByRole } = paste("planet money");
		const [npr] = await findAllByRole("button", { name: "Add Planet Money podcast" });
		await fireEvent.click(npr);
		await fireEvent.click(getByRole("button", { name: "Add Planet Money podcast" }));

		expect(get(savedFeeds)["Planet Money"]).toMatchObject({
			url: "https://feeds.npr.org/510289/podcast.xml",
			collectionId: "290783428",
		});
		expect(notice).toHaveBeenCalledWith(
			"You already follow a different podcast called Planet Money.",
		);
	});

	test("adding a saved private feed again keeps it as saved", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		const feedUrls = new FeedUrlRepository(new obsidian.SecretStorage());
		plugin.set({ feedUrls } as PodNotes);
		const privateUrl = "https://www.patreon.com/rss/show?auth=se-cret";
		const saved = {
			title: "Private Show",
			url: privateFeedPlaceholder("Private Show"),
			urlSecretId: feedUrls.store(privateUrl),
			artworkUrl: "",
		};
		savedFeeds.set({ "Private Show": saved });
		fetchTextMock.mockResolvedValue(
			"<rss><channel><title>Private Show</title></channel></rss>",
		);

		const { findByRole } = paste(privateUrl);
		await fireEvent.click(await findByRole("button", { name: "Add Private Show podcast" }));

		expect(get(savedFeeds)).toEqual({ "Private Show": saved });
		expect(notice).not.toHaveBeenCalled();
	});

	test("keeps the newest search when an older one answers last", async () => {
		const older = deferred<unknown>();
		const newer = deferred<unknown>();
		fetchJsonMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

		const { findByRole, queryByRole, type } = renderGrid();
		type("apple news");
		await settle();
		type("huberman lab");
		await settle();
		newer.resolve(searchHubermanLab);
		await findByRole("button", { name: "Add Huberman Lab podcast" });
		older.resolve(searchAppleNews);
		await settle();

		expect(queryByRole("button", { name: "Add Huberman Lab podcast" })).toBeInTheDocument();
		expect(
			queryByRole("button", { name: "Add Apple News In Conversation podcast" }),
		).toBeNull();
	});

	test("drops a search that answers while the next input is debouncing", async () => {
		const older = deferred<unknown>();
		fetchJsonMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(new Promise(() => {}));

		const { queryByRole, type } = renderGrid();
		type("apple news");
		await settle();
		type("huberman lab");
		older.resolve(searchAppleNews);
		await settle();

		expect(
			queryByRole("button", { name: "Add Apple News In Conversation podcast" }),
		).toBeNull();
	});

	test("keeps searching until the newest search answers", async () => {
		const older = deferred<unknown>();
		fetchJsonMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(new Promise(() => {}));

		const { getByRole, type } = renderGrid();
		type("apple news");
		await settle();
		type("planet money");
		await settle();
		older.resolve(searchAppleNews);
		await settle();

		expect(getByRole("status")).toHaveTextContent("Searching...");
	});

	test("clearing the search drops a search still in flight", async () => {
		const search = deferred<unknown>();
		fetchJsonMock.mockReturnValueOnce(search.promise);

		const { queryAllByRole, queryByRole, type } = renderGrid();
		type("planet money");
		await settle();
		type("");
		await settle();
		search.resolve(searchPlanetMoney);
		await settle();

		expect(queryByRole("status")).toBeNull();
		expect(queryAllByRole("listitem")).toHaveLength(0);
	});

	test("keeps searching when an older Apple Podcasts lookup answers during a newer search", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		const lookup = deferred<unknown>();
		const search = deferred<unknown>();
		fetchJsonMock.mockReturnValueOnce(lookup.promise).mockReturnValueOnce(search.promise);

		const { findByRole, getByRole, queryByRole, type } = renderGrid();
		type("https://podcasts.apple.com/us/podcast/apple-news-today/id1473872585");
		await settle();
		type("apple news");
		await settle();
		lookup.resolve(lookupAppleNewsToday);
		await settle();

		expect(getByRole("status")).toHaveTextContent("Searching...");
		expect(notice).not.toHaveBeenCalled();

		search.resolve(searchAppleNews);

		expect(
			await findByRole("button", { name: "Add Apple News In Conversation podcast" }),
		).toBeInTheDocument();
		expect(queryByRole("alert")).toBeNull();
	});

	test("adds the RSS feed behind a pasted Apple Podcasts show link", async () => {
		fetchJsonMock.mockResolvedValue(lookupHubermanLab);

		const { findByRole } = paste(
			"https://podcasts.apple.com/us/podcast/huberman-lab/id1545953110",
		);
		await fireEvent.click(await findByRole("button", { name: "Add Huberman Lab podcast" }));

		expect(get(savedFeeds)["Huberman Lab"]?.url).toBe("https://feeds.megaphone.fm/hubermanlab");
	});

	test("an Apple Podcasts link without a public RSS feed says so", async () => {
		fetchJsonMock.mockResolvedValue(lookupAppleNewsToday);

		const { findByRole } = paste(
			"https://podcasts.apple.com/us/podcast/apple-news-today/id1473872585",
		);

		expect(await findByRole("alert")).toHaveTextContent(
			"No public RSS feed found for this Apple Podcasts link.",
		);
	});
});
