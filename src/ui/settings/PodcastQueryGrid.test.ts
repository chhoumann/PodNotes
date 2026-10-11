// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type PodNotes from "src/main";
import { plugin, savedFeeds } from "src/store";
import { fetchJsonWithTimeout } from "src/utility/networkRequest";
import lookupAppleNewsToday from "../../../tests/fixtures/itunes/lookup-apple-news-today.json";
import lookupHubermanLab from "../../../tests/fixtures/itunes/lookup-huberman-lab.json";
import searchAppleNews from "../../../tests/fixtures/itunes/search-apple-news.json";
import searchPlanetMoney from "../../../tests/fixtures/itunes/search-planet-money.json";
import PodcastQueryGrid from "./PodcastQueryGrid.svelte";

vi.mock("src/utility/networkRequest", async (importOriginal) => {
	const actual = await importOriginal<typeof import("src/utility/networkRequest")>();
	return { ...actual, fetchJsonWithTimeout: vi.fn() };
});

const fetchJsonMock = vi.mocked(fetchJsonWithTimeout);

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
	});

	test("shows a feed once when search lists it under several shows", async () => {
		fetchJsonMock.mockResolvedValue(searchPlanetMoney);

		const { findByRole, getAllByRole } = paste("planet money");
		await findByRole("button", { name: "Add Planet Money Summer School podcast" });

		expect(getAllByRole("button", { name: "Add Planet Money podcast" })).toHaveLength(1);
	});

	test("keeps the newest search when an older one answers last", async () => {
		const older = deferred<unknown>();
		const newer = deferred<unknown>();
		fetchJsonMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

		const { findByRole, queryByRole, type } = renderGrid();
		type("apple news");
		await settle();
		type("planet money");
		await settle();
		newer.resolve(searchPlanetMoney);
		await findByRole("button", { name: "Add Planet Money podcast" });
		older.resolve(searchAppleNews);
		await settle();

		expect(queryByRole("button", { name: "Add Planet Money podcast" })).toBeInTheDocument();
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
