// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/svelte";
import * as obsidian from "obsidian";
import { tick } from "svelte";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { FeedRepository, loadFeed } from "src/services/FeedRepository";
import { FeedUrlRepository } from "src/services/FeedUrlRepository";
import { createLibraryActions } from "src/services/library";
import { resolveFeedUrl } from "src/services/privateFeeds";
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
import { deferred, MemoryStorage } from "../../../tests/mocks/feeds";
import {
	installResizeObserver,
	type FakeResizeObservers,
} from "../../../tests/mocks/resizeObserver";
import {
	createTestServices,
	pluginLibrary,
	type TestServices,
} from "../../../tests/mocks/services";
import { PodcastSearch } from "./podcastSearch";
import PodcastView from "./PodcastView.svelte";

vi.mock("src/utility/networkRequest", async (importOriginal) => {
	const actual = await importOriginal<typeof import("src/utility/networkRequest")>();
	return { ...actual, fetchJsonWithTimeout: vi.fn(), fetchTextWithTimeout: vi.fn() };
});

const fetchJsonMock = vi.mocked(fetchJsonWithTimeout);
const fetchTextMock = vi.mocked(fetchTextWithTimeout);
const PRIVATE_URL = "https://www.patreon.com/rss/show?auth=se-cret";
const APPLE_LINK = "https://podcasts.apple.com/us/podcast/huberman-lab/id1545953110";

let services: TestServices;
let dispose: () => void;

function setUp(secrets = new obsidian.SecretStorage()) {
	dispose?.();
	const feedUrls = new FeedUrlRepository(secrets);
	const feeds = new FeedRepository({
		load: loadFeed,
		resolveUrl: (feed) => resolveFeedUrl(feed, feedUrls),
		storage: new MemoryStorage(),
		cache: () => ({ enabled: false, ttlHours: 6 }),
		now: Date.now,
	});
	const app = new obsidian.App();
	({ services, dispose } = createTestServices({
		app,
		feeds,
		library: pluginLibrary,
		actions: createLibraryActions({ app, feeds, feedUrls }),
		search: new PodcastSearch(feeds),
	}));
	const unsubscribe = savedFeeds.subscribe((saved) => feeds.setSubscriptions(saved));
	const disposeServices = dispose;
	dispose = () => {
		unsubscribe();
		disposeServices();
	};
	return feedUrls;
}

const settle = () => new Promise((resolve) => setTimeout(resolve));
const field = () =>
	screen.getByRole<HTMLInputElement>("searchbox", { name: "Search or paste a link" });
const type = (value: string) => fireEvent.input(field(), { target: { value } });
const result = (name: string | RegExp) => screen.findByRole("button", { name });

async function search(value: string) {
	services.navigation.go({ kind: "add" });
	render(PodcastView, { props: { services } });
	await type(value);
	await settle();
}

function followPrivateShow(url = PRIVATE_URL) {
	const secrets = new obsidian.SecretStorage();
	const feedUrls = setUp(secrets);
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

beforeEach(() => {
	savedFeeds.set({});
	fetchJsonMock.mockReset();
	fetchTextMock.mockReset();
	setUp();
});

afterEach(() => {
	dispose();
	savedFeeds.set({});
	plugin.set(undefined as never);
	vi.restoreAllMocks();
});

describe("first run", () => {
	let widths: FakeResizeObservers;
	beforeEach(() => {
		widths = installResizeObserver();
	});
	afterEach(() => {
		widths.uninstall();
	});
	// jsdom lays nothing out, so a field is 0 wide until the test reports a width.
	const show = (el: HTMLElement) => widths.resize(el, 300);

	test("focuses the search, and the first keystroke opens Add podcast with the text kept", async () => {
		render(PodcastView, { props: { services } });
		expect(screen.getByRole("heading", { name: "Add your first podcast" })).toBeInTheDocument();
		show(field());
		expect(field()).toHaveFocus();
		fetchJsonMock.mockReturnValue(new Promise(() => {}));

		await type("h");
		show(field());

		expect(services.navigation.current.page).toEqual({ kind: "add" });
		expect(screen.queryByRole("heading", { name: "Add your first podcast" })).toBeNull();
		expect(field()).toHaveValue("h");
		expect(field()).toHaveFocus();
		expect(field().selectionStart).toBe(1);
		expect(screen.getByRole("button", { name: "Back to Library" })).toBeInTheDocument();
	});

	test("focuses the search the first time its view shows, not while the view is hidden", async () => {
		render(PodcastView, { props: { services } });
		expect(field()).not.toHaveFocus();

		show(field());
		expect(field()).toHaveFocus();

		field().blur();
		widths.resize(field(), 0);
		show(field());
		expect(field()).not.toHaveFocus();
	});

	test("Back starts it over, with an empty field and no search left to answer", async () => {
		render(PodcastView, { props: { services } });
		const answer = deferred<unknown>();
		fetchJsonMock.mockReturnValue(answer.promise);
		await type("planet money");
		await settle();
		expect(fetchJsonMock).toHaveBeenCalled();

		await fireEvent.click(screen.getByRole("button", { name: "Back to Library" }));
		answer.resolve(searchPlanetMoney);
		await settle();

		expect(screen.getByRole("heading", { name: "Add your first podcast" })).toBeInTheDocument();
		expect(field()).toHaveValue("");
		expect(get(services.search)).toEqual({ query: "", status: "idle" });
	});

	test("stays put on spaces alone", async () => {
		render(PodcastView, { props: { services } });

		await type("  ");

		expect(services.navigation.current.page).toEqual({ kind: "library" });
		expect(screen.getByRole("heading", { name: "Add your first podcast" })).toBeInTheDocument();
	});

	test("stays put while an input method composes", async () => {
		render(PodcastView, { props: { services } });

		const input = field();
		input.value = "ポ";
		input.dispatchEvent(new InputEvent("input", { isComposing: true, bubbles: true }));
		await tick();
		expect(services.navigation.current.page).toEqual({ kind: "library" });

		await fireEvent.compositionEnd(input);
		expect(services.navigation.current.page).toEqual({ kind: "add" });
	});

	test("offers to play a vault file and to import OPML", () => {
		render(PodcastView, { props: { services } });

		expect(screen.getByRole("button", { name: "Play a vault file" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Import OPML" })).toBeInTheDocument();
	});
});

describe("search", () => {
	test("lists each show with its author and episode count, a feed only once", async () => {
		fetchJsonMock.mockResolvedValue(searchPlanetMoney);

		await search("planet money");

		expect(screen.getByRole("status")).toHaveTextContent("3 shows");
		expect(screen.getAllByRole("button", { name: "Add Planet Money" })).toHaveLength(1);
		expect(await result("Add Planet Money Summer School")).toHaveTextContent(
			"NPR · 59 episodes",
		);
	});

	test("names each show's author, also two that share a title", async () => {
		fetchJsonMock.mockResolvedValue(searchPlanetMoneyNamesake);

		await search("planet money");

		const [npr, namesake] = screen.getAllByRole("button", { name: "Add Planet Money" });
		expect(npr).toHaveTextContent("NPR");
		expect(namesake).toHaveTextContent("fert");
	});

	test("adds a show and opens its episodes", async () => {
		fetchJsonMock.mockResolvedValue(searchHubermanLab);
		await search("huberman");

		await fireEvent.click(await result("Add Huberman Lab"));

		expect(get(savedFeeds)["Huberman Lab"]?.url).toBe("https://feeds.megaphone.fm/hubermanlab");
		expect(services.navigation.current.page).toEqual({ kind: "feed", key: "Huberman Lab" });
	});

	test("an added show shows a check and opens without adding it again", async () => {
		fetchJsonMock.mockResolvedValue(searchHubermanLab);
		await search("huberman");
		await fireEvent.click(await result("Add Huberman Lab"));
		const saved = get(savedFeeds);
		await fireEvent.click(screen.getByRole("button", { name: "Back to Add podcast" }));

		const added = await result("Open Huberman Lab");
		expect(added.querySelector(".end")).toHaveAttribute("data-icon", "check");
		await fireEvent.click(added);

		expect(get(savedFeeds)).toBe(saved);
		expect(services.navigation.current.page).toEqual({ kind: "feed", key: "Huberman Lab" });
	});

	test("adding a namesake keeps the saved podcast", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		fetchJsonMock.mockResolvedValue(searchPlanetMoneyNamesake);
		await search("planet money");
		await fireEvent.click(screen.getAllByRole("button", { name: "Add Planet Money" })[0]);
		await fireEvent.click(screen.getByRole("button", { name: "Back to Add podcast" }));

		await fireEvent.click(await result("Add Planet Money"));

		expect(get(savedFeeds)["Planet Money"]).toMatchObject({
			url: "https://feeds.npr.org/510289/podcast.xml",
			collectionId: "290783428",
		});
		expect(notice).toHaveBeenCalledWith(
			"You already follow a podcast called Planet Money from another feed.",
		);
		expect(services.navigation.current.page).toEqual({ kind: "add" });
	});

	test("shows nothing a failed search said, only that it failed", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		fetchJsonMock.mockRejectedValue(new NetworkError("timeout"));

		await search("planet money");

		expect(screen.getByRole("alert")).toHaveTextContent(/^Search didn't load$/);
	});

	test("says search needs a connection when it fails offline", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
		fetchJsonMock.mockRejectedValue(new NetworkError("transport-failure"));

		await search("planet money");

		expect(screen.getByRole("alert")).toHaveTextContent("Search needs a connection");
	});

	test("clearing the field shows the ways to add without a search", async () => {
		fetchJsonMock.mockResolvedValue(searchHubermanLab);
		await search("huberman");
		await result("Add Huberman Lab");

		await fireEvent.click(screen.getByRole("button", { name: "Clear" }));

		expect(field()).toHaveValue("");
		expect(field()).toHaveFocus();
		expect(screen.queryByRole("button", { name: "Add Huberman Lab" })).toBeNull();
		expect(screen.getByRole("button", { name: "Import OPML" })).toBeInTheDocument();
	});
});

describe("the newest input wins", () => {
	test("keeps the newest search when an older one answers last", async () => {
		const older = deferred<unknown>();
		const newer = deferred<unknown>();
		fetchJsonMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
		await search("apple news");

		await type("huberman lab");
		await settle();
		newer.resolve(searchHubermanLab);
		await result("Add Huberman Lab");
		older.resolve(searchAppleNews);
		await settle();

		expect(screen.getByRole("button", { name: "Add Huberman Lab" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Add Apple News In Conversation" })).toBeNull();
	});

	test("drops a search that answers while the next input is debouncing", async () => {
		const older = deferred<unknown>();
		fetchJsonMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(new Promise(() => {}));
		await search("apple news");

		await type("huberman lab");
		older.resolve(searchAppleNews);
		await settle();

		expect(screen.queryByRole("button", { name: "Add Apple News In Conversation" })).toBeNull();
		expect(screen.getByRole("status")).toHaveTextContent("Searching");
	});

	test("clearing the search drops a search still in flight", async () => {
		const pending = deferred<unknown>();
		fetchJsonMock.mockReturnValueOnce(pending.promise);
		await search("planet money");

		await type("");
		await settle();
		pending.resolve(searchPlanetMoney);
		await settle();

		expect(screen.queryByRole("status")).toBeNull();
		expect(screen.queryByRole("button", { name: /^Add / })).toBeNull();
	});

	test("an older Apple Podcasts lookup that answers during a newer search changes nothing", async () => {
		const lookup = deferred<unknown>();
		const newer = deferred<unknown>();
		fetchJsonMock.mockReturnValueOnce(lookup.promise).mockReturnValueOnce(newer.promise);
		await search("https://podcasts.apple.com/us/podcast/apple-news-today/id1473872585");

		await type("apple news");
		await settle();
		lookup.resolve(lookupAppleNewsToday);
		await settle();
		expect(screen.getByRole("status")).toHaveTextContent("Searching");

		newer.resolve(searchAppleNews);
		expect(await result("Add Apple News In Conversation")).toBeInTheDocument();
		expect(screen.queryByRole("alert")).toBeNull();
	});
});

describe("a pasted link", () => {
	test("to Apple Podcasts shows the show behind it, named as from podcasts.apple.com", async () => {
		fetchJsonMock.mockResolvedValue(lookupHubermanLab);
		await search(APPLE_LINK);

		const show = await result("Add Huberman Lab");
		expect(screen.getByRole("status")).toHaveTextContent("1 show");
		expect(show).toHaveTextContent("podcasts.apple.com · Scicomm Media");
		await fireEvent.click(show);

		expect(get(savedFeeds)["Huberman Lab"]?.url).toBe("https://feeds.megaphone.fm/hubermanlab");
	});

	test("to an Apple Podcasts show without a public feed says so", async () => {
		fetchJsonMock.mockResolvedValue(lookupAppleNewsToday);

		await search("https://podcasts.apple.com/us/podcast/apple-news-today/id1473872585");

		expect(screen.getByRole("alert")).toHaveTextContent("This show has no public feed");
	});

	test("to an RSS feed shows that feed, named as an RSS feed", async () => {
		fetchTextMock.mockResolvedValue(
			"<rss><channel><title>toString</title><author>Host</author></channel></rss>",
		);
		await search("https://feeds.example.com/to-string.xml");

		const show = await result("Add toString");
		expect(show).toHaveTextContent("RSS feed · Host");
		await fireEvent.click(show);

		expect(Object.keys(get(savedFeeds))).toEqual(["toString"]);
		expect(services.navigation.current.page).toEqual({ kind: "feed", key: "toString" });
	});

	test("to a feed that does not load says so, never what the request said", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		fetchTextMock.mockRejectedValue(new Error(`refused ${PRIVATE_URL}`));

		await search(PRIVATE_URL);

		expect(screen.getByRole("alert")).toHaveTextContent(/^Feed didn't load$/);
	});
});

describe("a private feed", () => {
	test("that is followed shows as added when its address is pasted, also with an uppercase host", async () => {
		followPrivateShow(PRIVATE_URL.replace("www.patreon.com", "WWW.PATREON.COM"));

		await search(PRIVATE_URL);

		expect(await result("Open Private Show")).toHaveTextContent("Patron Host");
		expect(screen.queryByRole("button", { name: "Add Private Show" })).toBeNull();
	});

	test("that is followed under a title its channel changed since opens the saved subscription", async () => {
		const { saved } = followPrivateShow();
		fetchTextMock.mockResolvedValue(
			"<rss><channel><title>Renamed Show</title><author>Patron Host</author></channel></rss>",
		);
		await search(PRIVATE_URL);

		await fireEvent.click(await result("Open Renamed Show"));

		expect(get(savedFeeds)).toEqual({ "Private Show": saved });
		expect(services.navigation.current.page).toEqual({ kind: "feed", key: "Private Show" });
	});

	test("refused as a namesake stores none of its address", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		const { saved, secrets } = followPrivateShow();
		await search("https://www.patreon.com/rss/show?auth=other-tier");

		await fireEvent.click(await result("Add Private Show"));

		expect(notice).toHaveBeenCalledWith(
			"You already follow a podcast called Private Show from another feed.",
		);
		expect(get(savedFeeds)).toEqual({ "Private Show": saved });
		expect(secrets.listSecrets()).toEqual([saved.urlSecretId]);
	});

	test("followed without its address on this device says so instead of adding it", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		const { saved } = followPrivateShow();
		const thisDevice = new obsidian.SecretStorage();
		setUp(thisDevice);
		await search(PRIVATE_URL);

		await fireEvent.click(await result("Add Private Show"));

		expect(notice).toHaveBeenCalledWith(
			'The private feed address for "Private Show" is not available on this device.',
		);
		expect(get(savedFeeds)).toEqual({ "Private Show": saved });
		expect(thisDevice.listSecrets()).toEqual([]);
		expect(services.navigation.current.page).toEqual({ kind: "add" });
	});

	test("is not added when this device cannot keep its address", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		vi.spyOn(console, "error").mockImplementation(() => {});
		const secrets = new obsidian.SecretStorage();
		vi.spyOn(secrets, "setSecret").mockImplementation(() => {
			throw new Error("locked");
		});
		setUp(secrets);
		fetchTextMock.mockResolvedValue(
			"<rss><channel><title>Private Show</title></channel></rss>",
		);
		await search(PRIVATE_URL);

		await fireEvent.click(await result("Add Private Show"));

		expect(get(savedFeeds)).toEqual({});
		expect(notice).toHaveBeenCalledWith(
			'Could not store the private feed address for "Private Show" on this device.',
		);
	});

	test("added from a pasted address keeps the address out of the saved feed", async () => {
		fetchTextMock.mockResolvedValue(
			"<rss><channel><title>Private Show</title></channel></rss>",
		);
		await search(PRIVATE_URL);

		await fireEvent.click(await result("Add Private Show"));

		const saved = get(savedFeeds)["Private Show"];
		expect(saved.url).toBe(privateFeedPlaceholder("Private Show"));
		expect(JSON.stringify(saved)).not.toContain("se-cret");
		expect(within(document.body).queryByText(/se-cret/)).toBeNull();
	});
});
