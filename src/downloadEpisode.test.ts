import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { requestUrl, TFile } from "obsidian";
import downloadEpisodeWithNotice, {
	detectAudioFileExtension,
	downloadEpisode,
	getEpisodeAudioBuffer,
	safeDownloadBasename,
	safeDownloadFilePath,
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

describe("downloadEpisodeWithNotice (download command path)", () => {
	it("saves extensionless video downloads using the response content type", async () => {
		const { createBinary } = setupVault();
		const buffer = bytes(0x00, 0x00, 0x00, 0x18);
		requestUrlMock.mockResolvedValue({
			status: 200,
			headers: { "content-type": "video/mp4" },
			arrayBuffer: buffer,
		} as unknown as Awaited<ReturnType<typeof requestUrl>>);
		const episode = makeEpisode({
			title: "Video Title",
			streamUrl: "https://example.com/watch?id=42",
			mediaType: "video",
		});
		const setTimeoutSpy = vi
			.spyOn(globalThis, "setTimeout")
			.mockImplementation(() => 0 as unknown as ReturnType<typeof setTimeout>);

		try {
			await downloadEpisodeWithNotice(episode, "Podcasts/{{title}}");
		} finally {
			setTimeoutSpy.mockRestore();
		}

		expect(createBinary).toHaveBeenCalledWith("Podcasts/Video Title.mp4", buffer);
		const recorded = get(downloadedEpisodes)["Pod"]?.[0];
		expect(recorded).toMatchObject({
			title: "Video Title",
			filePath: "Podcasts/Video Title.mp4",
			mediaType: "video",
			size: buffer.byteLength,
		});
	});

	it("rejects unsupported extensionless video downloads instead of saving them as mp3", async () => {
		const { createBinary } = setupVault();
		const buffer = bytes(0x00, 0x01, 0x02, 0x03);
		requestUrlMock.mockResolvedValue({
			status: 200,
			headers: { "content-type": "video/x-msvideo" },
			arrayBuffer: buffer,
		} as unknown as Awaited<ReturnType<typeof requestUrl>>);
		const episode = makeEpisode({
			title: "Unsupported Video",
			streamUrl: "https://example.com/watch?id=42",
			mediaType: "video",
		});

		await expect(
			downloadEpisodeWithNotice(episode, "Podcasts/{{title}}"),
		).rejects.toThrow("Not a playable media file");

		expect(createBinary).not.toHaveBeenCalled();
		expect(get(downloadedEpisodes)["Pod"]).toBeUndefined();
	});

	it("rejects blank-type extensionless video downloads instead of saving them as mp3", async () => {
		const { createBinary } = setupVault();
		const buffer = bytes(0x00, 0x01, 0x02, 0x03);
		requestUrlMock.mockResolvedValue({
			status: 200,
			headers: {},
			arrayBuffer: buffer,
		} as unknown as Awaited<ReturnType<typeof requestUrl>>);
		const episode = makeEpisode({
			title: "Blank Type Video",
			streamUrl: "https://example.com/watch?id=42",
			mediaType: "video",
		});

		await expect(
			downloadEpisodeWithNotice(episode, "Podcasts/{{title}}"),
		).rejects.toThrow("Not a playable media file");

		expect(createBinary).not.toHaveBeenCalled();
		expect(get(downloadedEpisodes)["Pod"]).toBeUndefined();
	});

	it("saves video/ogg downloads with a video extension even when bytes have an Ogg signature", async () => {
		const { createBinary } = setupVault();
		const buffer = bytes(0x4f, 0x67, 0x67, 0x53);
		requestUrlMock.mockResolvedValue({
			status: 200,
			headers: { "content-type": "video/ogg" },
			arrayBuffer: buffer,
		} as unknown as Awaited<ReturnType<typeof requestUrl>>);
		const episode = makeEpisode({
			title: "Ogg Video Title",
			streamUrl: "https://example.com/video.ogv",
			mediaType: "video",
		});
		const setTimeoutSpy = vi
			.spyOn(globalThis, "setTimeout")
			.mockImplementation(() => 0 as unknown as ReturnType<typeof setTimeout>);

		try {
			await downloadEpisodeWithNotice(episode, "Podcasts/{{title}}");
		} finally {
			setTimeoutSpy.mockRestore();
		}

		expect(createBinary).toHaveBeenCalledWith(
			"Podcasts/Ogg Video Title.ogv",
			buffer,
		);
		const recorded = get(downloadedEpisodes)["Pod"]?.[0];
		expect(recorded).toMatchObject({
			title: "Ogg Video Title",
			filePath: "Podcasts/Ogg Video Title.ogv",
			mediaType: "video",
			size: buffer.byteLength,
		});
	});

	it("uses an unambiguous video URL extension before the Ogg audio signature", async () => {
		const { createBinary } = setupVault();
		const buffer = bytes(0x4f, 0x67, 0x67, 0x53);
		requestUrlMock.mockResolvedValue({
			status: 200,
			headers: { "content-type": "application/octet-stream" },
			arrayBuffer: buffer,
		} as unknown as Awaited<ReturnType<typeof requestUrl>>);
		const episode = makeEpisode({
			title: "Generic Ogg Video",
			streamUrl: "https://example.com/video.ogv",
			mediaType: "video",
		});
		const setTimeoutSpy = vi
			.spyOn(globalThis, "setTimeout")
			.mockImplementation(() => 0 as unknown as ReturnType<typeof setTimeout>);

		try {
			await downloadEpisodeWithNotice(episode, "Podcasts/{{title}}");
		} finally {
			setTimeoutSpy.mockRestore();
		}

		expect(createBinary).toHaveBeenCalledWith(
			"Podcasts/Generic Ogg Video.ogv",
			buffer,
		);
		const recorded = get(downloadedEpisodes)["Pod"]?.[0];
		expect(recorded?.filePath).toBe("Podcasts/Generic Ogg Video.ogv");
		expect(recorded?.mediaType).toBe("video");
	});

	it("saves audio/mp4 downloads with an audio extension even when the URL ends in mp4", async () => {
		const { createBinary } = setupVault();
		const buffer = bytes(0x00, 0x00, 0x00, 0x18);
		requestUrlMock.mockResolvedValue({
			status: 200,
			headers: { "content-type": "audio/mp4" },
			arrayBuffer: buffer,
		} as unknown as Awaited<ReturnType<typeof requestUrl>>);
		const episode = makeEpisode({
			title: "Audio MP4 Title",
			streamUrl: "https://example.com/episode.mp4",
			mediaType: "audio",
		});
		const setTimeoutSpy = vi
			.spyOn(globalThis, "setTimeout")
			.mockImplementation(() => 0 as unknown as ReturnType<typeof setTimeout>);

		try {
			await downloadEpisodeWithNotice(episode, "Podcasts/{{title}}");
		} finally {
			setTimeoutSpy.mockRestore();
		}

		expect(createBinary).toHaveBeenCalledWith(
			"Podcasts/Audio MP4 Title.m4a",
			buffer,
		);
		const recorded = get(downloadedEpisodes)["Pod"]?.[0];
		expect(recorded).toMatchObject({
			title: "Audio MP4 Title",
			filePath: "Podcasts/Audio MP4 Title.m4a",
			mediaType: "audio",
			size: buffer.byteLength,
		});
	});

	it("preserves audio/webm downloads as audio WebM files", async () => {
		const { createBinary } = setupVault();
		const buffer = bytes(0x00, 0x00, 0x00, 0x18);
		requestUrlMock.mockResolvedValue({
			status: 200,
			headers: { "content-type": "audio/webm" },
			arrayBuffer: buffer,
		} as unknown as Awaited<ReturnType<typeof requestUrl>>);
		const episode = makeEpisode({
			title: "Audio WebM Title",
			streamUrl: "https://example.com/episode.webm",
			mediaType: "audio",
		});
		const setTimeoutSpy = vi
			.spyOn(globalThis, "setTimeout")
			.mockImplementation(() => 0 as unknown as ReturnType<typeof setTimeout>);

		try {
			await downloadEpisodeWithNotice(episode, "Podcasts/{{title}}");
		} finally {
			setTimeoutSpy.mockRestore();
		}

		expect(createBinary).toHaveBeenCalledWith(
			"Podcasts/Audio WebM Title.webm",
			buffer,
		);
		const recorded = get(downloadedEpisodes)["Pod"]?.[0];
		expect(recorded).toMatchObject({
			title: "Audio WebM Title",
			filePath: "Podcasts/Audio WebM Title.webm",
			mediaType: "audio",
			size: buffer.byteLength,
		});
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

	it("never writes a '.<ext>' dotfile when the path template is empty (#183)", async () => {
		const { createBinary } = setupVault();
		const buffer = bytes(0x49, 0x44, 0x33, 0x01);
		requestUrlMock.mockResolvedValue({
			status: 200,
			headers: { "content-type": "audio/mpeg" },
			arrayBuffer: buffer,
		} as unknown as Awaited<ReturnType<typeof requestUrl>>);

		const path = await downloadEpisode(makeEpisode(), "");

		// Falls back to a per-episode name instead of the un-indexable ".mp3".
		expect(path).toBe("My Title.mp3");
		expect(createBinary).toHaveBeenCalledWith("My Title.mp3", buffer);
		const [writtenPath] = createBinary.mock.calls[0];
		expect(writtenPath).not.toBe(".mp3");
	});

	it("uses GET response metadata for the final extension on new writes", async () => {
		const { createBinary } = setupVault();
		const buffer = bytes(0x4f, 0x67, 0x67, 0x53);
		requestUrlMock.mockResolvedValue({
			status: 200,
			headers: { "content-type": "video/ogg" },
			arrayBuffer: buffer,
		} as unknown as Awaited<ReturnType<typeof requestUrl>>);

		const episode = makeEpisode({
			title: "API Ogg Video",
			streamUrl: "https://example.com/video.ogg",
			mediaType: "video",
		});
		const path = await downloadEpisode(episode, "Podcasts/{{title}}");

		expect(path).toBe("Podcasts/API Ogg Video.ogv");
		expect(createBinary).toHaveBeenCalledWith(
			"Podcasts/API Ogg Video.ogv",
			buffer,
		);
		const recorded = get(downloadedEpisodes)["Pod"]?.[0];
		expect(recorded?.filePath).toBe("Podcasts/API Ogg Video.ogv");
		expect(recorded?.mediaType).toBe("video");
	});
});

describe("safeDownloadBasename (#183)", () => {
	it("falls back to the title when the template resolves to an empty name", () => {
		expect(safeDownloadBasename("", makeEpisode())).toBe("My Title");
	});

	it("replaces an empty trailing segment but keeps the folder", () => {
		expect(safeDownloadBasename("Downloads/", makeEpisode())).toBe(
			"Downloads/My Title",
		);
	});

	it("drops a stray leading slash instead of writing an absolute path", () => {
		expect(safeDownloadBasename("/{{title}}", makeEpisode())).toBe("My Title");
	});

	it("falls back to 'episode' when the title is empty/all-illegal", () => {
		expect(safeDownloadBasename("", makeEpisode({ title: "??" }))).toBe(
			"episode",
		);
	});

	it("leaves a valid per-episode template untouched", () => {
		expect(
			safeDownloadBasename("podcast/{{podcast}}/{{title}}", makeEpisode()),
		).toBe("podcast/Pod/My Title");
	});
});

describe("safeDownloadFilePath (#22)", () => {
	it("caps a long title's file name while keeping the audio extension", () => {
		const result = safeDownloadFilePath(
			"podcast/{{podcast}}/{{title}}",
			makeEpisode({ title: "X".repeat(400) }),
			"mp3",
		);
		const name = result.split("/").pop() ?? "";
		expect(result.startsWith("podcast/Pod/")).toBe(true);
		expect(name.endsWith(".mp3")).toBe(true);
		expect(name.length).toBeLessThanOrEqual(255);
	});

	it("leaves a short path unchanged", () => {
		expect(
			safeDownloadFilePath("podcast/{{podcast}}/{{title}}", makeEpisode(), "mp3"),
		).toBe("podcast/Pod/My Title.mp3");
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

	it("reuses the cached file when only the signed-CDN query token changed", async () => {
		// Same audio file, rotated token: origin+path match, so the cache should
		// still be used rather than re-downloading the (large) episode.
		const downloaded = episode({
			title: "Token Episode",
			streamUrl: "https://cdn.example.com/ep.mp3?token=OLD&exp=1",
		});
		seedFile("Podcasts/token.mp3", "CACHED-CORRECT-AUDIO");
		downloadedEpisodes.addEpisode(downloaded, "Podcasts/token.mp3", 20);

		const current = episode({
			title: "Token Episode",
			streamUrl: "https://cdn.example.com/ep.mp3?token=NEW&exp=2",
		});
		const result = await getEpisodeAudioBuffer(current);

		expect(decode(result.buffer)).toBe("CACHED-CORRECT-AUDIO");
		expect(requestUrlMock).not.toHaveBeenCalled();
	});

	it("does not reuse a same-title sibling's download; fetches this episode's own audio", async () => {
		// Same podcast + same title, different episode (different stream URL). The
		// registry is keyed by podcastName+title, so getEpisode() returns the
		// sibling's entry — reusing its file would transcribe the wrong audio.
		const downloaded = episode({
			title: "Episode",
			streamUrl: "https://example.com/spanish.mp3",
		});
		seedFile("Podcasts/sibling.mp3", "SPANISH-AUDIO");
		downloadedEpisodes.addEpisode(downloaded, "Podcasts/sibling.mp3", 13);

		const current = episode({
			title: "Episode",
			streamUrl: "https://example.com/english.mp3",
		});
		const result = await getEpisodeAudioBuffer(current);

		expect(decode(result.buffer)).toBe("ENGLISH-AUDIO");
		expect(requestUrlMock).toHaveBeenCalledWith(
			expect.objectContaining({ url: "https://example.com/english.mp3" }),
		);
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

	it("rejects extensionless video streams instead of treating their mp4 content type as audio", async () => {
		requestUrlMock.mockImplementation(
			() =>
				Promise.resolve({
					status: 200,
					headers: { "content-type": "video/mp4" },
					arrayBuffer: bytes(0x00, 0x00, 0x00, 0x18),
				}) as unknown as ReturnType<typeof requestUrl>,
		);
		const ep = episode({
			title: "Video Episode",
			streamUrl: "https://example.com/watch?id=42",
		});

		await expect(getEpisodeAudioBuffer(ep)).rejects.toThrow(/not audio/i);
	});

	it("uses explicit audio metadata for mp4 streams served with a video content type", async () => {
		requestUrlMock.mockImplementation(
			() =>
				Promise.resolve({
					status: 200,
					headers: { "content-type": "video/mp4" },
					arrayBuffer: new TextEncoder().encode("VIDEO-TYPED-AUDIO-MP4")
						.buffer,
				}) as unknown as ReturnType<typeof requestUrl>,
		);
		const ep = episode({
			title: "Video Typed Audio MP4",
			streamUrl: "https://cdn.example.com/episode.mp4",
			mediaType: "audio",
		});

		const result = await getEpisodeAudioBuffer(ep);

		expect(decode(result.buffer)).toBe("VIDEO-TYPED-AUDIO-MP4");
		expect(result.extension).toBe("m4a");
	});

	it("uses explicit audio metadata for webm streams served with a video content type", async () => {
		requestUrlMock.mockImplementation(
			() =>
				Promise.resolve({
					status: 200,
					headers: { "content-type": "video/webm" },
					arrayBuffer: new TextEncoder().encode("VIDEO-TYPED-AUDIO-WEBM")
						.buffer,
				}) as unknown as ReturnType<typeof requestUrl>,
		);
		const ep = episode({
			title: "Video Typed Audio WebM",
			streamUrl: "https://cdn.example.com/episode.webm",
			mediaType: "audio",
		});

		const result = await getEpisodeAudioBuffer(ep);

		expect(decode(result.buffer)).toBe("VIDEO-TYPED-AUDIO-WEBM");
		expect(result.extension).toBe("webm");
	});

	it("uses explicit audio metadata for mp4 streams served as octet-stream", async () => {
		requestUrlMock.mockImplementation(
			() =>
				Promise.resolve({
					status: 200,
					headers: { "content-type": "application/octet-stream" },
					arrayBuffer: new TextEncoder().encode("AUDIO-MP4-BYTES").buffer,
				}) as unknown as ReturnType<typeof requestUrl>,
		);
		const ep = episode({
			title: "Generic Audio MP4",
			streamUrl: "https://cdn.example.com/episode.mp4",
			mediaType: "audio",
		});

		const result = await getEpisodeAudioBuffer(ep);

		expect(decode(result.buffer)).toBe("AUDIO-MP4-BYTES");
		expect(result.extension).toBe("m4a");
	});

	it("uses explicit audio metadata for webm streams served as octet-stream", async () => {
		requestUrlMock.mockImplementation(
			() =>
				Promise.resolve({
					status: 200,
					headers: { "content-type": "application/octet-stream" },
					arrayBuffer: new TextEncoder().encode("AUDIO-WEBM-BYTES").buffer,
				}) as unknown as ReturnType<typeof requestUrl>,
		);
		const ep = episode({
			title: "Generic Audio WebM",
			streamUrl: "https://cdn.example.com/episode.webm",
			mediaType: "audio",
		});

		const result = await getEpisodeAudioBuffer(ep);

		expect(decode(result.buffer)).toBe("AUDIO-WEBM-BYTES");
		expect(result.extension).toBe("webm");
	});

	it("does not reuse a known video download for transcription", async () => {
		const downloaded = episode({
			title: "Known Video",
			streamUrl: "https://cdn.example.com/watch?id=old",
			mediaType: "video",
		});
		downloadedEpisodes.addEpisode(downloaded, "Podcasts/video.mp4", 20);

		const current = episode({
			title: "Known Video",
			streamUrl: "https://cdn.example.com/watch?id=old",
		});

		await expect(getEpisodeAudioBuffer(current)).rejects.toThrow(
			/audio episodes only/i,
		);
		expect(requestUrlMock).not.toHaveBeenCalled();
	});

	it("does not transcribe a downloaded video file without media metadata", async () => {
		const downloaded = episode({
			title: "Unmarked Video",
			streamUrl: "https://cdn.example.com/watch?id=old",
		});
		seedFile("Podcasts/unmarked-video.ogv", "VIDEO-BYTES");
		downloadedEpisodes.addEpisode(downloaded, "Podcasts/unmarked-video.ogv", 20);

		const current = episode({
			title: "Unmarked Video",
			streamUrl: "https://cdn.example.com/watch?id=old",
		});

		await expect(getEpisodeAudioBuffer(current)).rejects.toThrow(
			/audio episodes only/i,
		);
		expect(requestUrlMock).not.toHaveBeenCalled();
	});

	it("reuses an audio/webm download whose file path is webm", async () => {
		const downloaded = episode({
			title: "Audio WebM Download",
			streamUrl: "https://cdn.example.com/episode.webm",
			mediaType: "audio",
		});
		seedFile("Podcasts/audio-webm.webm", "AUDIO-WEBM-BYTES");
		downloadedEpisodes.addEpisode(downloaded, "Podcasts/audio-webm.webm", 20);

		const current = episode({
			title: "Audio WebM Download",
			streamUrl: "https://cdn.example.com/episode.webm",
			mediaType: "audio",
		});

		const result = await getEpisodeAudioBuffer(current);

		expect(decode(result.buffer)).toBe("AUDIO-WEBM-BYTES");
		expect(result.extension).toBe("webm");
		expect(result.basename).toBe("audio-webm");
		expect(requestUrlMock).not.toHaveBeenCalled();
	});

	it("reuses an audio/mp4 download whose legacy file path is mp4", async () => {
		const downloaded = episode({
			title: "Audio MP4 Download",
			streamUrl: "https://cdn.example.com/episode.mp4",
			mediaType: "audio",
		});
		seedFile("Podcasts/audio-mp4.mp4", "AUDIO-MP4-BYTES");
		downloadedEpisodes.addEpisode(downloaded, "Podcasts/audio-mp4.mp4", 20);

		const current = episode({
			title: "Audio MP4 Download",
			streamUrl: "https://cdn.example.com/episode.mp4",
			mediaType: "audio",
		});

		const result = await getEpisodeAudioBuffer(current);

		expect(decode(result.buffer)).toBe("AUDIO-MP4-BYTES");
		expect(result.extension).toBe("m4a");
		expect(result.basename).toBe("audio-mp4");
		expect(requestUrlMock).not.toHaveBeenCalled();
	});

	it("reuses a legacy audio/mp4 download whose registry entry lacks media metadata", async () => {
		const downloaded = episode({
			title: "Legacy Audio MP4 Download",
			streamUrl: "https://cdn.example.com/legacy-episode.mp4",
		});
		seedFile("Podcasts/legacy-audio-mp4.mp4", "LEGACY-AUDIO-MP4-BYTES");
		downloadedEpisodes.addEpisode(
			downloaded,
			"Podcasts/legacy-audio-mp4.mp4",
			20,
		);

		const current = episode({
			title: "Legacy Audio MP4 Download",
			streamUrl: "https://cdn.example.com/legacy-episode.mp4",
			mediaType: "audio",
		});

		const result = await getEpisodeAudioBuffer(current);

		expect(decode(result.buffer)).toBe("LEGACY-AUDIO-MP4-BYTES");
		expect(result.extension).toBe("m4a");
		expect(result.basename).toBe("legacy-audio-mp4");
		expect(requestUrlMock).not.toHaveBeenCalled();
	});

	it("does not transcribe a local video file", async () => {
		const local = episode({
			title: "Local Video",
			podcastName: "local file",
			description: "",
			content: "",
			streamUrl: "",
			url: "Local/video.webm",
			filePath: "Local/video.webm",
			mediaType: "video",
		} as Partial<LocalEpisode>) as LocalEpisode;
		seedFile("Local/video.webm", "VIDEO-BYTES");

		await expect(getEpisodeAudioBuffer(local)).rejects.toThrow(
			/audio episodes only/i,
		);
		expect(requestUrlMock).not.toHaveBeenCalled();
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
