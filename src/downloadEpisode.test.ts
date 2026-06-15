import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Episode } from "./types/Episode";
import type { LocalEpisode } from "./types/LocalEpisode";

// vi.mock is hoisted; expose the spy via vi.hoisted so the factory can use it.
const { mockRequestUrl } = vi.hoisted(() => ({ mockRequestUrl: vi.fn() }));

vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<typeof import("obsidian")>();
	return { ...actual, requestUrl: (arg: unknown) => mockRequestUrl(arg) };
});

import { TFile } from "obsidian";
import { getEpisodeAudioBuffer } from "./downloadEpisode";
import { downloadedEpisodes } from "./store";

// jsdom's Blob lacks arrayBuffer(); provide one so downloadEpisode can read bytes.
if (
	!(Blob.prototype as unknown as { arrayBuffer?: unknown }).arrayBuffer
) {
	(Blob.prototype as unknown as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer =
		function (this: Blob) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(reader.result as ArrayBuffer);
				reader.onerror = () => reject(reader.error);
				reader.readAsArrayBuffer(this);
			});
		};
}

// Minimal in-memory vault keyed by path; getEpisodeAudioBuffer reads the global `app`.
const files = new Map<string, ArrayBuffer>();

// At runtime TFile is the obsidian mock (constructor takes a path); the real
// obsidian type declares no constructor args, so cast to a 1-arg constructor.
const TFileCtor = TFile as unknown as new (path: string) => TFile;

function makeTFile(path: string): TFile {
	const file = new TFileCtor(path) as TFile & {
		basename: string;
		extension: string;
	};
	const slash = path.lastIndexOf("/");
	const dot = path.lastIndexOf(".");
	file.extension = dot > slash ? path.slice(dot + 1) : "";
	file.basename = path.slice(slash + 1, dot > slash ? dot : undefined);
	return file;
}

(globalThis as unknown as { app: unknown }).app = {
	vault: {
		getAbstractFileByPath: (path: string) =>
			files.has(path) ? makeTFile(path) : null,
		readBinary: async (file: TFile) => files.get(file.path),
	},
};

function seedFile(path: string, text: string): void {
	files.set(path, new TextEncoder().encode(text).buffer);
}

function decode(buffer: ArrayBuffer): string {
	return new TextDecoder().decode(new Uint8Array(buffer));
}

function episode(overrides: Partial<Episode>): Episode {
	return {
		title: "Title",
		streamUrl: "https://example.com/audio.mp3",
		url: "https://example.com/audio",
		description: "",
		content: "",
		podcastName: "Pod",
		feedUrl: "https://example.com/feed.xml",
		episodeDate: new Date("2024-01-01"),
		...overrides,
	};
}

beforeEach(() => {
	files.clear();
	downloadedEpisodes.set({});
	mockRequestUrl.mockReset();
	mockRequestUrl.mockImplementation(async ({ url }: { url: string }) => {
		const text = url.includes("spanish") ? "SPANISH-AUDIO" : "ENGLISH-AUDIO";
		return {
			status: 200,
			arrayBuffer: new TextEncoder().encode(text).buffer,
			headers: { "content-type": "audio/mpeg" },
		};
	});
});

describe("getEpisodeAudioBuffer (issue #107)", () => {
	test("fetches each episode's own audio from its stream URL — never another episode's", async () => {
		const spanish = episode({
			title: "Hola soy Sere",
			streamUrl: "https://example.com/spanish.mp3",
			podcastName: "Otro Podcast",
		});
		const english = episode({
			title: "107. How could a PBS of the Internet...",
			streamUrl: "https://example.com/english.mp3",
			podcastName: "Reimagining the Internet",
		});

		const a = await getEpisodeAudioBuffer(spanish);
		const b = await getEpisodeAudioBuffer(english);

		// Each episode gets ITS OWN bytes — the wrong-episode collision is gone.
		expect(decode(a.buffer)).toBe("SPANISH-AUDIO");
		expect(decode(b.buffer)).toBe("ENGLISH-AUDIO");
		expect(a.extension).toBe("mp3");
		expect(b.extension).toBe("mp3");
		expect(mockRequestUrl).toHaveBeenCalledWith(
			expect.objectContaining({ url: "https://example.com/spanish.mp3" }),
		);
		expect(mockRequestUrl).toHaveBeenCalledWith(
			expect.objectContaining({ url: "https://example.com/english.mp3" }),
		);
	});

	test("reuses a registry-confirmed downloaded copy without re-fetching", async () => {
		const ep = episode({
			title: "Cached Episode",
			streamUrl: "https://example.com/english.mp3",
		});
		seedFile("Podcasts/cached.mp3", "CACHED-CORRECT-AUDIO");
		downloadedEpisodes.addEpisode(ep, "Podcasts/cached.mp3", 20);

		const result = await getEpisodeAudioBuffer(ep);

		expect(decode(result.buffer)).toBe("CACHED-CORRECT-AUDIO");
		expect(result.extension).toBe("mp3");
		expect(result.basename).toBe("cached");
		expect(mockRequestUrl).not.toHaveBeenCalled();
	});

	test("ignores a stale registry entry whose file no longer exists and fetches fresh", async () => {
		const ep = episode({
			title: "Stale Episode",
			streamUrl: "https://example.com/english.mp3",
		});
		// Registry points at a file that is not in the vault.
		downloadedEpisodes.addEpisode(ep, "Podcasts/missing.mp3", 20);

		const result = await getEpisodeAudioBuffer(ep);

		expect(decode(result.buffer)).toBe("ENGLISH-AUDIO");
		expect(mockRequestUrl).toHaveBeenCalledTimes(1);
	});

	test("ignores a wrong-episode file sitting at a colliding path and fetches the right audio", async () => {
		// Direct reproduction of issue #107: a different episode's audio already
		// lives at the old collidable download-path location, and this episode has
		// no registry entry. The old code returned the colliding file's bytes; the
		// new code must fetch this episode's own audio instead.
		seedFile("Downloads.mp3", "WRONG-EPISODE-AUDIO");
		const ep = episode({
			title: "Right Episode",
			streamUrl: "https://example.com/english.mp3",
		});

		const result = await getEpisodeAudioBuffer(ep);

		expect(decode(result.buffer)).toBe("ENGLISH-AUDIO");
		expect(decode(result.buffer)).not.toBe("WRONG-EPISODE-AUDIO");
		expect(mockRequestUrl).toHaveBeenCalledTimes(1);
	});

	test("throws a clear error when the stream returns non-audio content", async () => {
		mockRequestUrl.mockImplementation(async () => ({
			status: 200,
			arrayBuffer: new TextEncoder().encode("<html>login required</html>").buffer,
			headers: { "content-type": "text/html" },
		}));
		const ep = episode({
			title: "Private Episode",
			streamUrl: "https://example.com/private-feed-token",
		});

		await expect(getEpisodeAudioBuffer(ep)).rejects.toThrow(/not audio/i);
	});

	test("reads local-file episodes from disk by their resolved path", async () => {
		const local = episode({
			title: "Local Recording",
			podcastName: "local file",
			description: "",
			content: "",
			streamUrl: "",
			url: "Local/recording.m4a",
			filePath: "Local/recording.m4a",
		} as Partial<LocalEpisode>) as LocalEpisode;
		seedFile("Local/recording.m4a", "LOCAL-AUDIO");

		const result = await getEpisodeAudioBuffer(local);

		expect(decode(result.buffer)).toBe("LOCAL-AUDIO");
		expect(result.extension).toBe("m4a");
		expect(result.basename).toBe("recording");
		expect(mockRequestUrl).not.toHaveBeenCalled();
	});
});
