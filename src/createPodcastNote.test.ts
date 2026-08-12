import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import createPodcastNote, { getPodcastNote } from "./createPodcastNote";
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

	return { createdFiles, leaf, appMock };
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
	});

	it("fetches and renders chapters only when the note template asks for them", async () => {
		const { createdFiles, leaf, appMock } = bootstrapAppMock();
		plugin.set({
			app: appMock,
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

		expect(mockFetchChapters).toHaveBeenCalledWith("https://example.com/chapters.json");
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
		const { createdFiles, leaf, appMock } = bootstrapAppMock(existingFile);
		plugin.set({
			app: appMock,
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
		const { createdFiles, appMock } = bootstrapAppMock();
		plugin.set({
			app: appMock,
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

describe("getPodcastNote title fallbacks (#315)", () => {
	const philosophizeEpisode: Episode = {
		title: "Episode #001 ... Presocratic Philosophy - Ionian",
		streamUrl: "https://example.com/ep001.mp3",
		url: "https://example.com/ep001",
		description: "",
		content: "",
		podcastName: "Philosophize This!",
		feedUrl: "https://feeds.megaphone.fm/QCD6036500916",
	};

	const hubermanEpisode: Episode = {
		title: "Access Your Best Self With Mind-Body Practices, Belief Testing & Imagination | Dr. Martha Beck",
		streamUrl: "https://example.com/martha.mp3",
		url: "https://example.com/martha",
		description: "",
		content: "",
		podcastName: "Huberman Lab",
		feedUrl: "https://feeds.megaphone.fm/hubermanlab",
	};

	afterEach(() => {
		plugin.set(undefined as never);
	});

	function fileAt(path: string): TFile {
		return Object.assign(Object.create(TFile.prototype), { path }) as TFile;
	}

	it("opens a note written with the 2.16 filename sanitizer", () => {
		const legacy = fileAt(
			"podcasts/Philosophize This! - Episode 001 Presocratic Philosophy - Ionian.md",
		);
		const files = new Map<string, TFile>([[legacy.path, legacy]]);

		plugin.set({
			app: {
				vault: {
					getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
					getMarkdownFiles: vi.fn(() => [...files.values()]),
				},
			},
			settings: {
				note: { path: "podcasts/{{podcast}} - {{title}}", template: "# {{title}}" },
			},
		} as never);

		expect(getPodcastNote(philosophizeEpisode)).toBe(legacy);
	});

	it("opens a note whose filename still has the pre-retitle episode words", async () => {
		const legacy = fileAt(
			"podcasts/Huberman Lab - Dr. Martha Beck Access Your Best Self With Mind-Body Practices Belief Testing Imagination.md",
		);
		const files = new Map<string, TFile>([[legacy.path, legacy]]);
		const createdFiles: Array<{ path: string }> = [];

		plugin.set({
			app: {
				vault: {
					getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
					getMarkdownFiles: vi.fn(() => [...files.values()]),
					createFolder: vi.fn(async () => {}),
					create: vi.fn(async (path: string) => {
						createdFiles.push({ path });
						return { path };
					}),
				},
				workspace: { getLeaf: vi.fn(() => ({ openFile: vi.fn() })) },
			},
			settings: {
				note: { path: "podcasts/{{podcast}} - {{title}}", template: "# {{title}}" },
			},
		} as never);

		expect(getPodcastNote(hubermanEpisode)).toBe(legacy);

		await createPodcastNote(hubermanEpisode);
		expect(createdFiles).toEqual([]);
	});

	it("does not open a different episode that only shares generic words", () => {
		const other = fileAt("podcasts/Huberman Lab - Optimize Testosterone Dr Kyle Gillett.md");

		plugin.set({
			app: {
				vault: {
					getAbstractFileByPath: vi.fn(() => null),
					getMarkdownFiles: vi.fn(() => [other]),
				},
			},
			settings: {
				note: { path: "podcasts/{{podcast}} - {{title}}", template: "# {{title}}" },
			},
		} as never);

		expect(getPodcastNote(hubermanEpisode)).toBeNull();
	});
});
