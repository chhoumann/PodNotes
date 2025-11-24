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
	currentEpisode,
	episodeCache,
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
	viewState.set(ViewState.PodcastGrid);
	currentEpisode.update(() => undefined as unknown as Episode);
	plugin.set(undefined as never);
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
		const { createdFiles, leaf } = bootstrapAppMock();

		const pluginSettings = {
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
});
