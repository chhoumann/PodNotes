import { fireEvent, render, screen } from "@testing-library/svelte";
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
});
