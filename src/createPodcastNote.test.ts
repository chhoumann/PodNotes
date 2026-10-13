import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import { TFile, TFolder } from "obsidian";
import createPodcastNote, {
	createPodcastNoteFileIfNotExists,
	getPodcastNote,
} from "./createPodcastNote";
import { plugin } from "./store";
import type { Chapter } from "./types/Chapter";
import type { Episode } from "./types/Episode";
import { deferred } from "../tests/mocks/feeds";

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
		vi.restoreAllMocks();
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

	it("says an existing note exists and opens it without fetching chapters", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
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
		expect(notice).toHaveBeenCalledWith('Note for "Chaptered Episode" already exists');
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
		return Object.assign(Object.create(TFile.prototype), {
			path,
			extension: path.split(".").pop() ?? "",
		}) as TFile;
	}

	function folderWith(files: TFile[]): TFolder {
		return Object.assign(Object.create(TFolder.prototype), {
			path: "podcasts",
			children: files,
		}) as TFolder;
	}

	it("opens a note written with the 2.16 filename sanitizer", () => {
		const legacy = fileAt(
			"podcasts/Philosophize This! - Episode 001 Presocratic Philosophy - Ionian.md",
		);
		const files = new Map<string, TFile>([[legacy.path, legacy]]);

		plugin.set({
			app: {
				vault: {
					getAbstractFileByPath: vi.fn((path: string) =>
						path === "podcasts"
							? folderWith([...files.values()])
							: (files.get(path) ?? null),
					),
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
					getAbstractFileByPath: vi.fn((path: string) =>
						path === "podcasts"
							? folderWith([...files.values()])
							: (files.get(path) ?? null),
					),
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

	it("does not treat a Part 2 note as the Part 1 note", async () => {
		const part1: Episode = {
			title: "The Fall of the Republic, Part 1",
			streamUrl: "https://example.com/part1.mp3",
			url: "https://example.com/part1",
			description: "",
			content: "",
			podcastName: "The History of Rome",
			feedUrl: "https://example.com/rome.xml",
		};
		const part2Note = fileAt(
			"podcasts/The History of Rome - The Fall of the Republic, Part 2.md",
		);
		const createdFiles: Array<{ path: string }> = [];

		plugin.set({
			app: {
				vault: {
					getAbstractFileByPath: vi.fn((path: string) => {
						if (path === "podcasts") return folderWith([part2Note]);
						return path === part2Note.path ? part2Note : null;
					}),
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

		expect(getPodcastNote(part1)).toBeNull();

		await createPodcastNote(part1);
		expect(createdFiles).toEqual([
			{ path: "podcasts/The History of Rome - The Fall of the Republic Part 1.md" },
		]);
	});

	it("does not treat a sibling note as a match just because they share a long path prefix", () => {
		const apple: Episode = {
			title: "Apple",
			streamUrl: "https://example.com/apple.mp3",
			url: "https://example.com/apple",
			description: "",
			content: "",
			podcastName: "The Really Long Daily Technology Podcast",
			feedUrl: "https://example.com/tech.xml",
		};
		const androidNote = fileAt(
			"podcasts/The Really Long Daily Technology Podcast - Android.md",
		);

		plugin.set({
			app: {
				vault: {
					getAbstractFileByPath: vi.fn((path: string) => {
						if (path === "podcasts") return folderWith([androidNote]);
						return path === androidNote.path ? androidNote : null;
					}),
				},
			},
			settings: {
				note: { path: "podcasts/{{podcast}} - {{title}}", template: "# {{title}}" },
			},
		} as never);

		expect(getPodcastNote(apple)).toBeNull();
	});

	it("does not open a different episode that only shares generic words", () => {
		const other = fileAt("podcasts/Huberman Lab - Optimize Testosterone Dr Kyle Gillett.md");

		plugin.set({
			app: {
				vault: {
					getAbstractFileByPath: vi.fn((path: string) =>
						path === "podcasts" ? folderWith([other]) : null,
					),
				},
			},
			settings: {
				note: { path: "podcasts/{{podcast}} - {{title}}", template: "# {{title}}" },
			},
		} as never);

		expect(getPodcastNote(hubermanEpisode)).toBeNull();
	});
});

describe("episode notes identified by guid (#349)", () => {
	const feedUrl = "https://example.com/feed.xml";
	const identified: Episode = {
		title: "Season Finale",
		streamUrl: "https://example.com/finale.mp3",
		url: "https://example.com/finale",
		description: "",
		content: "",
		podcastName: "The Show",
		feedUrl,
		guid: "finale-1",
	};

	afterEach(() => {
		plugin.set(undefined as never);
	});

	interface Note {
		path: string;
		frontmatter?: Record<string, unknown>;
	}

	/** A vault holding `notes`, all in "podcasts", whose metadata cache knows their frontmatter. */
	function vaultWith(notes: Note[], template = "# {{title}}") {
		const files = notes.map(({ path }) =>
			Object.assign(Object.create(TFile.prototype), { path, extension: "md" }),
		) as TFile[];
		const folder = Object.assign(Object.create(TFolder.prototype), {
			path: "podcasts",
			children: files,
		}) as TFolder;
		const created: Array<{ path: string; data: string }> = [];
		plugin.set({
			app: {
				vault: {
					getAbstractFileByPath: vi.fn((path: string) =>
						path === "podcasts"
							? folder
							: (files.find((file) => file.path === path) ?? null),
					),
					getMarkdownFiles: () => files,
					createFolder: vi.fn(async () => {}),
					create: vi.fn(async (path: string, data: string) => {
						created.push({ path, data });
						return { path };
					}),
				},
				metadataCache: {
					getFileCache: (file: TFile) => ({
						frontmatter: notes.find((note) => note.path === file.path)?.frontmatter,
					}),
				},
				workspace: { getLeaf: vi.fn(() => ({ openFile: vi.fn() })) },
			},
			settings: { note: { path: "podcasts/{{title}}", template } },
		} as never);
		return { files, created };
	}

	it("adds quoted guid and feedUrl lines to the template's frontmatter", async () => {
		const { created } = vaultWith([], '---\ntitle: "{{title}}"\n---\n# {{title}}');

		await createPodcastNote(identified);

		expect(created).toEqual([
			{
				path: "podcasts/Season Finale.md",
				data: `---\ntitle: "Season Finale"\nguid: "finale-1"\nfeedUrl: "${feedUrl}"\n---\n# Season Finale`,
			},
		]);
	});

	it("adds a frontmatter block to a template without one", async () => {
		const { created } = vaultWith([]);

		await createPodcastNote(identified);

		expect(created[0].data).toBe(
			`---\nguid: "finale-1"\nfeedUrl: "${feedUrl}"\n---\n# Season Finale`,
		);
	});

	it("does not repeat a feedUrl the template already renders", async () => {
		const { created } = vaultWith([], '---\nfeedUrl: "{{feedurl}}"\n---\n');

		await createPodcastNote(identified);

		expect(created[0].data).toBe(`---\nfeedUrl: "${feedUrl}"\nguid: "finale-1"\n---\n`);
	});

	it("does not repeat keys the template writes in quotes", async () => {
		const template = `---\n"feedUrl": "{{feedurl}}"\n'guid': "{{title}}"\n---\n`;
		const { created } = vaultWith([], template);

		await createPodcastNote(identified);

		expect(created[0].data).toBe(
			`---\n"feedUrl": "${feedUrl}"\n'guid': "Season Finale"\n---\n`,
		);
	});

	it("adds nothing for an episode without a guid", async () => {
		const { created } = vaultWith([], '---\ntitle: "{{title}}"\n---\n');

		await createPodcastNote({ ...identified, guid: undefined });

		expect(created[0].data).toBe('---\ntitle: "Season Finale"\n---\n');
	});

	it("writes a guid with quotes, colons, newlines and control characters as an escaped string", async () => {
		const guid = 'tag: "a"\nb\\c\u007f\u0085\ufffe 123';
		const { created } = vaultWith([]);

		await createPodcastNote({ ...identified, guid });

		const line = created[0].data.split("\n")[1];
		expect(line).toBe(String.raw`guid: "tag: \"a\"\nb\\c\u007f\u0085\ufffe 123"`);
		expect(JSON.parse(line.slice("guid: ".length))).toBe(guid);
	});

	it("finds a retitled episode's note by its guid", async () => {
		const { files, created } = vaultWith([
			{ path: "podcasts/Old Title.md", frontmatter: { guid: "finale-1", feedUrl } },
		]);

		expect(getPodcastNote(identified)).toBe(files[0]);

		await createPodcastNote(identified);
		expect(created).toEqual([]);
	});

	it("returns a note with the episode's guid that appeared while its chapters loaded", async () => {
		const chapters = deferred<Chapter[]>();
		mockFetchChapters.mockReturnValueOnce(chapters.promise);
		const notes: Note[] = [];
		const { files, created } = vaultWith(notes, "# {{title}}\n\n{{chapters}}");

		const creating = createPodcastNoteFileIfNotExists({
			...identified,
			chaptersUrl: "https://example.com/chapters.json",
		});
		const synced = {
			path: "podcasts/Finale (synced).md",
			frontmatter: { guid: "finale-1", feedUrl },
		};
		notes.push(synced);
		files.push(
			Object.assign(Object.create(TFile.prototype), { path: synced.path, extension: "md" }),
		);
		chapters.resolve([]);

		expect(await creating).toEqual({ file: files[0], created: false });
		expect(created).toEqual([]);
	});

	it("prefers the note with the episode's guid over another episode's note at its path", () => {
		const { files } = vaultWith([
			{ path: "podcasts/Season Finale.md", frontmatter: { guid: "finale-0", feedUrl } },
			{ path: "podcasts/Season Finale 2.md", frontmatter: { guid: "finale-1", feedUrl } },
		]);

		expect(getPodcastNote(identified)).toBe(files[1]);
	});

	it("falls back to the title when two notes have the episode's guid", () => {
		const { files } = vaultWith([
			{ path: "podcasts/Old Title.md", frontmatter: { guid: "finale-1", feedUrl } },
			{ path: "podcasts/Season Finale.md", frontmatter: { guid: "finale-1", feedUrl } },
		]);

		expect(getPodcastNote(identified)).toBe(files[1]);
	});

	it("ignores a note with the episode's guid from another feed", () => {
		vaultWith([
			{
				path: "podcasts/Old Title.md",
				frontmatter: { guid: "finale-1", feedUrl: "https://other.example.com/feed.xml" },
			},
		]);

		expect(getPodcastNote(identified)).toBeNull();
	});
});
