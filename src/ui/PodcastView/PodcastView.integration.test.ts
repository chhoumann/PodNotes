// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import * as obsidian from "obsidian";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import createPodcastNote from "src/createPodcastNote";
import type { ParsedFeedEpisodes } from "src/parser/feedDocumentParser";
import { FeedRepository } from "src/services/FeedRepository";
import { FeedUrlRepository } from "src/services/FeedUrlRepository";
import { resolveFeedUrl } from "src/services/privateFeeds";
import {
	currentEpisode,
	hidePlayedEpisodes,
	playedEpisodes,
	plugin,
	savedFeeds,
	viewState,
} from "src/store";
import type { Episode } from "src/types/Episode";
import type { PodcastFeed } from "src/types/PodcastFeed";
import { ViewState } from "src/types/ViewState";
import { privateFeedPlaceholder } from "src/utility/privateFeedUrl";
import EpisodePlayerStub from "../../../tests/mocks/EpisodePlayerStub.svelte";
import { deferred, feedDocument, MemoryStorage } from "../../../tests/mocks/feeds";

vi.mock("./EpisodePlayer.svelte", () => ({
	default: EpisodePlayerStub,
}));

import PodcastView from "./PodcastView.svelte";

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
	viewState.set(ViewState.PodcastGrid);
	currentEpisode.update(() => undefined as unknown as Episode);
	plugin.set(undefined as never);
}

const listed = () =>
	Array.from(document.querySelectorAll(".episode-item-title"), (node) =>
		node.textContent?.trim(),
	);

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

		render(PodcastView);

		const feedImage = await screen.findByAltText(testFeed.title);
		await fireEvent.click(feedImage);

		const episodeNode = await screen.findByText(testEpisode.title);
		await fireEvent.click(episodeNode);

		expect(get(currentEpisode)).toMatchObject({ title: testEpisode.title });
		expect(get(viewState)).toBe(ViewState.Player);

		const current = get(currentEpisode);
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
		viewState.set(ViewState.EpisodeList);

		render(PodcastView);

		await screen.findByText("Fetching episodes...");

		first.resolve(feedDocument(testFeed.title, [firstEpisode]));

		expect(await screen.findByText(firstEpisode.title)).toBeInTheDocument();
		expect(screen.getByText("Fetching episodes...")).toBeInTheDocument();
		expect(screen.queryByText(secondEpisode.title)).toBeNull();

		second.resolve(feedDocument(secondFeed.title, [secondEpisode]));

		expect(await screen.findByText(secondEpisode.title)).toBeInTheDocument();
		await waitFor(() =>
			expect(screen.queryByText("Fetching episodes...")).not.toBeInTheDocument(),
		);
	});

	test("opens a global played episodes view from the podcast grid", async () => {
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

		render(PodcastView);

		const playedCard = await screen.findByLabelText("Played");
		await fireEvent.click(playedCard);

		expect(await screen.findByText("Already Finished")).toBeInTheDocument();
		expect(screen.getByText("Played")).toBeInTheDocument();
	});

	test("does not apply a delayed played feed refresh after leaving the played view", async () => {
		const playedEpisode = episode("Already Finished", testFeed, "2023-01-15T00:00:00.000Z");
		const refresh = deferred<ParsedFeedEpisodes>();
		respondByUrl({ [testFeed.url]: [testEpisode, playedEpisode] });
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

		render(PodcastView);

		const playedCard = await screen.findByLabelText("Played");
		await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(1));
		await fireEvent.click(playedCard);
		expect(await screen.findByText("Already Finished")).toBeInTheDocument();

		mockLoad.mockReturnValueOnce(refresh.promise);
		await fireEvent.click(screen.getByLabelText("Refresh episodes"));
		await fireEvent.click(screen.getByRole("button", { name: /latest episodes/i }));
		refresh.resolve(feedDocument(testFeed.title, [testEpisode]));

		await waitFor(() => expect(listed()).toEqual([testEpisode.title]));
		expect(screen.getByText("Latest Episodes")).toBeInTheDocument();
	});

	test("the Episode list tab shows episodes that loaded while the grid was open (#375)", async () => {
		usePlugin();

		render(PodcastView);
		await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(1));
		await screen.findByAltText(testFeed.title);
		await fireEvent.click(screen.getByRole("button", { name: /episode list/i }));

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
			render(PodcastView);
			await fireEvent.click(await screen.findByAltText(testFeed.title));
			expect(await screen.findByText(alphaEpisode.title)).toBeInTheDocument();
			refresh = deferred<ParsedFeedEpisodes>();
			mockLoad.mockReturnValueOnce(refresh.promise);
			await fireEvent.click(screen.getByLabelText("Refresh episodes"));
			expect(screen.getByText("Fetching episodes...")).toBeInTheDocument();
			expect(screen.queryByText(/Updating/)).toBeNull();
		});

		test("never lists it under the podcast opened since, and the banner clears", async () => {
			await fireEvent.click(screen.getByRole("button", { name: /podcast grid/i }));
			await fireEvent.click(await screen.findByAltText(secondFeed.title));
			expect(screen.getByText("Updating 1 feed")).toBeInTheDocument();

			refresh.resolve(feedDocument(testFeed.title, [alphaEpisode]));

			await waitFor(() => expect(screen.queryByText("Updating 1 feed")).toBeNull());
			await settled();
			expect(listed()).toEqual([betaEpisode.title]);
			expect(screen.getAllByText(secondFeed.title).length).toBeGreaterThan(0);
		});

		test("lists every podcast when the user went back to Latest Episodes", async () => {
			await fireEvent.click(screen.getByRole("button", { name: /latest episodes/i }));

			refresh.resolve(feedDocument(testFeed.title, [alphaEpisode]));

			await waitFor(() => expect(screen.queryByText(/Updating/)).toBeNull());
			await settled();
			expect(listed()).toEqual([alphaEpisode.title, betaEpisode.title]);
		});
	});

	test("an open podcast that is removed falls back to Latest Episodes", async () => {
		savedFeeds.set({ [testFeed.title]: testFeed, [secondFeed.title]: secondFeed });
		usePlugin();
		render(PodcastView);
		await fireEvent.click(await screen.findByAltText(secondFeed.title));
		await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(2));

		savedFeeds.set({ [testFeed.title]: testFeed });
		await fireEvent.click(await screen.findByLabelText("Refresh episodes"));

		expect(mockLoad).toHaveBeenLastCalledWith(testFeed.url);
		expect(await screen.findByText(testEpisode.title)).toBeInTheDocument();
	});

	test("a podcast that fails to load says so only when nothing can be shown", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		vi.spyOn(console, "error").mockImplementation(() => {});
		const failure = `Could not load episodes for ${testFeed.title}. Check your connection and try again.`;
		usePlugin();
		render(PodcastView);
		await fireEvent.click(await screen.findByAltText(testFeed.title));
		expect(await screen.findByText(testEpisode.title)).toBeInTheDocument();

		mockLoad.mockRejectedValue(new Error("offline"));
		await fireEvent.click(screen.getByLabelText("Refresh episodes"));
		await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(screen.queryByText("Fetching episodes...")).toBeNull());
		expect(notice).not.toHaveBeenCalledWith(failure);

		savedFeeds.set({ [testFeed.title]: testFeed, [secondFeed.title]: secondFeed });
		await fireEvent.click(screen.getByRole("button", { name: /podcast grid/i }));
		await fireEvent.click(await screen.findByAltText(secondFeed.title));
		await waitFor(() =>
			expect(notice).toHaveBeenCalledWith(
				`Could not load episodes for ${secondFeed.title}. Check your connection and try again.`,
			),
		);
		expect(notice).not.toHaveBeenCalledWith(failure);
	});

	test("a private podcast whose URL is not on this device says so when opened, not before", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		const patron: PodcastFeed = {
			title: "Patron Show",
			url: privateFeedPlaceholder("Patron Show"),
			urlSecretId: "podnotes-feed-url-gone",
			artworkUrl: "",
		};
		savedFeeds.set({ [testFeed.title]: testFeed, [patron.title]: patron });
		usePlugin();
		render(PodcastView);
		await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(1));
		expect(notice).not.toHaveBeenCalled();

		await fireEvent.click(await screen.findByRole("button", { name: patron.title }));

		await waitFor(() =>
			expect(notice.mock.calls).toEqual([
				[
					'The private feed URL for "Patron Show" is not available on this device. ' +
						"Remove the feed and add it again with its private URL.",
				],
			]),
		);
		expect(mockLoad).toHaveBeenCalledTimes(1);
	});

	test("Latest Episodes drops a podcast as soon as it is removed", async () => {
		const betaEpisode = episode("Beta One", secondFeed, "2024-02-01T00:00:00.000Z");
		respondByUrl({ [testFeed.url]: [testEpisode], [secondFeed.url]: [betaEpisode] });
		savedFeeds.set({ [testFeed.title]: testFeed, [secondFeed.title]: secondFeed });
		viewState.set(ViewState.EpisodeList);
		usePlugin();
		render(PodcastView);
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
		render(PodcastView);

		const feedImage = await screen.findByAltText(testFeed.title);
		expect(mockLoad).not.toHaveBeenCalled();
		await fireEvent.click(feedImage);

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

		render(PodcastView);

		const playedCard = await screen.findByLabelText("Played");
		expect(mockLoad).not.toHaveBeenCalled();
		await fireEvent.click(playedCard);

		await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(1));
		expect(await screen.findByText("Played")).toBeInTheDocument();
		expect(await screen.findByText(oldEpisode.title)).toBeInTheDocument();
		expect(screen.queryByText("Unavailable in current feeds")).not.toBeInTheDocument();

		await fireEvent.click(screen.getByText(oldEpisode.title));
		expect(get(currentEpisode)).toMatchObject({ title: oldEpisode.title });
		expect(get(viewState)).toBe(ViewState.Player);
	});

	test("latest episodes background fetch still uses the truncated cache", async () => {
		viewState.set(ViewState.EpisodeList);

		render(PodcastView);

		expect(await screen.findByText(createNumberedEpisode(622).title)).toBeInTheDocument();
		expect(mockLoad).not.toHaveBeenCalled();
		expect(screen.queryByText(oldEpisode.title)).not.toBeInTheDocument();
	});

	test("reopening a show reuses the full feed without refetching", async () => {
		render(PodcastView);

		const feedImage = await screen.findByAltText(testFeed.title);
		await fireEvent.click(feedImage);

		await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(1));
		expect(await screen.findByText(oldEpisode.title)).toBeInTheDocument();

		await fireEvent.click(screen.getByRole("button", { name: /podcast grid/i }));
		expect(get(viewState)).toBe(ViewState.PodcastGrid);

		await fireEvent.click(await screen.findByAltText(testFeed.title));
		expect(await screen.findByText(oldEpisode.title)).toBeInTheDocument();
		expect(mockLoad).toHaveBeenCalledTimes(1);
	});

	test("falls back to truncated cache when a full feed fetch fails", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		mockLoad.mockRejectedValue(new Error("network unavailable"));

		render(PodcastView);

		const feedImage = await screen.findByAltText(testFeed.title);
		await fireEvent.click(feedImage);

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

		render(PodcastView);

		const playedCard = await screen.findByLabelText("Played");
		await fireEvent.click(playedCard);

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

		render(PodcastView);

		const playedCard = await screen.findByLabelText("Played");
		await fireEvent.click(playedCard);

		await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(1));
		expect(await screen.findByText(oldEpisode.title)).toBeInTheDocument();

		await fireEvent.click(screen.getByRole("button", { name: /latest episodes/i }));
		await fireEvent.click(playedCard);

		expect(await screen.findByText(oldEpisode.title)).toBeInTheDocument();
		expect(mockLoad).toHaveBeenCalledTimes(1);
	});
});
