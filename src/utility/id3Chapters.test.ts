import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchId3Chapters, parseId3Chapters } from "./id3Chapters";
import { NetworkError, TimeoutError } from "./networkRequest";

const mockRequest = vi.hoisted(() => vi.fn());

vi.mock("./networkRequest", async (importOriginal) => ({
	...(await importOriginal<typeof import("./networkRequest")>()),
	requestWithTimeout: mockRequest,
}));

type Version = 3 | 4;

const latin1 = (text: string) => [0, ...Buffer.from(`${text}\0`, "latin1")];
const utf16le = (text: string) => [1, 0xff, 0xfe, ...Buffer.from(`${text}\0`, "utf16le")];
const utf16be = (text: string) => [1, 0xfe, 0xff, ...Buffer.from(`${text}\0`, "utf16le").swap16()];
const utf8 = (text: string) => [3, ...Buffer.from(text, "utf8")];

function size(value: number, version: Version): number[] {
	return version === 4
		? [21, 14, 7, 0].map((shift) => (value >> shift) & 0x7f)
		: [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff);
}

function frame(id: string, body: number[], version: Version, formatFlags = 0): number[] {
	return [...Buffer.from(id, "latin1"), ...size(body.length, version), 0, formatFlags, ...body];
}

function chap(id: string, startMs: number, subframes: number[], version: Version = 3): number[] {
	const times = [startMs, startMs + 1000, 0xffffffff, 0xffffffff].flatMap((value) =>
		size(value, 3),
	);
	return frame("CHAP", [...Buffer.from(`${id}\0`, "latin1"), ...times, ...subframes], version);
}

function tag(frames: number[], { version = 3 as Version, flags = 0, padding = 32 } = {}) {
	const body = [...frames, ...Array.from({ length: padding }, () => 0)];
	return Uint8Array.from([
		...Buffer.from("ID3"),
		version,
		0,
		flags,
		...size(body.length, 4),
		...body,
	]);
}

describe("parseId3Chapters", () => {
	it("reads each CHAP's start and title in start order, past the CTOC and chapter art", () => {
		const v = 3;
		const chapters = parseId3Chapters(
			tag([
				...frame("TIT2", latin1("Efer 756"), v),
				...frame("CTOC", [...Buffer.from("TOC\0"), 3, 2, ...Buffer.from("b\0a\0")], v),
				...chap("b", 838_381, [
					...frame("TIT2", latin1("Betty León [Voces de Ciencia]"), v),
					...frame(
						"APIC",
						Array.from({ length: 500 }, () => 0xff),
						v,
					),
				]),
				...chap("a", 152_006, [
					...frame(
						"APIC",
						Array.from({ length: 500 }, () => 0xff),
						v,
					),
					...frame("TIT2", latin1("Coidar a pel en verán"), v),
				]),
			]),
		);

		expect(chapters).toEqual([
			{ startTime: 152.006, title: "Coidar a pel en verán" },
			{ startTime: 838.381, title: "Betty León [Voces de Ciencia]" },
		]);
	});

	it("decodes UTF-16 with either byte order, and v2.4 UTF-8 with synchsafe sizes", () => {
		expect(
			parseId3Chapters(
				tag([
					...chap("chp0", 0, frame("TIT2", utf16le("🍕 Pizza"), 3)),
					...chap("chp1", 60_000, frame("TIT2", utf16be("Follow-up"), 3)),
				]),
			),
		).toEqual([
			{ startTime: 0, title: "🍕 Pizza" },
			{ startTime: 60, title: "Follow-up" },
		]);

		const long = "Ünïcode ".repeat(20).trim();
		expect(
			parseId3Chapters(
				tag(chap("c", 5_000, frame("TIT2", utf8(long), 4), 4), { version: 4 }),
			),
		).toEqual([{ startTime: 5, title: long }]);
	});

	it("keeps an untitled chapter and leaves transformed frames unread", () => {
		const v = 3;
		expect(
			parseId3Chapters(
				tag([
					...chap("a", 0, []),
					...chap("b", 30_000, frame("TIT2", latin1("Compressed"), v, 0x80)),
					...frame("CHAP", [...Buffer.from("c\0"), 0, 0], v, 0x40),
				]),
			),
		).toEqual([
			{ startTime: 0, title: "" },
			{ startTime: 30, title: "" },
		]);
	});

	it("skips an extended header", () => {
		const extended = [0, 0, 0, 6, 0, 0, 0, 0, 0, 0];
		const chapter = chap("a", 1_000, frame("TIT2", latin1("After"), 3));

		expect(parseId3Chapters(tag([...extended, ...chapter], { flags: 0x40 }))).toEqual([
			{ startTime: 1, title: "After" },
		]);
	});

	it("reads nothing from an unsynchronised, truncated, or missing tag", () => {
		const chapter = chap("a", 0, frame("TIT2", latin1("Intro"), 3));

		expect(parseId3Chapters(tag(chapter, { flags: 0x80 }))).toEqual([]);
		expect(parseId3Chapters(tag(chapter).subarray(0, 30))).toEqual([]);
		expect(parseId3Chapters(Uint8Array.from(Buffer.from("RIFF....WAVEfmt ")))).toEqual([]);
	});
});

describe("fetchId3Chapters", () => {
	const url = "https://pod.test/episode.mp3";
	const ranged = (bytes: Uint8Array) => ({
		status: 206,
		headers: {},
		arrayBuffer: bytes.slice().buffer,
	});

	beforeEach(() => mockRequest.mockReset());

	it("reads a small tag with one Range request", async () => {
		const small = tag(chap("a", 0, frame("TIT2", latin1("Intro"), 3)));
		mockRequest.mockResolvedValueOnce(ranged(small));

		await expect(fetchId3Chapters(url)).resolves.toEqual([{ startTime: 0, title: "Intro" }]);
		expect(mockRequest).toHaveBeenCalledExactlyOnceWith(url, {
			headers: { Range: "bytes=0-65535" },
			timeoutMs: 30_000,
			maxResponseBytes: 65_536,
			acceptedStatuses: [206],
		});
	});

	it("asks for the rest of a larger tag and nothing past it", async () => {
		const art = frame(
			"APIC",
			Array.from({ length: 100_000 }, () => 0xff),
			3,
		);
		const large = tag([...art, ...chap("a", 90_000, frame("TIT2", latin1("Late"), 3))]);
		mockRequest
			.mockResolvedValueOnce(ranged(large.subarray(0, 65_536)))
			.mockResolvedValueOnce(ranged(large.subarray(65_536)));

		await expect(fetchId3Chapters(url)).resolves.toEqual([{ startTime: 90, title: "Late" }]);
		expect(mockRequest.mock.calls[1][1]).toMatchObject({
			headers: { Range: `bytes=65536-${large.length - 1}` },
			maxResponseBytes: large.length - 65_536,
		});
	});

	it("does not fetch a tag over 16 MB", async () => {
		const header = Uint8Array.from([...Buffer.from("ID3"), 4, 0, 0, 0x08, 0, 0, 0]);
		const first = new Uint8Array(65_536);
		first.set(header);
		mockRequest.mockResolvedValueOnce(ranged(first));

		await expect(fetchId3Chapters(url)).resolves.toEqual([]);
		expect(mockRequest).toHaveBeenCalledOnce();
	});

	it("tries again after a network failure, but not after a server that ignores Range", async () => {
		mockRequest.mockRejectedValueOnce(new TimeoutError());
		await expect(fetchId3Chapters(url)).resolves.toBeUndefined();

		mockRequest.mockRejectedValueOnce(new NetworkError("unexpected-status", 200));
		await expect(fetchId3Chapters(url)).resolves.toEqual([]);
	});
});
