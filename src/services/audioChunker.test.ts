// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	CHUNK_SIZE_BYTES,
	createBinaryChunkFiles,
	createChunkFiles,
	getMimeType,
	shouldConvertToWav,
	writeWavHeader,
} from "./audioChunker";
import { MP3_STREAMS, mp3Bytes, mp3Seconds } from "../../tests/mocks/mp3";

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
	test("only frame-synced mp3 is byte-splittable; everything else needs WAV", () => {
		// MP3 resyncs at the next frame header, so it can be sliced raw.
		expect(shouldConvertToWav("mp3", "audio/mp3")).toBe(false);
		expect(shouldConvertToWav("MP3", "audio/mp3")).toBe(false);
		// An mp3 extension wins even if the mime is mislabeled.
		expect(shouldConvertToWav("mp3", "audio/mp4")).toBe(false);

		// Container/header-dependent formats can't be byte-split standalone.
		expect(shouldConvertToWav("m4a", "audio/mp4")).toBe(true);
		expect(shouldConvertToWav("M4A", "audio/mp4")).toBe(true);
		expect(shouldConvertToWav("ogg", "audio/ogg")).toBe(true);
		expect(shouldConvertToWav("webm", "audio/webm")).toBe(true);
		expect(shouldConvertToWav("flac", "audio/flac")).toBe(true);
		expect(shouldConvertToWav("wav", "audio/wav")).toBe(true);

		// Unknown formats default to the safe WAV path; the catch-all audio/mpeg
		// mime is deliberately not treated as splittable.
		expect(shouldConvertToWav("opus", "audio/mpeg")).toBe(true);
		expect(shouldConvertToWav("", "audio/mpeg")).toBe(true);
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

	test("sends a small ogg/flac as a single original file (no byte-split)", async () => {
		for (const [extension, mimeType] of [
			["ogg", "audio/ogg"],
			["flac", "audio/flac"],
		]) {
			const files = await createChunkFiles({
				buffer: new ArrayBuffer(4096),
				basename: "episode",
				extension,
				mimeType,
			});

			expect(files).toHaveLength(1);
			expect(files[0].name).toBe(`episode.${extension}`);
		}
	});
});

describe("createChunkFiles with maxSeconds (#532)", () => {
	const chunk = async (bytes: Uint8Array, maxSeconds: number) =>
		Promise.all(
			(
				await createChunkFiles({
					buffer: bytes.buffer as ArrayBuffer,
					basename: "episode",
					extension: "mp3",
					mimeType: "audio/mp3",
					maxSeconds,
				})
			).map(async (file) => ({
				name: file.name,
				bytes: new Uint8Array(await file.arrayBuffer()),
			})),
		);
	const joinsInto = (parts: { bytes: Uint8Array }[], episode: Uint8Array) =>
		Buffer.concat(parts.map((part) => part.bytes)).equals(episode);

	test("splits an MP3 under the size limit into equal parts no longer than maxSeconds", async () => {
		const stream = MP3_STREAMS.mpeg1At96Kbps;
		const episode = mp3Bytes(stream, 134_000);

		const parts = await chunk(episode, 1400);

		expect(parts.map((part) => part.name)).toEqual([
			"episode.part0.mp3",
			"episode.part1.mp3",
			"episode.part2.mp3",
		]);
		expect(parts.map((part) => part.bytes.length / stream.frameBytes)).toEqual([
			44_667, 44_667, 44_666,
		]);
		expect(mp3Seconds(stream, parts[0].bytes.length)).toBeLessThanOrEqual(1400);
		for (const part of parts)
			expect(Array.from(part.bytes.subarray(0, 4))).toEqual(stream.header);
		expect(joinsInto(parts, episode)).toBe(true);
	});

	test("sends an MP3 that fits both limits as the original file", async () => {
		const episode = mp3Bytes(MP3_STREAMS.mpeg1At96Kbps, 58_000);

		const parts = await chunk(episode, 1400);

		expect(parts.map((part) => part.name)).toEqual(["episode.mp3"]);
		expect(joinsInto(parts, episode)).toBe(true);
	});

	test("keeps parts under the size limit when it is the tighter one", async () => {
		const stream = MP3_STREAMS.mpeg1At320Kbps;
		const episode = mp3Bytes(stream, 50_000);

		const parts = await chunk(episode, 1400);

		expect(parts).toHaveLength(3);
		for (const part of parts) {
			expect(part.bytes.length).toBeLessThanOrEqual(CHUNK_SIZE_BYTES);
			expect(Array.from(part.bytes.subarray(0, 4))).toEqual(stream.header);
		}
		expect(joinsInto(parts, episode)).toBe(true);
	});

	test("keeps a leading ID3 tag in the first part without counting sync-like bytes in it as audio", async () => {
		const stream = MP3_STREAMS.mpeg25At8Kbps;
		const tag = new Uint8Array(8192);
		tag.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0x3f, 0x76]);
		for (let offset = 100; offset <= 5000; offset += 100) tag.set(stream.header, offset);
		const frames = mp3Bytes(stream, 36_000);
		const episode = Buffer.concat([tag, frames]);

		const parts = await chunk(episode, 1400);

		expect(parts.map((part) => part.bytes.length)).toEqual([
			tag.length + 18_000 * stream.frameBytes,
			18_000 * stream.frameBytes,
		]);
		expect(Array.from(parts[0].bytes.subarray(0, 3))).toEqual([0x49, 0x44, 0x33]);
		expect(joinsInto(parts, episode)).toBe(true);
	});

	test("an MP3 one frame short of two full chunks splits into two, with no one-frame tail", async () => {
		const stream = MP3_STREAMS.mpeg1At96Kbps;
		// 600 s holds 25,000 frames of 24 ms. Summing 0.024 s 25,000 times overshoots 600.
		const episode = mp3Bytes(stream, 49_999);

		const parts = await chunk(episode, 600);

		expect(parts.map((part) => part.bytes.length / stream.frameBytes)).toEqual([
			25_000, 24_999,
		]);
		expect(joinsInto(parts, episode)).toBe(true);
	});
});

describe("createChunkFiles large-file routing (other-logic-bug)", () => {
	// A minimal AudioBuffer/AudioContext so the decode+WAV path can run under
	// jsdom, which ships no Web Audio implementation. decodeAudioData returns a
	// buffer long enough to force several WAV chunks.
	class FakeAudioBuffer {
		numberOfChannels = 1;
		sampleRate = 44100;
		length: number;
		private channel: Float32Array;
		constructor(length: number) {
			this.length = length;
			this.channel = new Float32Array(length);
		}
		getChannelData(): Float32Array {
			return this.channel;
		}
	}

	function stubAudioContext(decode: (buffer: ArrayBuffer) => unknown): void {
		vi.stubGlobal(
			"AudioContext",
			class {
				async decodeAudioData(buffer: ArrayBuffer): Promise<unknown> {
					return decode(buffer);
				}
				async close(): Promise<void> {}
			},
		);
	}

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	test("byte-splits a large mp3 into raw .mp3 parts (frame-synced, splittable)", async () => {
		const buffer = new ArrayBuffer(CHUNK_SIZE_BYTES + 1024);
		const files = await createChunkFiles({
			buffer,
			basename: "episode",
			extension: "mp3",
			mimeType: "audio/mp3",
		});

		expect(files).toHaveLength(2);
		expect(files[0].name).toBe("episode.part0.mp3");
		expect(files[1].name).toBe("episode.part1.mp3");
		for (const file of files) {
			expect(file.type).toBe("audio/mp3");
			expect(file.name).not.toContain(".wav");
		}
	});

	test("decodes a large ogg to standalone WAV chunks instead of byte-splitting", async () => {
		// Without the fix this returned raw .ogg byte slices that lack stream
		// headers and can't be decoded standalone. Now it must produce .wav chunks.
		stubAudioContext((buffer) => new FakeAudioBuffer(Math.ceil(buffer.byteLength / 2)));

		const files = await createChunkFiles({
			buffer: new ArrayBuffer(CHUNK_SIZE_BYTES + 1024),
			basename: "episode",
			extension: "ogg",
			mimeType: "audio/ogg",
		});

		expect(files.length).toBeGreaterThan(1);
		for (const file of files) {
			expect(file.type).toBe("audio/wav");
			expect(file.name).toMatch(/^episode\.part\d+\.wav$/);
			expect(file.name).not.toContain(".ogg");
		}
	});

	test("throws rather than byte-splitting a large flac when no decoder is available", async () => {
		// jsdom has no AudioContext, so convertToWavChunks yields nothing. The old
		// code fell through to a corrupt raw byte-split; now it must throw.
		await expect(
			createChunkFiles({
				buffer: new ArrayBuffer(CHUNK_SIZE_BYTES + 1024),
				basename: "episode",
				extension: "flac",
				mimeType: "audio/flac",
			}),
		).rejects.toThrow(/Could not split flac audio/);
	});

	test("throws when the decoder cannot decode a large webm chunk", async () => {
		stubAudioContext(() => {
			throw new Error("Unsupported codec");
		});

		await expect(
			createChunkFiles({
				buffer: new ArrayBuffer(CHUNK_SIZE_BYTES + 1024),
				basename: "episode",
				extension: "webm",
				mimeType: "audio/webm",
			}),
		).rejects.toThrow(/Could not split webm audio/);
	});
});
