import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import createPodcastNote from "./createPodcastNote";
import { plugin } from "./store";
import type { Episode } from "./types/Episode";

const mockFetchChapters = vi.hoisted(() => vi.fn());

vi.mock("./utility/fetchChapters", () => ({
	fetchChapters: mockFetchChapters,
}));

const episode: Episode = {
	title: "Chaptered Episode",
	streamUrl: "https://example.com/episode.mp3",
	url: "https://example.com/episode",
	description: "",
	content: "",
	podcastName: "Chaptered Show",
	feedUrl: "https://example.com/feed.xml",
	episodeDate: new Date("2024-01-01T00:00:00.000Z"),
	chaptersUrl: "https://example.com/chapters.json",
};

function bootstrapAppMock(existingFile?: TFile) {
	const createdFiles: Array<{ path: string; data: string }> = [];
	const leaf = { openFile: vi.fn() };
	const appMock = {
		vault: {
			getAbstractFileByPath: vi.fn((path: string) =>
				path === existingFile?.path ? existingFile : null,
			),
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

	return { createdFiles, leaf };
}

describe("createPodcastNote chapters template support (#47)", () => {
	beforeEach(() => {
		mockFetchChapters.mockResolvedValue([
			{ startTime: 65, title: "Deep Dive" },
			{ startTime: 0, title: "Intro" },
		]);
	});

	afterEach(() => {
		mockFetchChapters.mockReset();
		plugin.set(undefined as never);
		delete (globalThis as Record<string, unknown>).app;
	});

	it("fetches and renders chapters only when the note template asks for them", async () => {
		const { createdFiles, leaf } = bootstrapAppMock();
		plugin.set({
			settings: {
				note: {
					path: "PodNotes/{{title}}",
					template: "# {{title}}\n\n{{chapters}}",
				},
				feedNote: { path: "" },
				savedFeeds: {},
			},
		} as never);

		await createPodcastNote(episode);

		expect(mockFetchChapters).toHaveBeenCalledWith(
			"https://example.com/chapters.json",
		);
		expect(createdFiles[0]).toMatchObject({
			path: "PodNotes/Chaptered Episode.md",
			data: "# Chaptered Episode\n\n- 0:00 Intro\n- 1:05 Deep Dive",
		});
		expect(leaf.openFile).toHaveBeenCalledWith(
			expect.objectContaining({ path: "PodNotes/Chaptered Episode.md" }),
		);
	});

	it("opens an existing note without fetching chapters", async () => {
		const existingFile = Object.assign(Object.create(TFile.prototype), {
			path: "PodNotes/Chaptered Episode.md",
		}) as TFile;
		const { createdFiles, leaf } = bootstrapAppMock(existingFile);
		plugin.set({
			settings: {
				note: {
					path: "PodNotes/{{title}}",
					template: "# {{title}}\n\n{{chapters}}",
				},
			},
		} as never);

		await createPodcastNote(episode);

		expect(mockFetchChapters).not.toHaveBeenCalled();
		expect(createdFiles).toEqual([]);
		expect(leaf.openFile).toHaveBeenCalledWith(existingFile);
	});

	it("does not fetch chapters for templates that do not use the tag", async () => {
		const { createdFiles } = bootstrapAppMock();
		plugin.set({
			settings: {
				note: {
					path: "PodNotes/{{title}}",
					template: "# {{title}}",
				},
				feedNote: { path: "" },
				savedFeeds: {},
			},
		} as never);

		await createPodcastNote(episode);

		expect(mockFetchChapters).not.toHaveBeenCalled();
		expect(createdFiles[0]).toMatchObject({
			path: "PodNotes/Chaptered Episode.md",
			data: "# Chaptered Episode",
		});
	});
});
