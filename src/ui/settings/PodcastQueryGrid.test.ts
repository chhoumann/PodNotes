// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type PodNotes from "src/main";
import { plugin, savedFeeds } from "src/store";
import { fetchJsonWithTimeout } from "src/utility/networkRequest";
import lookupAppleNewsToday from "../../../tests/fixtures/itunes/lookup-apple-news-today.json";
import lookupHubermanLab from "../../../tests/fixtures/itunes/lookup-huberman-lab.json";
import searchPlanetMoney from "../../../tests/fixtures/itunes/search-planet-money.json";
import PodcastQueryGrid from "./PodcastQueryGrid.svelte";

vi.mock("src/utility/networkRequest", async (importOriginal) => {
	const actual = await importOriginal<typeof import("src/utility/networkRequest")>();
	return { ...actual, fetchJsonWithTimeout: vi.fn() };
});

const fetchJsonMock = vi.mocked(fetchJsonWithTimeout);

function paste(value: string) {
	const view = render(PodcastQueryGrid);
	const input = view.getByPlaceholderText("Search or enter feed URL...") as HTMLInputElement;
	input.value = value;
	void fireEvent.input(input);
	return view;
}

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
