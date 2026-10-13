// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/svelte";
import * as obsidian from "obsidian";
import { get } from "svelte/store";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type PodNotes from "src/main";
import { FeedRepository, loadFeed } from "src/services/FeedRepository";
import { FeedUrlRepository } from "src/services/FeedUrlRepository";
import { plugin, savedFeeds } from "src/store";
import {
	fetchJsonWithTimeout,
	fetchTextWithTimeout,
	NetworkError,
} from "src/utility/networkRequest";
import { privateFeedPlaceholder } from "src/utility/privateFeedUrl";
import lookupAppleNewsToday from "../../../tests/fixtures/itunes/lookup-apple-news-today.json";
import lookupHubermanLab from "../../../tests/fixtures/itunes/lookup-huberman-lab.json";
import searchAppleNews from "../../../tests/fixtures/itunes/search-apple-news.json";
import searchHubermanLab from "../../../tests/fixtures/itunes/search-huberman-lab.json";
import searchPlanetMoney from "../../../tests/fixtures/itunes/search-planet-money.json";
import searchPlanetMoneyNamesake from "../../../tests/fixtures/itunes/search-planet-money-namesake.json";
import { MemoryStorage } from "../../../tests/mocks/feeds";
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

function usePlugin(feedUrls: FeedUrlRepository | object) {
	const feeds = new FeedRepository({
		load: loadFeed,
		resolveUrl: (feed) => feed.url,
		storage: new MemoryStorage(),
		cache: () => ({ enabled: false, ttlHours: 6 }),
		now: Date.now,
	});
	plugin.set({ app: new obsidian.App(), feedUrls, feeds } as unknown as PodNotes);
}

async function setFeedAddress(view: ReturnType<typeof renderGrid>, title: string, url: string) {
	await fireEvent.click(
		await view.findByRole("button", { name: `Set feed address for ${title}` }),
	);
	const dialog = within(document.body);
	await fireEvent.input(dialog.getByRole("textbox", { name: "Feed address" }), {
		target: { value: url },
	});
	await fireEvent.click(dialog.getByRole("button", { name: "Save" }));
	await settle();
}

// Runs the debounced handler and every response already resolved.
const settle = () => new Promise((resolve) => setTimeout(resolve));

const PRIVATE_URL = "https://www.patreon.com/rss/show?auth=se-cret";

// Follows "Private Show" through `url`. Pasting any URL loads its RSS,
// whose author tells the pasted card apart from the saved one.
function followPrivateShow(url = PRIVATE_URL) {
	const secrets = new obsidian.SecretStorage();
	const feedUrls = new FeedUrlRepository(secrets);
	usePlugin(feedUrls);
	const saved = {
		title: "Private Show",
		url: privateFeedPlaceholder("Private Show"),
		urlSecretId: feedUrls.store(url),
		artworkUrl: "",
	};
	savedFeeds.set({ "Private Show": saved });
	fetchTextMock.mockResolvedValue(
		"<rss><channel><title>Private Show</title><author>Patron Host</author></channel></rss>",
	);
	return { saved, secrets };
}

describe("PodcastQueryGrid", () => {
	beforeEach(() => {
		usePlugin({});
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
		notice.mockClear();
		await fireEvent.click(getByRole("button", { name: "Add Planet Money podcast" }));

		expect(get(savedFeeds)["Planet Money"]).toMatchObject({
			url: "https://feeds.npr.org/510289/podcast.xml",
			collectionId: "290783428",
		});
		expect(notice).toHaveBeenCalledWith(
			"You already follow a podcast called Planet Money from another feed.",
		);
	});

	test("adds a podcast titled like an Object property", async () => {
		fetchTextMock.mockResolvedValue("<rss><channel><title>toString</title></channel></rss>");

		const { findByRole } = paste("https://feeds.example.com/to-string.xml");
		await fireEvent.click(await findByRole("button", { name: "Add toString podcast" }));

		expect(Object.keys(get(savedFeeds))).toEqual(["toString"]);
		expect(await findByRole("button", { name: "Remove toString podcast" })).toBeInTheDocument();
	});

	test("two saved podcasts sharing a feed URL each have a Remove for only themselves", async () => {
		const shared = {
			title: "Shared",
			url: "https://feeds.example.com/shared.xml",
			artworkUrl: "",
		};
		savedFeeds.set({ Shared: shared, "Shared Alias": { ...shared, title: "Shared Alias" } });

		const { findByRole } = renderGrid();
		await fireEvent.click(await findByRole("button", { name: "Remove Shared Alias podcast" }));

		expect(Object.keys(get(savedFeeds))).toEqual(["Shared"]);
		expect(await findByRole("button", { name: "Remove Shared podcast" })).toBeInTheDocument();
	});

	test("Remove deletes the saved podcast under its own key", async () => {
		savedFeeds.set({
			"Old Name": {
				title: "New Name",
				url: "https://feeds.example.com/renamed.xml",
				artworkUrl: "",
			},
		});

		const { findByRole } = renderGrid();
		await fireEvent.click(await findByRole("button", { name: "Remove New Name podcast" }));

		expect(get(savedFeeds)).toEqual({});
	});

	test("lists a followed private feed as saved", async () => {
		followPrivateShow();

		const { findByRole } = renderGrid();

		expect(
			await findByRole("button", { name: "Remove Private Show podcast" }),
		).toBeInTheDocument();
	});

	test("shows a followed private feed as saved when its URL is pasted", async () => {
		followPrivateShow();

		const { findByText, getByRole, queryByRole } = paste(PRIVATE_URL);
		await findByText("Patron Host");

		expect(getByRole("button", { name: "Remove Private Show podcast" })).toBeInTheDocument();
		expect(queryByRole("button", { name: "Add Private Show podcast" })).toBeNull();
	});

	test("a changed channel title still removes the existing private subscription by its saved key", async () => {
		const { saved, secrets } = followPrivateShow();
		fetchTextMock.mockResolvedValue(
			"<rss><channel><title>Renamed Show</title><author>Patron Host</author></channel></rss>",
		);

		const { findByText, getByRole, queryByRole } = paste(PRIVATE_URL);
		await findByText("Patron Host");

		expect(queryByRole("button", { name: "Add Renamed Show podcast" })).toBeNull();
		expect(get(savedFeeds)).toEqual({ "Private Show": saved });
		await fireEvent.click(getByRole("button", { name: "Remove Renamed Show podcast" }));
		expect(get(savedFeeds)).toEqual({});
		expect(secrets.getSecret(saved.urlSecretId)).toBeFalsy();
	});

	test("shows a private feed followed with an uppercase host as saved when its URL is pasted", async () => {
		followPrivateShow(PRIVATE_URL.replace("www.patreon.com", "WWW.PATREON.COM"));

		const { findByText, getByRole, queryByRole } = paste(PRIVATE_URL);
		await findByText("Patron Host");

		expect(getByRole("button", { name: "Remove Private Show podcast" })).toBeInTheDocument();
		expect(queryByRole("button", { name: "Add Private Show podcast" })).toBeNull();
	});

	test("refusing a private namesake stores none of its URL", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		const { saved, secrets } = followPrivateShow();

		const { findByRole } = paste("https://www.patreon.com/rss/show?auth=other-tier");
		await fireEvent.click(await findByRole("button", { name: "Add Private Show podcast" }));

		expect(notice).toHaveBeenCalledWith(
			"You already follow a podcast called Private Show from another feed.",
		);
		expect(get(savedFeeds)).toEqual({ "Private Show": saved });
		expect(secrets.listSecrets()).toEqual([saved.urlSecretId]);
	});

	test("a followed private feed without its URL on this device says so instead of adding it", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		const { saved } = followPrivateShow();
		const thisDevice = new obsidian.SecretStorage();
		usePlugin(new FeedUrlRepository(thisDevice));

		const { findByRole } = paste(PRIVATE_URL);
		await fireEvent.click(await findByRole("button", { name: "Add Private Show podcast" }));

		expect(notice).toHaveBeenCalledWith(
			'The private feed address for "Private Show" is not available on this device.',
		);
		expect(notice).not.toHaveBeenCalledWith(
			"You already follow a podcast called Private Show from another feed.",
		);
		expect(get(savedFeeds)).toEqual({ "Private Show": saved });
		expect(thisDevice.listSecrets()).toEqual([]);
	});

	test("sets a synced private feed's address on this device under the reference data.json holds", async () => {
		const { saved, secrets: firstDevice } = followPrivateShow();
		const thisDevice = new obsidian.SecretStorage();
		usePlugin(new FeedUrlRepository(thisDevice));

		const view = renderGrid();
		await setFeedAddress(view, "Private Show", PRIVATE_URL);

		expect(thisDevice.listSecrets()).toEqual([saved.urlSecretId]);
		expect(thisDevice.getSecret(saved.urlSecretId)).toBe(PRIVATE_URL);
		expect(firstDevice.getSecret(saved.urlSecretId)).toBe(PRIVATE_URL);
		expect(get(savedFeeds)).toEqual({ "Private Show": saved });
		expect(
			view.queryByRole("button", { name: "Set feed address for Private Show" }),
		).toBeNull();
		expect(
			view.getByRole("button", { name: "Remove Private Show podcast" }),
		).toBeInTheDocument();
	});

	test("keeps the reference when the feed at the entered address cannot be loaded", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		vi.spyOn(console, "error").mockImplementation(() => {});
		const { saved } = followPrivateShow();
		const thisDevice = new obsidian.SecretStorage();
		usePlugin(new FeedUrlRepository(thisDevice));
		fetchTextMock.mockRejectedValue(new NetworkError("timeout"));

		const view = renderGrid();
		await setFeedAddress(view, "Private Show", PRIVATE_URL);

		expect(notice).toHaveBeenCalledWith(expect.stringMatching(/^Could not load feed: /));
		expect(thisDevice.listSecrets()).toEqual([]);
		expect(get(savedFeeds)).toEqual({ "Private Show": saved });
		expect(
			view.getByRole("button", { name: "Set feed address for Private Show" }),
		).toBeInTheDocument();
	});

	test("sets no address on a feed that a sync replaced while the address loaded", async () => {
		followPrivateShow();
		const thisDevice = new obsidian.SecretStorage();
		usePlugin(new FeedUrlRepository(thisDevice));
		const response = deferred<string>();
		fetchTextMock.mockReturnValue(response.promise);
		const replaced = {
			title: "Private Show",
			url: privateFeedPlaceholder("Private Show"),
			urlSecretId: "podnotes-feed-url-00000000-0000-4000-8000-000000000009",
			artworkUrl: "",
		};

		const view = renderGrid();
		await setFeedAddress(view, "Private Show", PRIVATE_URL);
		savedFeeds.set({ "Private Show": replaced });
		response.resolve("<rss><channel><title>Private Show</title></channel></rss>");
		await settle();

		expect(thisDevice.listSecrets()).toEqual([]);
		expect(get(savedFeeds)).toEqual({ "Private Show": replaced });
	});

	test("adds nothing when this device cannot store a pasted private feed's address", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		vi.spyOn(console, "error").mockImplementation(() => {});
		const secrets = new obsidian.SecretStorage();
		vi.spyOn(secrets, "setSecret").mockImplementation(() => {
			throw new Error("locked");
		});
		usePlugin(new FeedUrlRepository(secrets));
		fetchTextMock.mockResolvedValue(
			"<rss><channel><title>Private Show</title></channel></rss>",
		);

		const { findByRole } = paste(PRIVATE_URL);
		await fireEvent.click(await findByRole("button", { name: "Add Private Show podcast" }));

		expect(get(savedFeeds)).toEqual({});
		expect(notice).toHaveBeenCalledWith(
			'Could not store the private feed address for "Private Show" on this device.',
		);
	});

	test("removing a private feed saved under two names keeps its address for the other", async () => {
		const { saved, secrets } = followPrivateShow();
		const alias = { ...saved, title: "Alias", urlSecretId: ` ${saved.urlSecretId} ` };
		savedFeeds.set({ "Private Show": saved, Alias: alias });

		const { findByRole } = renderGrid();
		await fireEvent.click(await findByRole("button", { name: "Remove Alias podcast" }));

		expect(get(savedFeeds)).toEqual({ "Private Show": saved });
		expect(secrets.getSecret(saved.urlSecretId)).toBe(PRIVATE_URL);

		await fireEvent.click(await findByRole("button", { name: "Remove Private Show podcast" }));

		expect(get(savedFeeds)).toEqual({});
		expect(secrets.getSecret(saved.urlSecretId)).toBeFalsy();
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

	test("an Apple Podcasts link that cannot be looked up asks to try again", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		vi.spyOn(console, "error").mockImplementation(() => {});
		fetchJsonMock.mockRejectedValue(new NetworkError("timeout"));

		const { findByRole } = paste(
			"https://podcasts.apple.com/us/podcast/huberman-lab/id1545953110",
		);

		expect(await findByRole("alert")).toHaveTextContent(
			"Could not look up this Apple Podcasts link. Please try again.",
		);
		expect(notice).toHaveBeenCalledWith(
			"Could not look up this Apple Podcasts link. Please try again.",
		);
	});
});
