import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { requestUrl, TFile } from "obsidian";
import {
	detectAudioFileExtension,
	downloadEpisode,
	getEpisodeAudioBuffer,
} from "./downloadEpisode";
import { downloadedEpisodes } from "./store";
import type { Episode } from "./types/Episode";
import type { LocalEpisode } from "./types/LocalEpisode";

vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<typeof import("obsidian")>();
	return { ...actual, requestUrl: vi.fn() };
});

const requestUrlMock = vi.mocked(requestUrl);

function bytes(...values: number[]): ArrayBuffer {
	return new Uint8Array(values).buffer;
}

function setupVault() {
	const present = new Set<string>();
	const createdFolders: string[] = [];

	const createBinary = vi.fn(async (path: string, _data: ArrayBuffer) => {
		present.add(path);
		return new TFile();
	});
	const createFolder = vi.fn(async (path: string) => {
		present.add(path);
		createdFolders.push(path);
	});

	(globalThis as { app?: unknown }).app = {
		vault: {
			getAbstractFileByPath: (path: string) =>
				present.has(path) ? new TFile() : null,
			createBinary,
			createFolder,
		},
	};

	return { present, createdFolders, createBinary, createFolder };
}

function makeEpisode(overrides: Partial<Episode> = {}): Episode {
	return {
		title: "My Title",
		streamUrl: "https://example.com/ep.mp3",
		url: "https://example.com/ep",
		description: "",
		content: "",
		podcastName: "Pod",
		episodeDate: undefined,
		artworkUrl: "",
		...overrides,
	} as unknown as Episode;
}

beforeEach(() => {
	requestUrlMock.mockReset();
	downloadedEpisodes.set({});
});

afterEach(() => {
	(globalThis as { app?: unknown }).app = undefined;
});

describe("detectAudioFileExtension", () => {
	it("matches exact signatures (ID3 -> mp3, RIFF -> wav, m4a)", () => {
		expect(detectAudioFileExtension(bytes(0x49, 0x44, 0x33, 0x04))).toBe("mp3");
		expect(detectAudioFileExtension(bytes(0x52, 0x49, 0x46, 0x46))).toBe("wav");
		expect(detectAudioFileExtension(bytes(0x4d, 0x34, 0x41, 0x20))).toBe("m4a");
	});

	it("applies the masked MPEG frame-sync signature", () => {
		expect(detectAudioFileExtension(bytes(0xff, 0xfb, 0x90, 0x00))).toBe("mp3");
	});

	it("returns null for unknown content", () => {
		expect(detectAudioFileExtension(bytes(0x00, 0x01, 0x02, 0x03))).toBeNull();
	});

	it("does not crash on a buffer shorter than the longest signature", () => {
		expect(detectAudioFileExtension(bytes(0xff))).toBeNull();
		expect(detectAudioFileExtension(new ArrayBuffer(0))).toBeNull();
	});
});

describe("downloadEpisode (API path)", () => {
	it("threads a single ArrayBuffer straight to createBinary (no Blob copy) and creates folders", async () => {
		const { createBinary, createdFolders } = setupVault();
		const buffer = bytes(0x49, 0x44, 0x33, 0x01, 0x02, 0x03);
		requestUrlMock.mockResolvedValue({
			status: 200,
			headers: { "content-type": "audio/mpeg" },
			arrayBuffer: buffer,
		} as unknown as Awaited<ReturnType<typeof requestUrl>>);

		const episode = makeEpisode();
		const path = await downloadEpisode(episode, "podcast/{{podcast}}/{{title}}");

		expect(path).toBe("podcast/Pod/My Title.mp3");
		expect(createdFolders).toEqual(["podcast", "podcast/Pod"]);
		expect(createBinary).toHaveBeenCalledTimes(1);

		const [writtenPath, writtenData] = createBinary.mock.calls[0];
		expect(writtenPath).toBe("podcast/Pod/My Title.mp3");
		// The exact buffer returned by requestUrl must reach createBinary — proving
		// no Blob round-trip / extra full-file copy is made (issue #113).
		expect(writtenData).toBe(buffer);

		const recorded = get(downloadedEpisodes)["Pod"]?.[0];
		expect(recorded?.filePath).toBe("podcast/Pod/My Title.mp3");
		expect(recorded?.size).toBe(buffer.byteLength);
	});

	it("returns the existing path without downloading when the file already exists", async () => {
		const { present, createBinary } = setupVault();
		present.add("My Title.mp3");

		const path = await downloadEpisode(makeEpisode(), "{{title}}");

		expect(path).toBe("My Title.mp3");
		expect(requestUrlMock).not.toHaveBeenCalled();
		expect(createBinary).not.toHaveBeenCalled();
	});
});

describe("getEpisodeAudioBuffer (issue #107)", () => {
	const files = new Map<string, ArrayBuffer>();

	function makeTFile(path: string): TFile {
		const file = new TFile();
		const dot = path.lastIndexOf(".");
		const slash = path.lastIndexOf("/");
		(file as { path: string }).path = path;
		(file as { extension: string }).extension =
			dot > slash ? path.slice(dot + 1) : "";
		(file as { basename: string }).basename = path.slice(
			slash + 1,
			dot > slash ? dot : undefined,
		);
		return file;
	}

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
			episodeDate: undefined,
			...overrides,
		} as unknown as Episode;
	}

	beforeEach(() => {
		files.clear();
		(globalThis as { app?: unknown }).app = {
			vault: {
				getAbstractFileByPath: (path: string) =>
					files.has(path) ? makeTFile(path) : null,
				readBinary: async (file: TFile) => files.get(file.path),
			},
		};
		requestUrlMock.mockImplementation((req: unknown) => {
			const url = typeof req === "string" ? req : (req as { url: string }).url;
			const text = url.includes("spanish") ? "SPANISH-AUDIO" : "ENGLISH-AUDIO";
			return Promise.resolve({
				status: 200,
				headers: { "content-type": "audio/mpeg" },
				arrayBuffer: new TextEncoder().encode(text).buffer,
			}) as unknown as ReturnType<typeof requestUrl>;
		});
	});

	it("fetches each episode's own audio from its stream URL — never another episode's", async () => {
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
		expect(requestUrlMock).toHaveBeenCalledWith(
			expect.objectContaining({ url: "https://example.com/spanish.mp3" }),
		);
		expect(requestUrlMock).toHaveBeenCalledWith(
			expect.objectContaining({ url: "https://example.com/english.mp3" }),
		);
	});

	it("reuses a registry-confirmed downloaded copy without re-fetching", async () => {
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
		expect(requestUrlMock).not.toHaveBeenCalled();
	});

	it("ignores a stale registry entry whose file no longer exists and fetches fresh", async () => {
		const ep = episode({
			title: "Stale Episode",
			streamUrl: "https://example.com/english.mp3",
		});
		// Registry points at a file that is not in the vault.
		downloadedEpisodes.addEpisode(ep, "Podcasts/missing.mp3", 20);

		const result = await getEpisodeAudioBuffer(ep);

		expect(decode(result.buffer)).toBe("ENGLISH-AUDIO");
		expect(requestUrlMock).toHaveBeenCalledTimes(1);
	});

	it("ignores a wrong-episode file at a colliding path and fetches the right audio", async () => {
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
		expect(requestUrlMock).toHaveBeenCalledTimes(1);
	});

	it("throws a clear error when the stream returns non-audio content", async () => {
		requestUrlMock.mockImplementation(
			() =>
				Promise.resolve({
					status: 200,
					headers: { "content-type": "text/html" },
					arrayBuffer: new TextEncoder().encode("<html>login required</html>")
						.buffer,
				}) as unknown as ReturnType<typeof requestUrl>,
		);
		const ep = episode({
			title: "Private Episode",
			streamUrl: "https://example.com/private-feed-token",
		});

		await expect(getEpisodeAudioBuffer(ep)).rejects.toThrow(/not audio/i);
	});

	it("reads local-file episodes from disk by their resolved path", async () => {
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
		expect(requestUrlMock).not.toHaveBeenCalled();
	});
});
