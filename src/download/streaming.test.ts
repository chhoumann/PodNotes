import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import { plugin } from "../store";
import type PodNotes from "../main";
import {
	probeAndFetchFirstChunk,
	writeStreamedFile,
	type RangeProbe,
} from "./streaming";

vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<typeof import("obsidian")>();
	return { ...actual, requestUrl: vi.fn() };
});

const requestUrlMock = vi.mocked(requestUrl);

function res(status: number, body: number[], headers: Record<string, string> = {}) {
	return {
		status,
		headers,
		arrayBuffer: new Uint8Array(body).buffer,
	} as unknown as Awaited<ReturnType<typeof requestUrl>>;
}

function setupAdapter() {
	const writes = new Map<string, number[]>();
	const writeBinary = vi.fn(async (path: string, data: ArrayBuffer) => {
		writes.set(path, [...new Uint8Array(data)]);
	});
	const appendBinary = vi.fn(async (path: string, data: ArrayBuffer) => {
		writes.set(path, [...(writes.get(path) ?? []), ...new Uint8Array(data)]);
	});
	const app = {
		vault: { adapter: { writeBinary, appendBinary } },
	};
	plugin.set({ app } as unknown as PodNotes);
	return { writes, writeBinary, appendBinary };
}

function probe(overrides: Partial<RangeProbe> = {}): RangeProbe {
	return {
		firstChunk: new Uint8Array([1, 2]).buffer,
		contentType: "audio/mpeg",
		supportsRange: true,
		totalSize: 6,
		...overrides,
	};
}

beforeEach(() => requestUrlMock.mockReset());
afterEach(() => {
	plugin.set(undefined as unknown as PodNotes);
});

describe("probeAndFetchFirstChunk", () => {
	it("parses a 206 Content-Range into supportsRange + totalSize and uses chunkSize in the Range header", async () => {
		requestUrlMock.mockResolvedValue(
			res(206, [1, 2, 3, 4], {
				"content-type": "audio/mpeg",
				"content-range": "bytes 0-3/10",
			}),
		);

		const p = await probeAndFetchFirstChunk("https://x/ep.mp3", 4);

		expect(p.supportsRange).toBe(true);
		expect(p.totalSize).toBe(10);
		expect(p.contentType).toBe("audio/mpeg");
		expect(new Uint8Array(p.firstChunk)).toHaveLength(4);
		expect(requestUrlMock.mock.calls[0][0]).toMatchObject({
			headers: { Range: "bytes=0-3" },
		});
	});

	it("leaves totalSize null for a 206 with an unknown total (/*), ignoring the partial Content-Length (#218)", async () => {
		requestUrlMock.mockResolvedValue(
			res(206, [1, 2, 3, 4], {
				"content-type": "audio/mpeg",
				"content-range": "bytes 0-3/*",
				"content-length": "4",
			}),
		);

		const p = await probeAndFetchFirstChunk("https://x/ep.mp3", 4);

		expect(p.supportsRange).toBe(true);
		// Must NOT adopt the 4-byte partial Content-Length as the total, or the
		// writer would stop after one chunk and truncate the file.
		expect(p.totalSize).toBeNull();
	});

	it("treats a 200 (ignored Range) as the whole body with supportsRange=false", async () => {
		requestUrlMock.mockResolvedValue(
			res(200, [1, 2, 3, 4, 5], {
				"content-type": "audio/mpeg",
				"content-length": "5",
			}),
		);

		const p = await probeAndFetchFirstChunk("https://x/ep.mp3", 4);

		expect(p.supportsRange).toBe(false);
		expect(p.totalSize).toBe(5);
	});

	it("throws on a non-2xx status", async () => {
		requestUrlMock.mockResolvedValue(res(404, []));
		await expect(probeAndFetchFirstChunk("https://x/ep.mp3", 4)).rejects.toThrow(
			/HTTP 404/,
		);
	});
});

describe("writeStreamedFile", () => {
	it("appends sequential range chunks to disk with a small chunk size", async () => {
		const a = setupAdapter();
		requestUrlMock
			.mockResolvedValueOnce(res(206, [3, 4], { "content-range": "bytes 2-3/6" }))
			.mockResolvedValueOnce(res(206, [5, 6], { "content-range": "bytes 4-5/6" }));

		const total = await writeStreamedFile(
			"https://x/ep.mp3",
			"out.mp3",
			probe({ totalSize: 6 }),
			undefined,
			2,
		);

		expect(total).toBe(6);
		expect(a.writeBinary).toHaveBeenCalledTimes(1);
		expect(a.appendBinary).toHaveBeenCalledTimes(2);
		expect(a.writes.get("out.mp3")).toEqual([1, 2, 3, 4, 5, 6]);
		expect(requestUrlMock.mock.calls[0][0]).toMatchObject({
			headers: { Range: "bytes=2-3" },
		});
		expect(requestUrlMock.mock.calls[1][0]).toMatchObject({
			headers: { Range: "bytes=4-5" },
		});
	});

	it("writes only the first chunk and makes no further requests when Range was ignored (200)", async () => {
		const a = setupAdapter();

		const total = await writeStreamedFile(
			"https://x/ep.mp3",
			"out.mp3",
			probe({ firstChunk: new Uint8Array([1, 2, 3]).buffer, supportsRange: false, totalSize: 3 }),
			undefined,
			2,
		);

		expect(total).toBe(3);
		expect(a.writeBinary).toHaveBeenCalledTimes(1);
		expect(a.appendBinary).not.toHaveBeenCalled();
		expect(requestUrlMock).not.toHaveBeenCalled();
	});

	it("stops on a short chunk when the total size is unknown (EOF heuristic)", async () => {
		const a = setupAdapter();
		requestUrlMock
			.mockResolvedValueOnce(res(206, [3, 4]))
			.mockResolvedValueOnce(res(206, [5]));

		const total = await writeStreamedFile(
			"https://x/ep.mp3",
			"out.mp3",
			probe({ totalSize: null }),
			undefined,
			2,
		);

		expect(total).toBe(5);
		expect(a.writes.get("out.mp3")).toEqual([1, 2, 3, 4, 5]);
	});

	it("throws on a non-206 mid-stream response", async () => {
		setupAdapter();
		requestUrlMock.mockResolvedValueOnce(res(500, []));

		await expect(
			writeStreamedFile("https://x/ep.mp3", "out.mp3", probe({ totalSize: 6 }), undefined, 2),
		).rejects.toThrow(/Range request failed/);
	});
});
