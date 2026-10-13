// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import * as obsidian from "obsidian";
import { get, readable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import createPodcastNote from "src/createPodcastNote";
import type { ParsedFeedEpisodes } from "src/parser/feedDocumentParser";
import { FeedRepository } from "src/services/FeedRepository";
import { FeedUrlRepository } from "src/services/FeedUrlRepository";
import { createLibraryActions } from "src/services/library";
import { resolveFeedUrl } from "src/services/privateFeeds";
import { hidePlayedEpisodes, playedEpisodes, plugin, savedFeeds } from "src/store";
import type { Episode } from "src/types/Episode";
import type { PodcastFeed } from "src/types/PodcastFeed";
import { privateFeedPlaceholder } from "src/utility/privateFeedUrl";
import EpisodePlayerStub from "../../../tests/mocks/EpisodePlayerStub.svelte";
import { deferred, feedDocument, MemoryStorage } from "../../../tests/mocks/feeds";
import { pluginLibrary } from "../../../tests/mocks/services";
import { FakeDocument } from "../../../tests/mocks/fakeMedia";
import { DEFAULT_SETTINGS } from "src/constants";
import { PlayerController } from "src/player/PlayerController";
import { Navigation } from "./Navigation";
import { PodcastSearch } from "./podcastSearch";

vi.mock("./EpisodePlayer.svelte", () => ({
	default: EpisodePlayerStub,
}));

import PodcastView from "./PodcastView.svelte";

function renderView() {
	const app = new obsidian.App();
	const { feeds } = get(plugin);
	return render(PodcastView, {
		props: {
			services: {
				app,
				api: {} as never,
				player,
				feeds,
				navigation,
				library: pluginLibrary,
				actions: createLibraryActions({
					app,
					feeds,
					feedUrls: new FeedUrlRepository(app.secretStorage),
				}),
				search: new PodcastSearch(feeds),
				settings: readable(structuredClone(DEFAULT_SETTINGS)),
				captureTimestamp: async () => null,
				openSettings: () => {},
				hasNote: () => false,
				rowHasNote: readable(() => false),
			},
		},
	});
}

const back = () => fireEvent.click(screen.getByRole("button", { name: /^Back to / }));
const openList = (name: string) =>
	fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${name}`) }));

const mockLoad = vi.fn<(url: string) => Promise<ParsedFeedEpisodes>>();

const testFeed: PodcastFeed = {
	title: "Test Podcast",
	url: "https://pod.example.com/feed.xml",
	artworkUrl: "https://pod.example.com/art.jpg",
};

const secondFeed: PodcastFeed = {
	title: "Second Podcast",
	url: "https://pod.example.com/feed-two.xml",
	artworkUrl: "https://pod.example.com/art-two.jpg",
};

const testEpisode: Episode = {
	title: "Episode 1: Launch",
	streamUrl: "https://pod.example.com/audio.mp3",
	url: "https://pod.example.com/episode-1",
	description: "Episode description",
	content: "<p>Episode content</p>",
	podcastName: testFeed.title,
	artworkUrl: testFeed.artworkUrl,
	episodeDate: new Date("2024-01-15T00:00:00.000Z"),
};

function episode(title: string, feed: PodcastFeed, date: string): Episode {
	return {
		title,
		streamUrl: `https://pod.example.com/${encodeURIComponent(title)}.mp3`,
		url: `https://pod.example.com/${encodeURIComponent(title)}`,
		description: `${title} description`,
		content: "",
		podcastName: feed.title,
		artworkUrl: feed.artworkUrl,
		episodeDate: new Date(date),
	};
}

function createNumberedEpisode(number: number): Episode {
	return {
		title: `Episode ${number}`,
		streamUrl: `https://pod.example.com/ep-${number}.mp3`,
		url: `https://pod.example.com/ep-${number}`,
		description: `Description for episode ${number}`,
		content: `<p>Episode ${number}</p>`,
		podcastName: testFeed.title,
		artworkUrl: testFeed.artworkUrl,
		episodeDate: new Date(
			`2024-${String((number % 12) + 1).padStart(2, "0")}-15T00:00:00.000Z`,
		),
	};
}

function createTruncatedFeedCache(): Episode[] {
	return Array.from({ length: 75 }, (_, index) => createNumberedEpisode(622 + index));
}

// The cache keeps the newest 75 by date, so the extra episode is the oldest.
function createFullFeed(): Episode[] {
	return [
		{ ...createNumberedEpisode(100), episodeDate: new Date("2023-01-15T00:00:00.000Z") },
		...createTruncatedFeedCache(),
	];
}

let storage = new MemoryStorage();
let unsubscribeFeeds = () => {};

/** Builds the plugin the view reads, with a repository fed by `mockLoad` and `storage`. */
function usePlugin(fields: Record<string, unknown> = {}, cacheEnabled = false) {
	const feedUrls = new FeedUrlRepository(new obsidian.SecretStorage());
	const feeds = new FeedRepository({
		load: (url) => mockLoad(url),
		resolveUrl: (feed) => resolveFeedUrl(feed, feedUrls),
		storage,
		cache: () => ({ enabled: cacheEnabled, ttlHours: 6 }),
		now: Date.now,
	});
	unsubscribeFeeds();
	unsubscribeFeeds = savedFeeds.subscribe((saved) => feeds.setSubscriptions(saved));
	plugin.set({
		settings: { feedCache: { enabled: cacheEnabled, ttlHours: 6 } },
		...fields,
		feeds,
		player,
	} as never);
	return feeds;
}

/** Writes feeds into `storage` the way an earlier session would have. */
async function cacheFeeds(...entries: [PodcastFeed, Episode[]][]) {
	const earlier = new FeedRepository({
		load: async (url) => {
			const [feed, episodes] = entries.find(([candidate]) => candidate.url === url)!;
			return feedDocument(feed.title, episodes);
		},
		resolveUrl: (saved) => saved.url,
		storage,
		cache: () => ({ enabled: true, ttlHours: 6 }),
		now: Date.now,
	});
	earlier.setSubscriptions(Object.fromEntries(entries.map(([feed]) => [feed.title, feed])));
	await earlier.ensureAll();
}

function respondByUrl(responses: Record<string, Episode[]>) {
	mockLoad.mockImplementation(async (url) => {
		const feed = [testFeed, secondFeed].find((candidate) => candidate.url === url);
		return feedDocument(feed?.title ?? url, responses[url] ?? []);
	});
}

function resetStores() {
	unsubscribeFeeds();
	unsubscribeFeeds = () => {};
	savedFeeds.set({});
	hidePlayedEpisodes.set(false);
	playedEpisodes.set({});
	navigation = new Navigation();
	player = new PlayerController(new FakeDocument().asPlayerDocument(), {
		settings: structuredClone(DEFAULT_SETTINGS),
		app: { vault: {} as never },
		checkpoint: (update) => update(),
		saveSettings: () => Promise.resolve(),
	});
	plugin.set(undefined as never);
}

let player: PlayerController;
let navigation: Navigation;
const playingEpisode = () => get(player.state).episode;

const listed = () =>
	Array.from(document.querySelectorAll(".pn-ep-title"), (node) => node.textContent?.trim());

beforeEach(() => {
	resetStores();
	storage = new MemoryStorage();
	savedFeeds.set({ [testFeed.title]: testFeed });
	respondByUrl({ [testFeed.url]: [testEpisode] });
});

afterEach(() => {
	resetStores();
	mockLoad.mockReset();
	delete (globalThis as Record<string, unknown>).app;
});

function bootstrapAppMock() {
	const createdFiles: Array<{ path: string; data: string }> = [];
	const leaf = { openFile: vi.fn() };
	const appMock = {
		vault: {
			getAbstractFileByPath: vi.fn(() => null),
			createFolder: vi.fn(async () => {}),
			create: vi.fn(async (path: string, data: string) => {
				const file = { path, data };
				createdFiles.push(file);
				return file;
			}),
		},
		workspace: {
			getLeaf: vi.fn(() => leaf),
		},
	};

	(globalThis as { app?: typeof appMock }).app = appMock;

	return { appMock, createdFiles, leaf };
}

describe("PodcastView integration flow", () => {
	test("select feed → play episode → create note with resolved template", async () => {
		const { appMock, createdFiles, leaf } = bootstrapAppMock();

		// createPodcastNote resolves the vault/workspace off the plugin's app
		// reference (get(plugin).app), so expose the same mock there too.
		usePlugin({
			app: appMock,
			settings: {
				note: {
					path: "Podcasts/{{podcast}}/{{date}}/{{title}}",
					template: "# {{title}}\n{{description}}\nStream: {{stream}}",
				},
				feedCache: { enabled: false, ttlHours: 6 },
			},
		});

		renderView();

		const feedCard = await screen.findByRole("button", { name: testFeed.title });
		await fireEvent.click(feedCard);

		const episodeNode = await screen.findByText(testEpisode.title);
		await fireEvent.click(episodeNode);

		expect(playingEpisode()).toMatchObject({ title: testEpisode.title });
		expect(navigation.current.expanded).toBe(true);

		const current = playingEpisode();
		expect(current).toBeDefined();
		await createPodcastNote(current as Episode);

		const expectedPath = "Podcasts/Test Podcast/2024-01-15/Episode 1 Launch.md";

		expect(createdFiles[0].path).toBe(expectedPath);
		expect(createdFiles[0].data).toBe(
			"# Episode 1: Launch\nEpisode description\nStream: https://pod.example.com/audio.mp3",
		);
		expect(leaf.openFile).toHaveBeenCalledWith(expect.objectContaining({ path: expectedPath }));
	});

	test("shows loading state while fetching and streams episodes per feed", async () => {
		const firstEpisode = episode("Episode A", testFeed, "2024-02-01T00:00:00.000Z");
		const secondEpisode = episode("Episode B", secondFeed, "2024-01-15T00:00:00.000Z");
		const first = deferred<ParsedFeedEpisodes>();
		const second = deferred<ParsedFeedEpisodes>();
		mockLoad.mockImplementation((url) =>
			url === testFeed.url ? first.promise : second.promise,
		);
		usePlugin();
		savedFeeds.set({ [testFeed.title]: testFeed, [secondFeed.title]: secondFeed });
		navigation.goRoot("latest");

		renderView();

		await screen.findByText("Loading episodes");

		first.resolve(feedDocument(testFeed.title, [firstEpisode]));

		expect(await screen.findByText(firstEpisode.title)).toBeInTheDocument();
		expect(screen.getByText("Loading episodes")).toBeInTheDocument();
		expect(screen.queryByText(secondEpisode.title)).toBeNull();

		second.resolve(feedDocument(secondFeed.title, [secondEpisode]));

		expect(await screen.findByText(secondEpisode.title)).toBeInTheDocument();
		await waitFor(() => expect(screen.queryByText("Loading episodes")).not.toBeInTheDocument());
	});

	test("opens a global played episodes view from the library", async () => {
		const playedEpisode = episode("Already Finished", testFeed, "2023-01-15T00:00:00.000Z");
		respondByUrl({ [testFeed.url]: [testEpisode, playedEpisode] });
		hidePlayedEpisodes.set(true);
		playedEpisodes.set({
			[`${testFeed.title}::${playedEpisode.title}`]: {
				title: playedEpisode.title,
				podcastName: testFeed.title,
				time: 100,
				duration: 100,
				finished: true,
			},
		});
		usePlugin();

		renderView();

		await openList("Played");

		expect(await screen.findByText("Already Finished")).toBeInTheDocument();
		expect(screen.getByText("Played")).toBeInTheDocument();
	});

	test("Latest episodes shows episodes that loaded while the library was open (#375)", async () => {
		usePlugin();

		renderView();
		await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(1));
		await screen.findByRole("button", { name: testFeed.title });
		await openList("Latest episodes");

		expect(await screen.findByText(testEpisode.title)).toBeInTheDocument();
	});

	describe("a refresh that answers after the user moved on", () => {
		// The refresh handler resumes after its load settles, a few promise hops after
		// the banner clears; one macrotask lets it finish before the list is read.
		const settled = () => new Promise((resolve) => setTimeout(resolve));
		const alphaEpisode = episode("Alpha One", testFeed, "2024-03-01T00:00:00.000Z");
		const betaEpisode = episode("Beta One", secondFeed, "2024-02-01T00:00:00.000Z");
		let refresh: ReturnType<typeof deferred<ParsedFeedEpisodes>>;

		beforeEach(async () => {
			respondByUrl({ [testFeed.url]: [alphaEpisode], [secondFeed.url]: [betaEpisode] });
			savedFeeds.set({ [testFeed.title]: testFeed, [secondFeed.title]: secondFeed });
			usePlugin();
			renderView();
			await fireEvent.click(await screen.findByRole("button", { name: testFeed.title }));
			expect(await screen.findByText(alphaEpisode.title)).toBeInTheDocument();
			refresh = deferred<ParsedFeedEpisodes>();
			mockLoad.mockReturnValueOnce(refresh.promise);
			await fireEvent.click(screen.getByLabelText("Refresh episodes"));
			expect(screen.getByText("Loading episodes")).toBeInTheDocument();
		});

		test("never lists it under the podcast opened since", async () => {
			await back();
			await fireEvent.click(await screen.findByRole("button", { name: secondFeed.title }));
			expect(get(get(plugin).feeds).get(testFeed.title)?.status).toBe("loading");

			refresh.resolve(feedDocument(testFeed.title, [alphaEpisode]));

			await waitFor(() =>
				expect(get(get(plugin).feeds).get(testFeed.title)?.status).toBe("ready"),
			);
			await settled();
			expect(listed()).toEqual([betaEpisode.title]);
			expect(screen.getAllByText(secondFeed.title).length).toBeGreaterThan(0);
		});

		test("lists every podcast when the user went on to Latest episodes", async () => {
			await back();
			await openList("Latest episodes");

			refresh.resolve(feedDocument(testFeed.title, [alphaEpisode]));

			await waitFor(() => expect(screen.queryByText("Loading episodes")).toBeNull());
			await settled();
			expect(listed()).toEqual([alphaEpisode.title, betaEpisode.title]);
		});
	});

	test("an open podcast that is removed falls back to Latest Episodes", async () => {
		savedFeeds.set({ [testFeed.title]: testFeed, [secondFeed.title]: secondFeed });
		usePlugin();
		renderView();
		await fireEvent.click(await screen.findByRole("button", { name: secondFeed.title }));
		await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(2));

		savedFeeds.set({ [testFeed.title]: testFeed });
		expect(await screen.findByRole("heading", { name: "Latest episodes" })).toBeInTheDocument();
		await fireEvent.click(screen.getByLabelText("Refresh all feeds"));

		expect(mockLoad).toHaveBeenLastCalledWith(testFeed.url);
		expect(await screen.findByText(testEpisode.title)).toBeInTheDocument();
	});

	test("a podcast that fails to load says so on its page and keeps what it can show", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		vi.spyOn(console, "error").mockImplementation(() => {});
		usePlugin();
		renderView();
		await fireEvent.click(await screen.findByRole("button", { name: testFeed.title }));
		expect(await screen.findByText(testEpisode.title)).toBeInTheDocument();
		expect(screen.queryByRole("alert")).toBeNull();

		mockLoad.mockRejectedValue(new Error("offline"));
		await fireEvent.click(screen.getByLabelText("Refresh episodes"));
		await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(screen.queryByText("Loading episodes")).toBeNull());
		const banner = await screen.findByRole("alert");
		expect(banner).toHaveTextContent("Feed didn't load");
		expect(banner).toHaveTextContent("pod.example.com");
		expect(within(banner).getByRole("button", { name: "Retry" })).toBeEnabled();
		expect(listed()).toEqual([testEpisode.title]);

		savedFeeds.set({ [testFeed.title]: testFeed, [secondFeed.title]: secondFeed });
		await back();
		await fireEvent.click(await screen.findByRole("button", { name: /^Second Podcast/ }));
		await waitFor(() => expect(mockLoad).toHaveBeenCalledWith(secondFeed.url));
		expect(await screen.findByText("No episodes")).toBeInTheDocument();
		expect(screen.getByRole("alert")).toHaveTextContent("Feed didn't load");
		expect(listed()).toEqual([]);
		expect(notice).not.toHaveBeenCalled();
	});

	test("a private podcast whose URL is not on this device asks for it on its page, not before", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		const patron: PodcastFeed = {
			title: "Patron Show",
			url: privateFeedPlaceholder("Patron Show"),
			urlSecretId: "podnotes-feed-url-gone",
			artworkUrl: "",
		};
		savedFeeds.set({ [testFeed.title]: testFeed, [patron.title]: patron });
		usePlugin();
		renderView();
		await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(1));
		expect(screen.queryByRole("alert")).toBeNull();

		await fireEvent.click(
			await screen.findByRole("button", { name: "Patron Show, feed didn't load" }),
		);

		const banner = await screen.findByRole("alert");
		expect(banner).toHaveTextContent("Feed didn't load");
		expect(banner).toHaveTextContent("Address not on this device");
		expect(
			within(banner).getByRole("button", { name: "Set feed address" }),
		).toBeInTheDocument();
		expect(within(banner).queryByRole("button", { name: "Retry" })).toBeNull();
		await new Promise((resolve) => setTimeout(resolve));
		expect(mockLoad).toHaveBeenCalledTimes(1);
		expect(notice).not.toHaveBeenCalled();
	});

	test("Latest Episodes drops a podcast as soon as it is removed", async () => {
		const betaEpisode = episode("Beta One", secondFeed, "2024-02-01T00:00:00.000Z");
		respondByUrl({ [testFeed.url]: [testEpisode], [secondFeed.url]: [betaEpisode] });
		savedFeeds.set({ [testFeed.title]: testFeed, [secondFeed.title]: secondFeed });
		navigation.goRoot("latest");
		usePlugin();
		renderView();
		await waitFor(() => expect(listed()).toEqual([betaEpisode.title, testEpisode.title]));

		savedFeeds.set({ [testFeed.title]: testFeed });

		await waitFor(() => expect(listed()).toEqual([testEpisode.title]));
	});
});

describe("issue #174 feed cache cap regression", () => {
	const fullFeed = createFullFeed();
	const [oldEpisode, ...truncatedCache] = fullFeed;

	beforeEach(async () => {
		await cacheFeeds([testFeed, fullFeed]);
		respondByUrl({ [testFeed.url]: fullFeed });
		usePlugin({}, true);
	});

	test("opening a show bypasses the truncated cache and loads older episodes", async () => {
		renderView();

		const feedCard = await screen.findByRole("button", { name: testFeed.title });
		expect(mockLoad).not.toHaveBeenCalled();
		await fireEvent.click(feedCard);

		await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(1));
		expect(await screen.findByText(oldEpisode.title)).toBeInTheDocument();
		expect(listed()).toHaveLength(76);
	});

	test("played view bypasses the truncated cache for older finished episodes", async () => {
		hidePlayedEpisodes.set(true);
		playedEpisodes.set({
			[`${testFeed.title}::${oldEpisode.title}`]: {
				title: oldEpisode.title,
				podcastName: testFeed.title,
				time: 3600,
				duration: 3600,
				finished: true,
			},
		});

		renderView();

		await screen.findByRole("button", { name: testFeed.title });
		expect(mockLoad).not.toHaveBeenCalled();
		await openList("Played");

		await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(1));
		expect(await screen.findByText("Played")).toBeInTheDocument();
		expect(await screen.findByText(oldEpisode.title)).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: `${oldEpisode.title}, played` }),
		).not.toHaveAttribute("aria-disabled");

		await fireEvent.click(screen.getByText(oldEpisode.title));
		expect(playingEpisode()).toMatchObject({ title: oldEpisode.title });
		expect(navigation.current.expanded).toBe(true);
	});

	test("latest episodes background fetch still uses the truncated cache", async () => {
		navigation.goRoot("latest");

		renderView();

		expect(await screen.findByText(createNumberedEpisode(622).title)).toBeInTheDocument();
		expect(mockLoad).not.toHaveBeenCalled();
		expect(screen.queryByText(oldEpisode.title)).not.toBeInTheDocument();
	});

	test("reopening a show reuses the full feed without refetching", async () => {
		renderView();

		const feedCard = await screen.findByRole("button", { name: testFeed.title });
		await fireEvent.click(feedCard);

		await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(1));
		expect(await screen.findByText(oldEpisode.title)).toBeInTheDocument();

		await back();
		expect(navigation.current.page).toEqual({ kind: "library" });

		await fireEvent.click(await screen.findByRole("button", { name: testFeed.title }));
		expect(await screen.findByText(oldEpisode.title)).toBeInTheDocument();
		expect(mockLoad).toHaveBeenCalledTimes(1);
	});

	test("falls back to truncated cache when a full feed fetch fails", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		mockLoad.mockRejectedValue(new Error("network unavailable"));

		renderView();

		const feedCard = await screen.findByRole("button", { name: testFeed.title });
		await fireEvent.click(feedCard);

		expect(await screen.findByText(createNumberedEpisode(622).title)).toBeInTheDocument();
		await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(1));
		expect(screen.queryByText(oldEpisode.title)).not.toBeInTheDocument();
		expect(listed()).toHaveLength(truncatedCache.length);
	});

	test("played view only fetches feeds with finished played episodes", async () => {
		hidePlayedEpisodes.set(true);
		await cacheFeeds([testFeed, fullFeed], [secondFeed, [createNumberedEpisode(900)]]);
		savedFeeds.set({ [testFeed.title]: testFeed, [secondFeed.title]: secondFeed });
		playedEpisodes.set({
			[`${testFeed.title}::${oldEpisode.title}`]: {
				title: oldEpisode.title,
				podcastName: testFeed.title,
				time: 3600,
				duration: 3600,
				finished: true,
			},
		});
		usePlugin({}, true);

		renderView();

		await openList("Played");

		expect(await screen.findByText(oldEpisode.title)).toBeInTheDocument();
		expect(mockLoad.mock.calls).toEqual([[testFeed.url]]);
	});

	test("reopening played view reuses the full feed without refetching", async () => {
		hidePlayedEpisodes.set(true);
		playedEpisodes.set({
			[`${testFeed.title}::${oldEpisode.title}`]: {
				title: oldEpisode.title,
				podcastName: testFeed.title,
				time: 3600,
				duration: 3600,
				finished: true,
			},
		});

		renderView();

		await openList("Played");

		await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(1));
		expect(await screen.findByText(oldEpisode.title)).toBeInTheDocument();

		await back();
		await openList("Played");

		expect(await screen.findByText(oldEpisode.title)).toBeInTheDocument();
		expect(mockLoad).toHaveBeenCalledTimes(1);
	});
});
