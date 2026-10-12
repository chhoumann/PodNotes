// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, expect, test } from "vitest";
import { savedFeeds } from "src/store";
import { createTestServices } from "../../../tests/mocks/services";
import WithServices from "../../../tests/mocks/WithServices.svelte";
import EpisodesPage from "./EpisodesPage.svelte";
import LibraryPage from "./LibraryPage.svelte";
import type { Page } from "./pages";

const feed = {
	title: "Test Podcast",
	url: "https://pod.example.com/feed.xml",
	artworkUrl: "https://pod.example.com/art.jpg",
};

let context: ReturnType<typeof createTestServices>;
beforeEach(() => {
	savedFeeds.set({ [feed.title]: feed });
	context = createTestServices();
});
afterEach(() => {
	context.dispose();
	savedFeeds.set({});
});

function renderEpisodesPage(page: Page) {
	render(WithServices, {
		props: { services: context.services, component: EpisodesPage, props: { page } },
	});
}

test("a podcast card in the legacy grid opens the podcast's page", async () => {
	const { services } = context;
	render(WithServices, {
		props: { services, component: LibraryPage, props: { layout: "compact", counts: {} } },
	});

	await fireEvent.click(screen.getByAltText(feed.title));

	expect(services.navigation.current.page).toEqual({ kind: "feed", key: feed.title });
});

test("a podcast's page heads the legacy episode list with the podcast", () => {
	renderEpisodesPage({ kind: "feed", key: feed.title });

	expect(screen.getByRole("heading", { name: feed.title })).toBeInTheDocument();
	expect(screen.queryByText("Fallback")).toBeNull();
});

test("a list page gives the legacy episode list no heading", () => {
	renderEpisodesPage({ kind: "latest" });

	expect(screen.getByPlaceholderText("Search episodes")).toBeInTheDocument();
	expect(screen.queryByRole("heading")).toBeNull();
	expect(screen.queryByText("Fallback")).toBeNull();
});
