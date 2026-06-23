import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { get } from "svelte/store";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from "vitest";

import createPodcastNote from "src/createPodcastNote";
import {
	clearFeedCache,
	setCachedEpisodes,
} from "src/services/FeedCacheService";
import {
	currentEpisode,
	episodeCache,
	hidePlayedEpisodes,
	playedEpisodes,
	plugin,
	savedFeeds,
	viewState,
} from "src/store";
import type { Episode } from "src/types/Episode";
import type { PodcastFeed } from "src/types/PodcastFeed";
import { ViewState } from "src/types/ViewState";
import EpisodePlayerStub from "../../../tests/mocks/EpisodePlayerStub.svelte";

vi.mock("./EpisodePlayer.svelte", () => ({
	default: EpisodePlayerStub,
}));

import PodcastView from "./PodcastView.svelte";

const mockGetEpisodes = vi.fn<() => Promise<Episode[]>>();

vi.mock("src/parser/feedParser", () => {
	return {
		default: class {
			async getEpisodes() {
				return mockGetEpisodes();
			}
		},
	};
});

const testFeed: PodcastFeed = {
	title: "Test Podcast",
	url: "https://pod.example.com/feed.xml",
	artworkUrl: "https://pod.example.com/art.jpg",
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

function resetStores() {
	savedFeeds.set({});
	episodeCache.set({});
	hidePlayedEpisodes.set(false);
	playedEpisodes.set({});
	viewState.set(ViewState.PodcastGrid);
	currentEpisode.update(() => undefined as unknown as Episode);
	plugin.set(undefined as never);
	clearFeedCache();
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
	return Array.from({ length: 75 }, (_, index) =>
		createNumberedEpisode(622 + index),
	);
}

function createFullFeed(): Episode[] {
	return [createNumberedEpisode(100), ...createTruncatedFeedCache()];
}

function enableFeedCache() {
	plugin.set({
		settings: {
			feedCache: {
				enabled: true,
				ttlHours: 6,
			},
		},
	} as never);
}

beforeEach(() => {
	resetStores();
	savedFeeds.set({ [testFeed.title]: testFeed });
	mockGetEpisodes.mockResolvedValue([testEpisode]);
});

afterEach(() => {
	resetStores();
	mockGetEpisodes.mockClear();
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

		const pluginSettings = {
			// createPodcastNote resolves the vault/workspace off the plugin's app
			// reference (get(plugin).app), so expose the same mock there too.
			app: appMock,
			settings: {
				note: {
					path: "Podcasts/{{podcast}}/{{date}}/{{title}}",
					template: "# {{title}}\n{{description}}\nStream: {{stream}}",
				},
				feedCache: {
					enabled: false,
					ttlHours: 6,
				},
			},
		};
		plugin.set(pluginSettings as never);

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

		const expectedPath =
			"Podcasts/Test Podcast/2024-01-15/Episode 1 Launch.md";

		expect(createdFiles[0].path).toBe(expectedPath);
		expect(createdFiles[0].data).toBe(
			"# Episode 1: Launch\nEpisode description\nStream: https://pod.example.com/audio.mp3",
		);
		expect(leaf.openFile).toHaveBeenCalledWith(
			expect.objectContaining({ path: expectedPath }),
		);
	});

	test("shows loading state while fetching and streams episodes per feed", async () => {
		const secondFeed: PodcastFeed = {
			title: "Second Podcast",
			url: "https://pod.example.com/feed-two.xml",
			artworkUrl: "https://pod.example.com/art-two.jpg",
		};

		const firstEpisode: Episode = {
			title: "Episode A",
			streamUrl: "https://pod.example.com/a.mp3",
			url: "https://pod.example.com/a",
			description: "Episode A description",
			content: "<p>Episode A content</p>",
			podcastName: testFeed.title,
			artworkUrl: testFeed.artworkUrl,
			episodeDate: new Date("2024-02-01T00:00:00.000Z"),
		};

		const secondEpisode: Episode = {
			title: "Episode B",
			streamUrl: "https://pod.example.com/b.mp3",
			url: "https://pod.example.com/b",
			description: "Episode B description",
			content: "<p>Episode B content</p>",
			podcastName: secondFeed.title,
			artworkUrl: secondFeed.artworkUrl,
			episodeDate: new Date("2024-01-15T00:00:00.000Z"),
		};

		let resolveFirstFeed!: (value: Episode[]) => void;
		let resolveSecondFeed!: (value: Episode[]) => void;

		mockGetEpisodes
			.mockImplementationOnce(
				() =>
					new Promise<Episode[]>((resolve) => {
						resolveFirstFeed = resolve;
					}),
			)
			.mockImplementationOnce(
				() =>
					new Promise<Episode[]>((resolve) => {
						resolveSecondFeed = resolve;
					}),
			);

		plugin.set({
			settings: {
				feedCache: {
					enabled: false,
					ttlHours: 6,
				},
			},
		} as never);

		savedFeeds.set({
			[testFeed.title]: testFeed,
			[secondFeed.title]: secondFeed,
		});
		viewState.set(ViewState.EpisodeList);

		render(PodcastView);

		await screen.findByText("Fetching episodes...");

		resolveFirstFeed([firstEpisode]);

		expect(
			await screen.findByText(firstEpisode.title),
		).toBeInTheDocument();
		expect(screen.getByText("Fetching episodes...")).toBeInTheDocument();
		expect(screen.queryByText(secondEpisode.title)).toBeNull();

		resolveSecondFeed([secondEpisode]);

		expect(
			await screen.findByText(secondEpisode.title),
		).toBeInTheDocument();
		await waitFor(() =>
			expect(
				screen.queryByText("Fetching episodes..."),
			).not.toBeInTheDocument(),
		);
	});

	test("opens a global played episodes view from the podcast grid", async () => {
		const playedEpisode: Episode = {
			title: "Already Finished",
			streamUrl: "https://pod.example.com/finished.mp3",
			url: "https://pod.example.com/finished",
			description: "Finished episode description",
			content: "<p>Finished episode content</p>",
			podcastName: testFeed.title,
			artworkUrl: testFeed.artworkUrl,
			episodeDate: new Date("2023-01-15T00:00:00.000Z"),
		};

		mockGetEpisodes.mockResolvedValue([testEpisode, playedEpisode]);
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

		render(PodcastView);

		const playedCard = await screen.findByLabelText("Played");
		await fireEvent.click(playedCard);

		expect(await screen.findByText("Already Finished")).toBeInTheDocument();
		expect(screen.getByText("Played")).toBeInTheDocument();
	});

	test("does not apply a delayed played feed refresh after leaving the played view", async () => {
		const playedEpisode: Episode = {
			title: "Already Finished",
			streamUrl: "https://pod.example.com/finished.mp3",
			url: "https://pod.example.com/finished",
			description: "Finished episode description",
			content: "<p>Finished episode content</p>",
			podcastName: testFeed.title,
			artworkUrl: testFeed.artworkUrl,
			episodeDate: new Date("2023-01-15T00:00:00.000Z"),
		};
		let resolvePlayedFetch!: (value: Episode[]) => void;

		mockGetEpisodes
			.mockResolvedValueOnce([testEpisode])
			.mockImplementationOnce(
				() =>
					new Promise<Episode[]>((resolve) => {
						resolvePlayedFetch = resolve;
					}),
			);
		playedEpisodes.set({
			[`${testFeed.title}::${playedEpisode.title}`]: {
				title: playedEpisode.title,
				podcastName: testFeed.title,
				time: 100,
				duration: 100,
				finished: true,
			},
		});
		plugin.set({
			settings: {
				feedCache: {
					enabled: false,
					ttlHours: 6,
				},
			},
		} as never);

		render(PodcastView);

		const playedCard = await screen.findByLabelText("Played");
		await waitFor(() => expect(mockGetEpisodes).toHaveBeenCalledTimes(1));
		episodeCache.set({});

		await fireEvent.click(playedCard);
		expect(await screen.findByText("Played")).toBeInTheDocument();

		await fireEvent.click(
			screen.getByRole("button", { name: /latest episodes/i }),
		);
		expect(screen.queryByText("Already Finished")).not.toBeInTheDocument();

		resolvePlayedFetch([testEpisode]);

		expect(await screen.findByText(testEpisode.title)).toBeInTheDocument();
		expect(screen.queryByText("Already Finished")).not.toBeInTheDocument();
	});
});

describe("issue #174 feed cache cap regression", () => {
	const oldEpisode = createNumberedEpisode(100);
	const truncatedCache = createTruncatedFeedCache();
	const fullFeed = createFullFeed();

	beforeEach(() => {
		enableFeedCache();
		episodeCache.set({ [testFeed.title]: truncatedCache });
		setCachedEpisodes(testFeed, truncatedCache);
		mockGetEpisodes.mockResolvedValue(fullFeed);
	});

	test("opening a show bypasses the truncated cache and loads older episodes", async () => {
		render(PodcastView);

		await waitFor(() =>
			expect(get(episodeCache)[testFeed.title]).toHaveLength(75),
		);
		expect(mockGetEpisodes).not.toHaveBeenCalled();

		const feedImage = await screen.findByAltText(testFeed.title);
		await fireEvent.click(feedImage);

		await waitFor(() => expect(mockGetEpisodes).toHaveBeenCalledTimes(1));
		expect(
			await screen.findByText(oldEpisode.title),
		).toBeInTheDocument();
		expect(get(episodeCache)[testFeed.title]).toHaveLength(76);
		expect(
			screen.queryByText(createNumberedEpisode(621).title),
		).not.toBeInTheDocument();
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

		await waitFor(() =>
			expect(get(episodeCache)[testFeed.title]).toHaveLength(75),
		);
		expect(mockGetEpisodes).not.toHaveBeenCalled();

		const playedCard = await screen.findByLabelText("Played");
		await fireEvent.click(playedCard);

		await waitFor(() => expect(mockGetEpisodes).toHaveBeenCalledTimes(1));
		expect(await screen.findByText("Played")).toBeInTheDocument();
		expect(
			await screen.findByText(oldEpisode.title),
		).toBeInTheDocument();
		expect(
			screen.queryByText("Unavailable in current feeds"),
		).not.toBeInTheDocument();

		await fireEvent.click(screen.getByText(oldEpisode.title));
		expect(get(currentEpisode)).toMatchObject({ title: oldEpisode.title });
		expect(get(viewState)).toBe(ViewState.Player);
	});

	test("latest episodes background fetch still uses the truncated cache", async () => {
		viewState.set(ViewState.EpisodeList);

		render(PodcastView);

		await waitFor(() =>
			expect(get(episodeCache)[testFeed.title]).toHaveLength(75),
		);
		expect(mockGetEpisodes).not.toHaveBeenCalled();
		expect(
			screen.queryByText(oldEpisode.title),
		).not.toBeInTheDocument();
		expect(
			await screen.findByText(createNumberedEpisode(622).title),
		).toBeInTheDocument();
	});

	test("reopening a show reuses full in-memory cache without refetching", async () => {
		render(PodcastView);

		const feedImage = await screen.findByAltText(testFeed.title);
		await fireEvent.click(feedImage);

		await waitFor(() => expect(mockGetEpisodes).toHaveBeenCalledTimes(1));
		expect(
			await screen.findByText(oldEpisode.title),
		).toBeInTheDocument();

		await fireEvent.click(
			screen.getByRole("button", { name: /podcast grid/i }),
		);
		expect(get(viewState)).toBe(ViewState.PodcastGrid);

		await fireEvent.click(feedImage);
		expect(
			await screen.findByText(oldEpisode.title),
		).toBeInTheDocument();
		expect(mockGetEpisodes).toHaveBeenCalledTimes(1);
	});

	test("falls back to truncated cache when a full feed fetch fails", async () => {
		mockGetEpisodes.mockRejectedValue(new Error("network unavailable"));

		render(PodcastView);

		const feedImage = await screen.findByAltText(testFeed.title);
		await fireEvent.click(feedImage);

		expect(
			await screen.findByText(createNumberedEpisode(622).title),
		).toBeInTheDocument();
		expect(screen.queryByText(oldEpisode.title)).not.toBeInTheDocument();
		expect(mockGetEpisodes).toHaveBeenCalledTimes(1);
	});

	test("played view only fetches feeds with finished played episodes", async () => {
		const secondFeed: PodcastFeed = {
			title: "Second Podcast",
			url: "https://pod.example.com/feed-two.xml",
			artworkUrl: "https://pod.example.com/art-two.jpg",
		};

		hidePlayedEpisodes.set(true);
		savedFeeds.set({
			[testFeed.title]: testFeed,
			[secondFeed.title]: secondFeed,
		});
		episodeCache.set({
			[testFeed.title]: truncatedCache,
			[secondFeed.title]: [createNumberedEpisode(900)],
		});
		setCachedEpisodes(secondFeed, [createNumberedEpisode(900)]);
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

		await waitFor(() => expect(mockGetEpisodes).toHaveBeenCalledTimes(1));
		expect(
			await screen.findByText(oldEpisode.title),
		).toBeInTheDocument();
	});

	test("reopening played view reuses full in-memory cache without refetching", async () => {
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

		await waitFor(() => expect(mockGetEpisodes).toHaveBeenCalledTimes(1));
		expect(
			await screen.findByText(oldEpisode.title),
		).toBeInTheDocument();

		await fireEvent.click(
			screen.getByRole("button", { name: /latest episodes/i }),
		);
		await fireEvent.click(playedCard);

		expect(
			await screen.findByText(oldEpisode.title),
		).toBeInTheDocument();
		expect(mockGetEpisodes).toHaveBeenCalledTimes(1);
	});
});
