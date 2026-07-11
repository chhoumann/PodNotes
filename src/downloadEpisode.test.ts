import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { Notice, requestUrl, TFile } from "obsidian";
import downloadEpisodeWithNotice, {
	getEpisodeAudioBuffer,
	safeDownloadBasename,
	safeDownloadFilePath,
} from "./downloadEpisode";
import { downloadedEpisodes, plugin } from "./store";
import type PodNotes from "./main";
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

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

function setupVault({ streaming = false }: { streaming?: boolean } = {}) {
	const present = new Set<string>(); // vault index (getAbstractFileByPath)
	const disk = new Set<string>(); // raw filesystem (adapter.exists)
	const createdFolders: string[] = [];
	const written = new Map<string, number>();

	const createBinary = vi.fn(async (path: string, _data: ArrayBuffer) => {
		present.add(path);
		disk.add(path);
		return new TFile();
	});
	const createFolder = vi.fn(async (path: string) => {
		present.add(path);
		createdFolders.push(path);
	});
	const deleteFile = vi.fn(async (_file: unknown) => {});
	const removeFile = vi.fn(async (path: string) => {
		disk.delete(path);
	});

	// Adapter writes land on "disk" but NOT in the vault index (present),
	// mirroring how getAbstractFileByPath can miss a freshly adapter-written file
	// until the watcher reconciles it. The streaming download path additionally
	// needs writeBinary + appendBinary; the legacy path uses neither and falls
	// back to vault.createBinary.
	const writeBinary = vi.fn(async (path: string, data: ArrayBuffer) => {
		disk.add(path);
		written.set(path, data.byteLength);
	});
	const appendBinary = vi.fn(async (path: string, data: ArrayBuffer) => {
		written.set(path, (written.get(path) ?? 0) + data.byteLength);
	});
	// A raw adapter rename moves bytes on disk AND reconciles the destination into
	// the vault index (Obsidian fires a create event for it), so the moved file is
	// immediately resolvable for playback — mirroring the on-device behaviour.
	const rename = vi.fn(async (from: string, to: string) => {
		if (written.has(from)) {
			written.set(to, written.get(from) ?? 0);
			written.delete(from);
		}
		disk.delete(from);
		disk.add(to);
		present.add(to);
	});
	// Immediate children of `folder`, mirroring DataAdapter.list (returns full
	// vault-relative paths). Lets the stale-partial sweep find orphaned temps.
	const list = vi.fn(async (folder: string) => {
		const prefix = folder ? `${folder}/` : "";
		const files: string[] = [];
		for (const p of disk) {
			if (!p.startsWith(prefix)) continue;
			if (!p.slice(prefix.length).includes("/")) files.push(p);
		}
		return { files, folders: [] as string[] };
	});

	const adapter: Record<string, unknown> = {
		exists: async (path: string) => disk.has(path) || present.has(path),
		remove: removeFile,
	};
	if (streaming) {
		adapter.writeBinary = writeBinary;
		adapter.appendBinary = appendBinary;
		adapter.rename = rename;
		adapter.list = list;
	}

	const app = {
		vault: {
			getAbstractFileByPath: (path: string) => (present.has(path) ? new TFile() : null),
			createBinary,
			createFolder,
			delete: deleteFile,
			adapter,
		},
	};
	// The download code (and ensureFolderExists's default) read app from the
	// plugin store; the global `app` is set to the same mock too so any other
	// shared-harness reader stays valid.
	(globalThis as { app?: unknown }).app = app;
	plugin.set({ app } as unknown as PodNotes);

	return {
		present,
		disk,
		createdFolders,
		createBinary,
		createFolder,
		deleteFile,
		removeFile,
		writeBinary,
		appendBinary,
		rename,
		list,
		written,
	};
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
	plugin.set(undefined as unknown as PodNotes);
});

describe("downloadEpisodeWithNotice (download command path)", () => {
	it("saves extensionless video downloads using the response content type", async () => {
		const { createBinary, createdFolders } = setupVault();
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
			await downloadEpisodeWithNotice(episode, "Podcasts/{{podcast}}/{{title}}");
		} finally {
			setTimeoutSpy.mockRestore();
		}

		expect(createdFolders).toEqual(["Podcasts", "Podcasts/Pod"]);
		expect(createBinary).toHaveBeenCalledTimes(1);
		const [writtenPath, writtenData] = createBinary.mock.calls[0];
		expect(writtenPath).toBe("Podcasts/Pod/Video Title.mp4");
		// The active non-streaming fallback must pass the response buffer straight
		// through to createBinary without making another whole-file copy (#113).
		expect(writtenData).toBe(buffer);
		const recorded = get(downloadedEpisodes)["Pod"]?.[0];
		expect(recorded).toMatchObject({
			title: "Video Title",
			filePath: "Podcasts/Pod/Video Title.mp4",
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

		await expect(downloadEpisodeWithNotice(episode, "Podcasts/{{title}}")).rejects.toThrow(
			"Not a playable media file",
		);

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

		await expect(downloadEpisodeWithNotice(episode, "Podcasts/{{title}}")).rejects.toThrow(
			"Not a playable media file",
		);

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

		expect(createBinary).toHaveBeenCalledWith("Podcasts/Ogg Video Title.ogv", buffer);
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

		expect(createBinary).toHaveBeenCalledWith("Podcasts/Generic Ogg Video.ogv", buffer);
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

		expect(createBinary).toHaveBeenCalledWith("Podcasts/Audio MP4 Title.m4a", buffer);
		const recorded = get(downloadedEpisodes)["Pod"]?.[0];
		expect(recorded).toMatchObject({
			title: "Audio MP4 Title",
			filePath: "Podcasts/Audio MP4 Title.m4a",
			mediaType: "audio",
			size: buffer.byteLength,
		});
	});

	it("ignores a foreign file at the provisional URL-extension path when the sniffed final path is free (Codex #290)", async () => {
		const { createBinary, present } = setupVault();
		// A different episode's file occupies the path the URL extension implies
		// (.mp4). The response sniffs to .m4a, so the real destination is free and
		// the fast-path check must fall through to the probe instead of throwing a
		// destination collision.
		present.add("Podcasts/Audio MP4 Title.mp4");
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

		expect(createBinary).toHaveBeenCalledWith("Podcasts/Audio MP4 Title.m4a", buffer);
		expect(get(downloadedEpisodes)["Pod"]?.[0]).toMatchObject({
			filePath: "Podcasts/Audio MP4 Title.m4a",
		});
	});

	it("saves an audio/mp4 download with a generic ISO-BMFF brand as m4a, not mp4 (Codex #213)", async () => {
		const { createBinary } = setupVault();
		// Real ISO-BMFF: 4-byte box size, 'ftyp', then a generic 'mp42' major brand.
		// detectAudioFileExtension returns "mp4" for this; for an audio download it
		// must still be saved as m4a so it isn't treated as an ambiguous container.
		const buffer = bytes(
			0x00,
			0x00,
			0x00,
			0x20,
			0x66,
			0x74,
			0x79,
			0x70,
			0x6d,
			0x70,
			0x34,
			0x32,
		);
		requestUrlMock.mockResolvedValue({
			status: 200,
			headers: { "content-type": "audio/mp4" },
			arrayBuffer: buffer,
		} as unknown as Awaited<ReturnType<typeof requestUrl>>);
		const episode = makeEpisode({
			title: "Brandy MP4 Title",
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

		expect(createBinary).toHaveBeenCalledWith("Podcasts/Brandy MP4 Title.m4a", buffer);
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

		expect(createBinary).toHaveBeenCalledWith("Podcasts/Audio WebM Title.webm", buffer);
		const recorded = get(downloadedEpisodes)["Pod"]?.[0];
		expect(recorded).toMatchObject({
			title: "Audio WebM Title",
			filePath: "Podcasts/Audio WebM Title.webm",
			mediaType: "audio",
			size: buffer.byteLength,
		});
	});

	it("dismisses the notice on a successful download (#DL-03)", async () => {
		setupVault();
		requestUrlMock.mockResolvedValue({
			status: 200,
			headers: { "content-type": "audio/mpeg" },
			arrayBuffer: bytes(0x49, 0x44, 0x33, 0x01),
		} as unknown as Awaited<ReturnType<typeof requestUrl>>);
		const hideSpy = vi.spyOn(Notice.prototype, "hide");
		vi.useFakeTimers();

		try {
			await downloadEpisodeWithNotice(makeEpisode(), "Podcasts/{{title}}");
			expect(hideSpy).not.toHaveBeenCalled();
			vi.runAllTimers();
			expect(hideSpy).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
			hideSpy.mockRestore();
		}
	});

	it("still dismisses the notice when the download fails (#DL-03)", async () => {
		setupVault();
		requestUrlMock.mockRejectedValue(new Error("network down"));
		const hideSpy = vi.spyOn(Notice.prototype, "hide");
		vi.useFakeTimers();

		try {
			await expect(
				downloadEpisodeWithNotice(makeEpisode(), "Podcasts/{{title}}"),
			).rejects.toThrow("Failed to download episode: Network request failed.");
			// The dismissal lives in a finally, so a rejected download still hides the
			// notice exactly once instead of leaving it open forever.
			vi.runAllTimers();
			expect(hideSpy).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
			hideSpy.mockRestore();
		}
	});

	it("still dismisses the notice on the non-playable rejection (#DL-03)", async () => {
		setupVault();
		requestUrlMock.mockResolvedValue({
			status: 200,
			headers: { "content-type": "text/html" },
			arrayBuffer: new TextEncoder().encode("<html>nope</html>").buffer,
		} as unknown as Awaited<ReturnType<typeof requestUrl>>);
		const hideSpy = vi.spyOn(Notice.prototype, "hide");
		vi.useFakeTimers();

		try {
			await expect(
				downloadEpisodeWithNotice(
					makeEpisode({ streamUrl: "https://example.com/ep.mp3" }),
					"Podcasts/{{title}}",
				),
			).rejects.toThrow(/Not a playable media file/);
			vi.runAllTimers();
			expect(hideSpy).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
			hideSpy.mockRestore();
		}
	});

	it("rejects an HTML error page served at a .mp3 URL instead of saving it (#DL-07)", async () => {
		const { createBinary } = setupVault();
		requestUrlMock.mockResolvedValue({
			status: 200,
			headers: { "content-type": "text/html; charset=utf-8" },
			arrayBuffer: new TextEncoder().encode("<html>login required</html>").buffer,
		} as unknown as Awaited<ReturnType<typeof requestUrl>>);
		const setTimeoutSpy = vi
			.spyOn(globalThis, "setTimeout")
			.mockImplementation(() => 0 as unknown as ReturnType<typeof setTimeout>);

		try {
			await expect(
				downloadEpisodeWithNotice(
					// URL ends in .mp3, so the extension heuristic would otherwise
					// accept the HTML body as playable media.
					makeEpisode({ streamUrl: "https://example.com/expired.mp3" }),
					"Podcasts/{{title}}",
				),
			).rejects.toThrow(/Not a playable media file/);
		} finally {
			setTimeoutSpy.mockRestore();
		}

		expect(createBinary).not.toHaveBeenCalled();
		expect(get(downloadedEpisodes)["Pod"]).toBeUndefined();
	});

	it("rejects an RSS/Atom feed served at a .mp3 URL (structured +xml types) (#213)", async () => {
		const { createBinary } = setupVault();
		requestUrlMock.mockResolvedValue({
			status: 200,
			headers: { "content-type": "application/rss+xml" },
			arrayBuffer: new TextEncoder().encode("<rss><channel/></rss>").buffer,
		} as unknown as Awaited<ReturnType<typeof requestUrl>>);
		const setTimeoutSpy = vi
			.spyOn(globalThis, "setTimeout")
			.mockImplementation(() => 0 as unknown as ReturnType<typeof setTimeout>);

		try {
			await expect(
				downloadEpisodeWithNotice(
					makeEpisode({ streamUrl: "https://example.com/expired.mp3" }),
					"Podcasts/{{title}}",
				),
			).rejects.toThrow(/Not a playable media file/);
		} finally {
			setTimeoutSpy.mockRestore();
		}

		expect(createBinary).not.toHaveBeenCalled();
	});

	it("rejects a JSON error body served at a .mp3 URL (#DL-07)", async () => {
		const { createBinary } = setupVault();
		requestUrlMock.mockResolvedValue({
			status: 200,
			headers: { "content-type": "application/json" },
			arrayBuffer: new TextEncoder().encode('{"error":"forbidden"}').buffer,
		} as unknown as Awaited<ReturnType<typeof requestUrl>>);

		await expect(
			downloadEpisodeWithNotice(
				makeEpisode({ streamUrl: "https://example.com/ep.mp3" }),
				"Podcasts/{{title}}",
			),
		).rejects.toThrow(/Not a playable media file/);

		expect(createBinary).not.toHaveBeenCalled();
	});

	it("still saves a real audio download served as application/octet-stream (#DL-07)", async () => {
		// octet-stream is genuinely ambiguous and is intentionally NOT rejected up
		// front — real CDNs serve media this way, so it falls through to the
		// extension/signature heuristic.
		const { createBinary } = setupVault();
		const buffer = bytes(0x49, 0x44, 0x33, 0x01);
		requestUrlMock.mockResolvedValue({
			status: 200,
			headers: { "content-type": "application/octet-stream" },
			arrayBuffer: buffer,
		} as unknown as Awaited<ReturnType<typeof requestUrl>>);
		const setTimeoutSpy = vi
			.spyOn(globalThis, "setTimeout")
			.mockImplementation(() => 0 as unknown as ReturnType<typeof setTimeout>);

		try {
			await downloadEpisodeWithNotice(
				makeEpisode({ streamUrl: "https://example.com/ep.mp3" }),
				"Podcasts/{{title}}",
			);
		} finally {
			setTimeoutSpy.mockRestore();
		}

		expect(createBinary).toHaveBeenCalledWith("Podcasts/My Title.mp3", buffer);
	});
});

describe("safeDownloadBasename (#183)", () => {
	it("falls back to the title when the template resolves to an empty name", () => {
		expect(safeDownloadBasename("", makeEpisode())).toBe("My Title");
	});

	it("replaces an empty trailing segment but keeps the folder", () => {
		expect(safeDownloadBasename("Downloads/", makeEpisode())).toBe("Downloads/My Title");
	});

	it("drops a stray leading slash instead of writing an absolute path", () => {
		expect(safeDownloadBasename("/{{title}}", makeEpisode())).toBe("My Title");
	});

	it("falls back to 'episode' when the title is empty/all-illegal", () => {
		expect(safeDownloadBasename("", makeEpisode({ title: "??" }))).toBe("episode");
	});

	it("leaves a valid per-episode template untouched", () => {
		expect(safeDownloadBasename("podcast/{{podcast}}/{{title}}", makeEpisode())).toBe(
			"podcast/Pod/My Title",
		);
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
		expect(safeDownloadFilePath("podcast/{{podcast}}/{{title}}", makeEpisode(), "mp3")).toBe(
			"podcast/Pod/My Title.mp3",
		);
	});
});

describe("getEpisodeAudioBuffer (issue #107)", () => {
	const files = new Map<string, ArrayBuffer>();

	function makeTFile(path: string): TFile {
		const file = new TFile();
		const dot = path.lastIndexOf(".");
		const slash = path.lastIndexOf("/");
		(file as { path: string }).path = path;
		(file as { extension: string }).extension = dot > slash ? path.slice(dot + 1) : "";
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
		const app = {
			vault: {
				getAbstractFileByPath: (path: string) => (files.has(path) ? makeTFile(path) : null),
				readBinary: async (file: TFile) => files.get(file.path),
			},
		};
		(globalThis as { app?: unknown }).app = app;
		plugin.set({ app } as unknown as PodNotes);
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

	it("does not reuse a media-path download when the stable query id changed", async () => {
		const downloaded = episode({
			title: "Fixed Path Episode",
			streamUrl: "https://cdn.example.com/episode.mp3?id=1&token=OLD",
		});
		seedFile("Podcasts/fixed-path.mp3", "WRONG-CACHED-AUDIO");
		downloadedEpisodes.addEpisode(downloaded, "Podcasts/fixed-path.mp3", 20);

		const current = episode({
			title: "Fixed Path Episode",
			streamUrl: "https://cdn.example.com/episode.mp3?id=2&token=NEW",
		});
		const result = await getEpisodeAudioBuffer(current);

		expect(decode(result.buffer)).toBe("ENGLISH-AUDIO");
		expect(requestUrlMock).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "https://cdn.example.com/episode.mp3?id=2&token=NEW",
			}),
		);
	});

	it("reuses an extensionless cached file when only signed token params changed", async () => {
		const downloaded = episode({
			title: "Extensionless Token Episode",
			streamUrl: "https://cdn.example.com/download?id=123&token=OLD&exp=1",
		});
		seedFile("Podcasts/extensionless-token.m4a", "CACHED-EXTENSIONLESS-AUDIO");
		downloadedEpisodes.addEpisode(downloaded, "Podcasts/extensionless-token.m4a", 20);

		const current = episode({
			title: "Extensionless Token Episode",
			streamUrl: "https://cdn.example.com/download?id=123&token=NEW&exp=2",
		});
		const result = await getEpisodeAudioBuffer(current);

		expect(decode(result.buffer)).toBe("CACHED-EXTENSIONLESS-AUDIO");
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
					arrayBuffer: new TextEncoder().encode("<html>login required</html>").buffer,
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

	it.each([
		{
			contentType: "video/mp4",
			expectedExtension: "m4a",
			streamUrl: "https://cdn.example.com/legacy-audio.mp4",
			text: "LEGACY-VIDEO-TYPED-AUDIO-MP4",
		},
		{
			contentType: "application/octet-stream",
			expectedExtension: "webm",
			streamUrl: "https://cdn.example.com/legacy-audio.webm",
			text: "LEGACY-GENERIC-AUDIO-WEBM",
		},
	])(
		"uses an inferred audio hint for legacy container streams served as $contentType",
		async ({ contentType, expectedExtension, streamUrl, text }) => {
			requestUrlMock.mockImplementation(
				() =>
					Promise.resolve({
						status: 200,
						headers: { "content-type": contentType },
						arrayBuffer: new TextEncoder().encode(text).buffer,
					}) as unknown as ReturnType<typeof requestUrl>,
			);
			const ep = episode({
				title: "Legacy Container Audio",
				streamUrl,
			});

			const result = await getEpisodeAudioBuffer(ep);

			expect(decode(result.buffer)).toBe(text);
			expect(result.extension).toBe(expectedExtension);
		},
	);

	it("uses explicit audio metadata for mp4 streams served with a video content type", async () => {
		requestUrlMock.mockImplementation(
			() =>
				Promise.resolve({
					status: 200,
					headers: { "content-type": "video/mp4" },
					arrayBuffer: new TextEncoder().encode("VIDEO-TYPED-AUDIO-MP4").buffer,
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
					arrayBuffer: new TextEncoder().encode("VIDEO-TYPED-AUDIO-WEBM").buffer,
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

		await expect(getEpisodeAudioBuffer(current)).rejects.toThrow(/audio episodes only/i);
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

		await expect(getEpisodeAudioBuffer(current)).rejects.toThrow(/audio episodes only/i);
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
		downloadedEpisodes.addEpisode(downloaded, "Podcasts/legacy-audio-mp4.mp4", 20);

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

		await expect(getEpisodeAudioBuffer(local)).rejects.toThrow(/audio episodes only/i);
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

	it.each([
		"file:///Users/victim/.ssh/id_rsa",
		"http://169.254.169.254/latest/meta-data/",
		"http://127.0.0.1:9200/_search",
	])(
		"refuses to fetch a feed-controlled stream URL pointing at %s (SSRF/exfil guard)",
		async (streamUrl) => {
			const ssrf = episode({
				title: "Malicious Enclosure",
				streamUrl,
			});

			await expect(getEpisodeAudioBuffer(ssrf)).rejects.toThrow(/not allowed/);
			expect(requestUrlMock).not.toHaveBeenCalled();
		},
	);

	it("redacts credentialed media targets and native transport errors", async () => {
		const marker = "private-download-marker";
		requestUrlMock.mockRejectedValue(new Error(`native failure: ${marker}`));
		const privateEpisode = episode({
			title: "Private episode",
			streamUrl: `https://listener:${marker}@example.com/audio.mp3?token=${marker}`,
		});

		const error = await getEpisodeAudioBuffer(privateEpisode).catch(
			(caught: unknown) => caught,
		);

		expect(String(error)).toContain("Network request failed");
		expect(String(error)).not.toContain(marker);
		expect(String(error)).not.toContain("listener:");
	});
});

describe("downloadEpisodeWithNotice (streaming range path)", () => {
	// A server that returns short bodies regardless of the requested range size
	// lets us exercise multi-chunk streaming without allocating real 4 MiB buffers
	// (the loop advances by the ACTUAL bytes returned, not the requested span).
	function rangeResponse(status: number, body: number[], headers: Record<string, string> = {}) {
		return {
			status,
			headers,
			arrayBuffer: new Uint8Array(body).buffer,
		} as unknown as Awaited<ReturnType<typeof requestUrl>>;
	}

	it("streams a ranged (206) download in chunks via writeBinary + appendBinary", async () => {
		const v = setupVault({ streaming: true });
		requestUrlMock
			.mockResolvedValueOnce(
				rangeResponse(206, [1, 2, 3, 4, 5, 6, 7, 8], {
					"content-type": "audio/mpeg",
					"content-range": "bytes 0-7/16",
				}),
			)
			.mockResolvedValueOnce(
				rangeResponse(206, [9, 10, 11, 12, 13, 14, 15, 16], {
					"content-range": "bytes 8-15/16",
				}),
			);

		await downloadEpisodeWithNotice(makeEpisode(), "Podcasts/{{title}}");

		expect(v.writeBinary).toHaveBeenCalledTimes(1);
		expect(v.appendBinary).toHaveBeenCalledTimes(1);
		expect(v.createBinary).not.toHaveBeenCalled();
		const recorded = get(downloadedEpisodes)["Pod"]?.[0];
		expect(recorded?.filePath).toBe("Podcasts/My Title.mp3");
		expect(recorded?.size).toBe(16);
	});

	it("streams to a dot-prefixed temp the watchers don't see, then renames it into place", async () => {
		const v = setupVault({ streaming: true });
		requestUrlMock
			.mockResolvedValueOnce(
				rangeResponse(206, [1, 2, 3, 4, 5, 6, 7, 8], {
					"content-type": "audio/mpeg",
					"content-range": "bytes 0-7/16",
				}),
			)
			.mockResolvedValueOnce(
				rangeResponse(206, [9, 10, 11, 12, 13, 14, 15, 16], {
					"content-range": "bytes 8-15/16",
				}),
			);

		await downloadEpisodeWithNotice(makeEpisode(), "Podcasts/{{title}}");

		// Every chunk went to a single temp path, and it was a hidden sibling partial
		// (dot-prefixed, in the same folder) — never the final media path.
		const [writePath] = v.writeBinary.mock.calls[0];
		const [appendPath] = v.appendBinary.mock.calls[0];
		expect(writePath).toBe(appendPath);
		expect(writePath).toMatch(/^Podcasts\/\..*\.My Title\.mp3\.podnotes-partial$/);
		expect(writePath).not.toBe("Podcasts/My Title.mp3");

		// Exactly one move into the real path; the temp does not survive.
		expect(v.rename).toHaveBeenCalledTimes(1);
		expect(v.rename).toHaveBeenCalledWith(writePath, "Podcasts/My Title.mp3");
		expect(v.disk.has(writePath)).toBe(false);
		// The moved file is index-resolvable, so playback (getAbstractFileByPath)
		// resolves it rather than silently binding src="".
		expect(v.present.has("Podcasts/My Title.mp3")).toBe(true);
	});

	it("cleans up the temp (not the final path) when the move into place fails", async () => {
		const v = setupVault({ streaming: true });
		v.rename.mockRejectedValueOnce(new Error("rename boom"));
		requestUrlMock
			.mockResolvedValueOnce(
				rangeResponse(206, [1, 2, 3, 4, 5, 6, 7, 8], {
					"content-type": "audio/mpeg",
					"content-range": "bytes 0-7/16",
				}),
			)
			.mockResolvedValueOnce(
				rangeResponse(206, [9, 10, 11, 12, 13, 14, 15, 16], {
					"content-range": "bytes 8-15/16",
				}),
			);

		await expect(
			downloadEpisodeWithNotice(makeEpisode(), "Podcasts/{{title}}"),
		).rejects.toThrow(/rename boom/);

		const [tmpPath] = v.writeBinary.mock.calls[0];
		// The failed move removed the temp via the adapter, and the final path was
		// never created or registered.
		expect(v.removeFile).toHaveBeenCalledWith(tmpPath);
		expect(v.disk.has(tmpPath)).toBe(false);
		expect(v.present.has("Podcasts/My Title.mp3")).toBe(false);
		expect(get(downloadedEpisodes)["Pod"]).toBeUndefined();
	});

	it("sweeps an orphaned partial from a prior killed download before streaming", async () => {
		const v = setupVault({ streaming: true });
		// A partial left behind in the target folder by a download that was killed
		// mid-stream (the OOM crash this fix addresses).
		v.disk.add("Podcasts/.My Title.mp3.dead-orphan.podnotes-partial");
		// An unrelated real file in the same folder must be left untouched.
		v.disk.add("Podcasts/Keep Me.mp3");
		requestUrlMock
			.mockResolvedValueOnce(
				rangeResponse(206, [1, 2, 3, 4, 5, 6, 7, 8], {
					"content-type": "audio/mpeg",
					"content-range": "bytes 0-7/16",
				}),
			)
			.mockResolvedValueOnce(
				rangeResponse(206, [9, 10, 11, 12, 13, 14, 15, 16], {
					"content-range": "bytes 8-15/16",
				}),
			);

		await downloadEpisodeWithNotice(makeEpisode(), "Podcasts/{{title}}");

		expect(v.removeFile).toHaveBeenCalledWith(
			"Podcasts/.My Title.mp3.dead-orphan.podnotes-partial",
		);
		expect(v.disk.has("Podcasts/Keep Me.mp3")).toBe(true);
	});

	it("writes the whole body in one shot when the server ignores Range (200)", async () => {
		const v = setupVault({ streaming: true });
		requestUrlMock.mockResolvedValue(
			rangeResponse(200, [0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4], {
				"content-type": "audio/mpeg",
			}),
		);

		await downloadEpisodeWithNotice(makeEpisode(), "Podcasts/{{title}}");

		expect(v.writeBinary).toHaveBeenCalledTimes(1);
		expect(v.appendBinary).not.toHaveBeenCalled();
		expect(get(downloadedEpisodes)["Pod"]?.[0]?.size).toBe(8);
	});

	it("never reuses a sequential shared destination for a different episode", async () => {
		const v = setupVault({ streaming: true });
		const template = "Podcasts/shared";
		const episodeA = makeEpisode({ title: "Episode A", podcastName: "Podcast A" });
		const episodeB = makeEpisode({ title: "Episode B", podcastName: "Podcast B" });
		requestUrlMock.mockResolvedValue(
			rangeResponse(200, [0xff, 0xfb, 0x90, 0x00], {
				"content-type": "audio/mpeg",
			}),
		);

		await downloadEpisodeWithNotice(episodeA, template);
		await expect(downloadEpisodeWithNotice(episodeB, template)).rejects.toThrow(
			"A different episode already occupies the selected destination.",
		);

		// Episode B pays one Range probe before the collision surfaces: the
		// provisional URL-extension path cannot distinguish a real collision from a
		// wrong URL extension, so the check runs on the sniffed final path.
		expect(requestUrlMock).toHaveBeenCalledTimes(2);
		expect(v.writeBinary).toHaveBeenCalledOnce();
		expect(get(downloadedEpisodes)["Podcast A"]?.[0]).toMatchObject({
			filePath: "Podcasts/shared.mp3",
			title: "Episode A",
		});
		expect(get(downloadedEpisodes)["Podcast B"]).toBeUndefined();

		// The registered owner still reuses the fast path with no network traffic.
		await downloadEpisodeWithNotice(episodeA, template);
		expect(requestUrlMock).toHaveBeenCalledTimes(2);
		expect(get(downloadedEpisodes)["Podcast A"]).toHaveLength(1);
	});

	it("holds one normalized destination in flight and releases it after failure", async () => {
		setupVault();
		const response = deferred<Awaited<ReturnType<typeof requestUrl>>>();
		const template = "Podcasts/shared";
		const episodeA = makeEpisode({ title: "Episode A", podcastName: "Podcast A" });
		const episodeB = makeEpisode({ title: "Episode B", podcastName: "Podcast B" });
		requestUrlMock.mockImplementationOnce(
			() => response.promise as unknown as ReturnType<typeof requestUrl>,
		);

		const first = downloadEpisodeWithNotice(episodeA, template);
		await vi.waitFor(() => expect(requestUrlMock).toHaveBeenCalledOnce());

		await expect(downloadEpisodeWithNotice(episodeB, template)).rejects.toThrow(
			"A download is already in progress for the selected destination.",
		);
		expect(requestUrlMock).toHaveBeenCalledOnce();

		response.reject(new Error("first attempt failed"));
		await expect(first).rejects.toThrow("Network request failed.");

		requestUrlMock.mockResolvedValueOnce(
			rangeResponse(200, [0xff, 0xfb, 0x90, 0x00], {
				"content-type": "audio/mpeg",
			}),
		);
		await downloadEpisodeWithNotice(episodeB, template);
		expect(requestUrlMock).toHaveBeenCalledTimes(2);
		expect(get(downloadedEpisodes)["Podcast B"]?.[0]?.filePath).toBe("Podcasts/shared.mp3");
	});

	it("removes the partial file via the adapter (not yet vault-indexed) and rethrows on a mid-stream failure", async () => {
		const v = setupVault({ streaming: true });
		requestUrlMock
			.mockResolvedValueOnce(
				rangeResponse(206, [1, 2, 3, 4, 5, 6, 7, 8], {
					"content-type": "audio/mpeg",
					"content-range": "bytes 0-7/16",
				}),
			)
			.mockResolvedValueOnce(rangeResponse(500, []));

		await expect(
			downloadEpisodeWithNotice(makeEpisode(), "Podcasts/{{title}}"),
		).rejects.toThrow(/HTTP 500/);

		// The partial was written through the adapter, so it isn't in the vault
		// index — cleanup must fall back to adapter.remove (#218).
		expect(v.deleteFile).not.toHaveBeenCalled();
		expect(v.removeFile).toHaveBeenCalledTimes(1);
		expect(get(downloadedEpisodes)["Pod"]).toBeUndefined();
	});
});
