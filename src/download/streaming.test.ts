import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import { plugin } from "../store";
import type PodNotes from "../main";
import {
	isPartialPath,
	moveIntoPlace,
	partialPathFor,
	probeAndFetchFirstChunk,
	sweepStalePartials,
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

describe("partialPathFor / isPartialPath", () => {
	it("builds a dot-prefixed sibling temp in the same folder", () => {
		const tmp = partialPathFor("Podcasts/Show/Ep 1.mp3");
		// dir + ".<token>.<name>.podnotes-partial" (token first so it survives the cap)
		expect(tmp).toMatch(/^Podcasts\/Show\/\..*\.Ep 1\.mp3\.podnotes-partial$/);
		expect(isPartialPath(tmp)).toBe(true);
	});

	it("handles a vault-root (no folder) path", () => {
		const tmp = partialPathFor("Ep 1.mp3");
		expect(tmp).toMatch(/^\..*\.Ep 1\.mp3\.podnotes-partial$/);
		expect(tmp).not.toContain("/");
		expect(isPartialPath(tmp)).toBe(true);
	});

	it("is unique per call so concurrent downloads to one final path never clash", () => {
		const a = partialPathFor("Podcasts/Ep.mp3");
		const b = partialPathFor("Podcasts/Ep.mp3");
		expect(a).not.toBe(b);
	});

	it("keeps the temp name within the filesystem limit for a maxed-out title (#22)", () => {
		// The final name segment is already capped to ~255; the dot prefix + suffix
		// must not push the temp past ENAMETOOLONG on the new write path.
		const longFinal = `Podcasts/${"X".repeat(400)}.mp3`;
		const tmp = partialPathFor(longFinal);
		const lastSegment = tmp.split("/").pop() ?? "";
		expect(lastSegment.length).toBeLessThanOrEqual(255);
		expect(isPartialPath(tmp)).toBe(true);
		// The unique token (front of the name) must survive the tail truncation.
		expect(partialPathFor(longFinal)).not.toBe(tmp);
	});

	it("rejects non-partial paths", () => {
		expect(isPartialPath("Podcasts/Ep.mp3")).toBe(false);
		expect(isPartialPath("Podcasts/.Ep.mp3")).toBe(false); // dotfile, wrong suffix
		expect(isPartialPath("Podcasts/Ep.mp3.podnotes-partial")).toBe(false); // no dot prefix
	});
});

describe("moveIntoPlace", () => {
	function setupMoveAdapter(methods: {
		rename?: boolean;
		copy?: boolean;
		remove?: boolean;
	}) {
		const adapter: Record<string, unknown> = {
			writeBinary: vi.fn(),
		};
		const rename = vi.fn(async () => {});
		const copy = vi.fn(async () => {});
		const remove = vi.fn(async () => {});
		if (methods.rename) adapter.rename = rename;
		if (methods.copy) adapter.copy = copy;
		if (methods.remove) adapter.remove = remove;
		plugin.set({ app: { vault: { adapter } } } as unknown as PodNotes);
		return { rename, copy, remove };
	}

	it("prefers rename (in-place, buffers nothing) when available", async () => {
		const m = setupMoveAdapter({ rename: true, copy: true, remove: true });
		await moveIntoPlace("dir/.ep.tok.podnotes-partial", "dir/ep.mp3");
		expect(m.rename).toHaveBeenCalledWith(
			"dir/.ep.tok.podnotes-partial",
			"dir/ep.mp3",
		);
		expect(m.copy).not.toHaveBeenCalled();
	});

	it("falls back to copy + remove when rename is unavailable", async () => {
		const m = setupMoveAdapter({ copy: true, remove: true });
		await moveIntoPlace("dir/.ep.tok.podnotes-partial", "dir/ep.mp3");
		expect(m.copy).toHaveBeenCalledWith(
			"dir/.ep.tok.podnotes-partial",
			"dir/ep.mp3",
		);
		expect(m.remove).toHaveBeenCalledWith("dir/.ep.tok.podnotes-partial");
	});

	it("throws (never re-buffers the whole file) when neither rename nor copy exists", async () => {
		// Re-buffering via readBinary→writeBinary would reintroduce the #113 OOM, so
		// an adapter that can do neither must fail loudly instead.
		setupMoveAdapter({ remove: true });
		await expect(
			moveIntoPlace("dir/.ep.tok.podnotes-partial", "dir/ep.mp3"),
		).rejects.toThrow(/cannot move a completed download/i);
	});
});

describe("sweepStalePartials", () => {
	function setupSweepAdapter(files: string[]) {
		const remove = vi.fn(async () => {});
		const list = vi.fn(async () => ({ files, folders: [] as string[] }));
		plugin.set({
			app: { vault: { adapter: { writeBinary: vi.fn(), list, remove } } },
		} as unknown as PodNotes);
		return { remove, list };
	}

	it("removes orphaned partials but never an active one or a real file", async () => {
		const s = setupSweepAdapter([
			"Podcasts/.Ep.dead.podnotes-partial", // orphan -> remove
			"Podcasts/.Ep.live.podnotes-partial", // in flight -> keep
			"Podcasts/Ep.mp3", // real file -> keep
		]);

		await sweepStalePartials(
			"Podcasts",
			(p) => p === "Podcasts/.Ep.live.podnotes-partial",
		);

		expect(s.remove).toHaveBeenCalledTimes(1);
		expect(s.remove).toHaveBeenCalledWith("Podcasts/.Ep.dead.podnotes-partial");
	});

	it("is a no-op when the adapter cannot list", async () => {
		const remove = vi.fn(async () => {});
		plugin.set({
			app: { vault: { adapter: { writeBinary: vi.fn(), remove } } },
		} as unknown as PodNotes);

		await sweepStalePartials("Podcasts", () => false);

		expect(remove).not.toHaveBeenCalled();
	});

	it("never throws when listing fails (best-effort)", async () => {
		const list = vi.fn(async () => {
			throw new Error("list failed");
		});
		plugin.set({
			app: { vault: { adapter: { writeBinary: vi.fn(), list, remove: vi.fn() } } },
		} as unknown as PodNotes);

		await expect(
			sweepStalePartials("Podcasts", () => false),
		).resolves.toBeUndefined();
	});
});
