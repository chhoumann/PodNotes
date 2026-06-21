import { describe, expect, test } from "vitest";
import {
	CHUNK_SIZE_BYTES,
	createBinaryChunkFiles,
	createChunkFiles,
	getMimeType,
	shouldConvertToWav,
	writeWavHeader,
} from "./audioChunker";

describe("getMimeType", () => {
	test("returns correct mime types for audio formats", () => {
		expect(getMimeType("mp3")).toBe("audio/mp3");
		expect(getMimeType("MP3")).toBe("audio/mp3");
		expect(getMimeType("m4a")).toBe("audio/mp4");
		expect(getMimeType("ogg")).toBe("audio/ogg");
		expect(getMimeType("wav")).toBe("audio/wav");
		expect(getMimeType("flac")).toBe("audio/flac");
		expect(getMimeType("webm")).toBe("audio/webm");
		expect(getMimeType("unknown")).toBe("audio/mpeg");
	});
});

describe("shouldConvertToWav", () => {
	test("returns true for m4a files", () => {
		expect(shouldConvertToWav("m4a", "audio/mp4")).toBe(true);
		expect(shouldConvertToWav("M4A", "audio/mp4")).toBe(true);
		expect(shouldConvertToWav("mp3", "audio/mp4")).toBe(true);
		expect(shouldConvertToWav("mp3", "audio/mpeg")).toBe(false);
	});
});

describe("createBinaryChunkFiles", () => {
	test("returns single file when buffer is smaller than chunk size", () => {
		const smallBuffer = new ArrayBuffer(1024);
		const files = createBinaryChunkFiles(smallBuffer, "test", "mp3", "audio/mpeg");

		expect(files).toHaveLength(1);
		expect(files[0].name).toBe("test.mp3");
		expect(files[0].type).toBe("audio/mpeg");
		expect(files[0].size).toBe(1024);
	});

	test("returns multiple files when buffer exceeds chunk size", () => {
		const largeBuffer = new ArrayBuffer(CHUNK_SIZE_BYTES * 2 + 1024);
		const files = createBinaryChunkFiles(largeBuffer, "test", "mp3", "audio/mpeg");

		expect(files).toHaveLength(3);
		expect(files[0].name).toBe("test.part0.mp3");
		expect(files[1].name).toBe("test.part1.mp3");
		expect(files[2].name).toBe("test.part2.mp3");
	});
});

describe("writeWavHeader", () => {
	const WAV_HEADER_SIZE = 44;

	test("writes correct RIFF header", () => {
		const buffer = new ArrayBuffer(WAV_HEADER_SIZE);
		const view = new DataView(buffer);

		writeWavHeader(view, 44100, 2, 44100);

		const riff = String.fromCharCode(
			view.getUint8(0),
			view.getUint8(1),
			view.getUint8(2),
			view.getUint8(3),
		);
		expect(riff).toBe("RIFF");

		const wave = String.fromCharCode(
			view.getUint8(8),
			view.getUint8(9),
			view.getUint8(10),
			view.getUint8(11),
		);
		expect(wave).toBe("WAVE");

		const fmt = String.fromCharCode(
			view.getUint8(12),
			view.getUint8(13),
			view.getUint8(14),
			view.getUint8(15),
		);
		expect(fmt).toBe("fmt ");

		const data = String.fromCharCode(
			view.getUint8(36),
			view.getUint8(37),
			view.getUint8(38),
			view.getUint8(39),
		);
		expect(data).toBe("data");
	});

	test("writes correct sample rate and channels", () => {
		const buffer = new ArrayBuffer(WAV_HEADER_SIZE);
		const view = new DataView(buffer);

		writeWavHeader(view, 44100, 2, 1000);

		expect(view.getUint16(22, true)).toBe(2);
		expect(view.getUint32(24, true)).toBe(44100);
		expect(view.getUint16(34, true)).toBe(16);
	});
});

describe("createChunkFiles small-file fast path (#168 / PR #204 review)", () => {
	test("sends a small m4a as a single original file instead of WAV-splitting it", async () => {
		// A 1 KB m4a is well under the 20 MB chunk size, so it must not be
		// converted to WAV (which would balloon it into many chunks and reset
		// diarization speaker labels). It should be one intact .m4a file.
		const files = await createChunkFiles({
			buffer: new ArrayBuffer(1024),
			basename: "episode",
			extension: "m4a",
			mimeType: "audio/mp4",
		});

		expect(files).toHaveLength(1);
		expect(files[0].name).toBe("episode.m4a");
		expect(files[0].type).toBe("audio/mp4");
		expect(files[0].name).not.toContain(".wav");
	});

	test("still sends a small mp3 as a single original file (unchanged)", async () => {
		const files = await createChunkFiles({
			buffer: new ArrayBuffer(2048),
			basename: "episode",
			extension: "mp3",
			mimeType: "audio/mpeg",
		});

		expect(files).toHaveLength(1);
		expect(files[0].name).toBe("episode.mp3");
		expect(files[0].size).toBe(2048);
	});
});
