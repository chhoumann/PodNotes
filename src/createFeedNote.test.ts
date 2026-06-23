import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { plugin } from "./store";
import createFeedNote from "./createFeedNote";
import type { PodcastFeed } from "./types/PodcastFeed";

// A feed with every metadata field already populated, so createFeedNote's
// enrichFeed short-circuits and never hits the network in these tests.
const fullFeed: PodcastFeed = {
	title: "My Show: A Podcast",
	url: "https://example.com/feed.xml",
	artworkUrl: "https://example.com/art.png",
	link: "https://example.com",
	description: "A description",
	author: "Jane Doe",
};

const EXPECTED_PATH = "PodNotes/Podcasts/My Show A Podcast.md";

// The real obsidian TFile type has a 0-arg constructor; build one and attach a
// path so `instanceof TFile` holds and `file.path` reads back in assertions.
function makeTFile(path: string): TFile {
	const file = new TFile();
	(file as { path: string }).path = path;
	return file;
}

function setupVault(options: {
	initial?: string[];
	createImpl?: (path: string, content: string) => Promise<TFile>;
}) {
	const files = new Set(options.initial ?? []);
	const created: { path: string; content: string }[] = [];
	const opened: string[] = [];

	const create =
		options.createImpl ??
		(async (path: string, content: string) => {
			if (files.has(path)) throw new Error("File already exists.");
			files.add(path);
			created.push({ path, content });
			return makeTFile(path);
		});

	const app = {
		vault: {
			getAbstractFileByPath: (path: string) =>
				files.has(path) ? makeTFile(path) : null,
			create: vi.fn(create),
			createFolder: vi.fn(async (path: string) => {
				files.add(path);
			}),
		},
		workspace: {
			getLeaf: () => ({
				openFile: (file: TFile) => opened.push(file.path),
			}),
		},
	};

	// Attach the app onto the plugin store the test already set up (preserving its
	// settings); the source reads its app from `get(plugin).app`.
	plugin.update((current) => ({ ...current, app }) as never);

	return { files, created, opened };
}

beforeEach(() => {
	plugin.set({
		settings: {
			feedNote: {
				path: "PodNotes/Podcasts/{{podcast}}.md",
				template: "type: podcast\npodcast: {{podcast}}\n",
			},
		},
	} as never);
});

afterEach(() => {
	plugin.set(undefined as never);
	vi.restoreAllMocks();
});

describe("createFeedNote", () => {
	it("creates the note at the sanitized basename derived from the feed title", async () => {
		const { created, opened } = setupVault({});

		await createFeedNote(fullFeed);

		expect(created).toHaveLength(1);
		expect(created[0].path).toBe(EXPECTED_PATH);
		expect(opened).toContain(EXPECTED_PATH);
	});

	it("opens the existing note instead of creating a duplicate", async () => {
		const { created, opened } = setupVault({ initial: [EXPECTED_PATH] });

		await createFeedNote(fullFeed);

		expect(created).toHaveLength(0);
		expect(opened).toContain(EXPECTED_PATH);
	});

	it("treats a create that loses a race as success (opens the winner)", async () => {
		// Simulate another invocation winning between our existence check and
		// create(): the file is absent at check time, but create() throws
		// "already exists" because a competing create wrote it first.
		const racedFiles = new Set<string>();
		const opened: string[] = [];

		const app = {
			vault: {
				getAbstractFileByPath: (path: string) =>
					racedFiles.has(path) ? makeTFile(path) : null,
				create: vi.fn(async (path: string) => {
					racedFiles.add(path);
					throw new Error("File already exists.");
				}),
				createFolder: vi.fn(async () => {}),
			},
			workspace: {
				getLeaf: () => ({
					openFile: (file: TFile) => opened.push(file.path),
				}),
			},
		};
		plugin.update((current) => ({ ...current, app }) as never);

		await expect(createFeedNote(fullFeed)).resolves.toBeUndefined();
		expect(opened).toContain(EXPECTED_PATH);
	});

	it("caps a very long feed title so creation can't trip ENAMETOOLONG (#22)", async () => {
		const { created } = setupVault({});

		await createFeedNote({ ...fullFeed, title: "Z".repeat(400) });

		expect(created).toHaveLength(1);
		const basename = created[0].path.split("/").pop() ?? "";
		expect(created[0].path.startsWith("PodNotes/Podcasts/")).toBe(true);
		expect(basename.endsWith(".md")).toBe(true);
		expect(basename.length).toBeLessThanOrEqual(255);
		expect(basename.length).toBeLessThan(400);
	});

	it("does nothing when no feed-note path/template is configured", async () => {
		plugin.set({
			settings: { feedNote: { path: "", template: "" } },
		} as never);
		const { created } = setupVault({});

		await createFeedNote(fullFeed);

		expect(created).toHaveLength(0);
	});
});
