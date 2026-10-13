// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";

import type { PodcastFeed } from "src/types/PodcastFeed";
import { createTestServices } from "../../../tests/mocks/services";
import WithServices from "../../../tests/mocks/WithServices.svelte";
import LibraryPage from "./LibraryPage.svelte";

const artShow: PodcastFeed = {
	title: "Art Show",
	url: "https://art.test/feed.xml",
	artworkUrl: "https://art.test/art.jpg",
};
const plainShow: PodcastFeed = {
	title: "Plain Show",
	url: "https://plain.test/feed.xml",
	artworkUrl: "",
};

let dispose = () => {};
afterEach(() => dispose());

function renderGrid(feeds: [string, PodcastFeed][]) {
	const context = createTestServices();
	dispose = context.dispose;
	const { library, navigation } = context.services;
	library.savedFeeds.set(Object.fromEntries(feeds));
	render(WithServices, {
		props: {
			services: context.services,
			component: LibraryPage,
			props: { layout: "wide", counts: {} },
		},
	});
	const opened: string[] = [];
	navigation.subscribe(({ page }) => {
		if (page.kind === "feed") opened.push(page.key);
	});
	return { openedKeys: () => opened };
}

describe("the Library's podcast grid", () => {
	test("a podcast whose artwork is missing or broken still has a tile that opens it", async () => {
		const { openedKeys } = renderGrid([
			["Art Show", artShow],
			["Plain Show", plainShow],
		]);

		await fireEvent.error(screen.getByRole("img", { name: "Art Show" }));
		await fireEvent.click(screen.getByRole("button", { name: "Art Show" }));
		await fireEvent.click(screen.getByRole("button", { name: "Plain Show" }));

		expect(openedKeys()).toEqual(["Art Show", "Plain Show"]);
		expect(screen.getByRole("button", { name: "Art Show" })).toHaveTextContent("AS");
		expect(screen.getByRole("button", { name: "Plain Show" })).toHaveTextContent("PS");
	});

	test("two saved podcasts sharing a feed URL each get a tile that opens their own", async () => {
		const { openedKeys } = renderGrid([
			["Art Show", artShow],
			["Art Show Alias", { ...artShow, title: "Art Show Alias" }],
		]);

		await fireEvent.click(screen.getByRole("button", { name: "Art Show Alias" }));
		await fireEvent.click(screen.getByRole("button", { name: "Art Show" }));

		expect(openedKeys()).toEqual(["Art Show Alias", "Art Show"]);
	});
});
