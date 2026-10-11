// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";

import type { PodcastFeed } from "src/types/PodcastFeed";
import PodcastGrid from "./PodcastGrid.svelte";

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

function renderGrid(feeds: [string, PodcastFeed][]) {
	const clickPodcast = vi.fn<(event: CustomEvent<{ key: string }>) => void>();
	render(PodcastGrid, { props: { feeds }, events: { clickPodcast } });
	const openedKeys = () => clickPodcast.mock.calls.map(([event]) => event.detail.key);
	return { openedKeys };
}

describe("PodcastGrid", () => {
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
