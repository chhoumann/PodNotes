// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createTestServices } from "../../../tests/mocks/services";
import WithServices from "../../../tests/mocks/WithServices.svelte";
import EpisodesPage from "./EpisodesPage.svelte";
import LibraryPage from "./LibraryPage.svelte";
import ListPage from "./ListPage.svelte";

const feed = {
	title: "Test Podcast",
	url: "https://pod.example.com/feed.xml",
	artworkUrl: "https://pod.example.com/art.jpg",
};

let context: ReturnType<typeof createTestServices>;
beforeEach(() => {
	context = createTestServices();
	context.services.library.savedFeeds.set({ [feed.title]: feed });
});
afterEach(() => context.dispose());

test("a podcast card opens the podcast's page", async () => {
	const { services } = context;
	render(WithServices, {
		props: { services, component: LibraryPage, props: { layout: "compact", counts: {} } },
	});

	await fireEvent.click(screen.getByRole("button", { name: feed.title }));

	expect(services.navigation.current.page).toEqual({ kind: "feed", key: feed.title });
});

test("a podcast's page is headed by the podcast", () => {
	render(WithServices, {
		props: { services: context.services, component: EpisodesPage, props: { key: feed.title } },
	});

	expect(screen.getByRole("heading", { name: feed.title })).toBeInTheDocument();
});

test("a list page leaves its heading to the shell", () => {
	render(WithServices, {
		props: {
			services: context.services,
			component: ListPage,
			props: { page: { kind: "latest" } },
		},
	});

	expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
	expect(screen.queryByRole("heading")).toBeNull();
});
