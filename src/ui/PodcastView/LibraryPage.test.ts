// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/svelte";
import * as obsidian from "obsidian";
import { tick } from "svelte";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ParsedFeedEpisodes } from "src/parser/feedDocumentParser";
import { FeedRepository, type FeedRepositoryDeps } from "src/services/FeedRepository";
import type { PodcastFeed } from "src/types/PodcastFeed";
import { deferred, MemoryStorage } from "../../../tests/mocks/feeds";
import { createTestServices } from "../../../tests/mocks/services";
import WithServices from "../../../tests/mocks/WithServices.svelte";
import type { Layout } from "./layout";
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
afterEach(() => {
	dispose();
	vi.restoreAllMocks();
});

const repositoryWith = ({
	load = () => Promise.reject(new Error("unreachable")),
	resolveUrl = (feed) => feed.url,
}: Partial<Pick<FeedRepositoryDeps, "load" | "resolveUrl">> = {}) =>
	new FeedRepository({
		load,
		resolveUrl,
		storage: new MemoryStorage(),
		cache: () => ({ enabled: false, ttlHours: 6 }),
		now: Date.now,
	});
const unreachable = () => repositoryWith();

function renderLibrary(
	feeds: [string, PodcastFeed][],
	{ layout = "wide", repository }: { layout?: Layout; repository?: FeedRepository } = {},
) {
	const context = createTestServices(repository && { feeds: repository });
	dispose = context.dispose;
	const { library, navigation } = context.services;
	library.savedFeeds.set(Object.fromEntries(feeds));
	render(WithServices, {
		props: {
			services: context.services,
			component: LibraryPage,
			props: { layout, counts: { queue: 2 } },
		},
	});
	const opened: string[] = [];
	navigation.subscribe(({ page }) => {
		if (page.kind === "feed") opened.push(page.key);
	});
	return { services: context.services, openedKeys: () => opened };
}

const card = (name: string) => screen.getByRole("button", { name });

describe("the Library's podcast grid", () => {
	test("a podcast whose artwork is missing or broken shows its title on a tile that opens it", async () => {
		const { openedKeys } = renderLibrary([
			["Art Show", artShow],
			["Plain Show", plainShow],
		]);

		await fireEvent.error(card("Art Show").querySelector("img")!);
		await fireEvent.click(card("Art Show"));
		await fireEvent.click(card("Plain Show"));

		expect(openedKeys()).toEqual(["Art Show", "Plain Show"]);
		expect(card("Art Show")).toHaveTextContent("Art Show");
		expect(card("Art Show").querySelector("img")).toBeNull();
		expect(card("Plain Show")).toHaveTextContent("Plain Show");
	});

	test("two saved podcasts sharing a feed URL each get a tile that opens their own", async () => {
		const { openedKeys } = renderLibrary([
			["Art Show", artShow],
			["Art Show Alias", { ...artShow, title: "Art Show Alias" }],
		]);

		await fireEvent.click(card("Art Show Alias"));
		await fireEvent.click(card("Art Show"));

		expect(openedKeys()).toEqual(["Art Show Alias", "Art Show"]);
	});

	test("a podcast whose feed did not load wears a badge and says so", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const repository = unreachable();
		renderLibrary(
			[
				["Art Show", artShow],
				["Plain Show", plainShow],
			],
			{ repository },
		);

		await repository.load(["Art Show"], "network");

		expect(
			await screen.findByRole("button", { name: "Art Show, feed didn't load" }),
		).toContainElement(document.querySelector(".pn-badge"));
		expect(card("Plain Show").querySelector(".pn-badge")).toBeNull();
	});

	test("offline, a podcast whose feed did not load wears no badge, since the Offline strip says why", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const repository = unreachable();
		const { services } = renderLibrary([["Art Show", artShow]], { repository });
		await repository.load(["Art Show"], "network");
		services.online.set(false);
		await tick();

		expect(card("Art Show").querySelector(".pn-badge")).toBeNull();

		services.online.set(true);
		expect(
			await screen.findByRole("button", { name: "Art Show, feed didn't load" }),
		).toContainElement(document.querySelector(".pn-badge"));
	});

	test("back online, a podcast whose feed failed offline wears no badge while it loads again", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const answer = deferred<ParsedFeedEpisodes>();
		const load = vi
			.fn<FeedRepositoryDeps["load"]>()
			.mockRejectedValueOnce(new Error("offline"))
			.mockReturnValueOnce(answer.promise);
		const repository = repositoryWith({ load });
		const { services } = renderLibrary([["Art Show", artShow]], { repository });
		services.online.set(false);
		await repository.load(["Art Show"], "network");

		services.online.set(true);
		void repository.ensureAll();
		await tick();

		expect(card("Art Show").querySelector(".pn-badge")).toBeNull();
		answer.reject(new Error("down"));
		expect(
			await screen.findByRole("button", { name: "Art Show, feed didn't load" }),
		).toContainElement(document.querySelector(".pn-badge"));
	});

	test("offline, a private feed whose address is not on this device still wears its badge", async () => {
		const repository = repositoryWith({ resolveUrl: () => null });
		const { services } = renderLibrary([["Art Show", artShow]], { repository });
		await repository.load(["Art Show"], "network");
		services.online.set(false);
		await tick();

		expect(card("Art Show, feed didn't load")).toContainElement(
			document.querySelector(".pn-badge"),
		);
	});

	test("a right-click on a podcast opens its menu at the pointer", async () => {
		const { services } = renderLibrary([["Art Show", artShow]]);
		Object.assign(services.app, { vault: { getAbstractFileByPath: () => null } });
		const titles = vi.spyOn(obsidian.MenuItem.prototype, "setTitle");
		const shown = vi.spyOn(obsidian.Menu.prototype, "showAtPosition");

		await fireEvent.contextMenu(card("Art Show"), { clientX: 40, clientY: 50 });

		expect(titles.mock.calls.map(([title]) => title)).toEqual([
			"Create podcast note",
			"Copy feed URL",
			"Remove podcast",
		]);
		expect(shown).toHaveBeenCalledWith(
			{ x: 40, y: 50, doc: document, el: card("Art Show") },
			document,
		);
	});

	test("a compact Library lists its lists above the grid", () => {
		renderLibrary([["Art Show", artShow]], { layout: "compact" });

		expect(screen.getByRole("button", { name: "Queue 2" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "Podcasts" })).toBeInTheDocument();
	});

	test("a wide Library shows only the grid, its rail lists the rest", () => {
		renderLibrary([["Art Show", artShow]], { layout: "wide" });

		expect(screen.queryByRole("navigation")).toBeNull();
		expect(screen.queryByRole("heading")).toBeNull();
		expect(card("Art Show")).toBeInTheDocument();
	});
});
