import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { requestUrl, TFile } from "obsidian";
import {
	detectAudioFileExtension,
	downloadEpisode,
} from "./downloadEpisode";
import { downloadedEpisodes } from "./store";
import type { Episode } from "./types/Episode";

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
