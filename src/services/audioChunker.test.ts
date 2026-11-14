// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	CHUNK_SIZE_BYTES,
	createBinaryChunkFiles,
	createChunkFiles,
	mp3ChunkEnds,
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

	test("an MP3 that a leading tag pushes over the size limit splits into equal chunks, with no one-frame tail", async () => {
		const stream = MP3_STREAMS.mpeg1At320Kbps;
		// 512 bytes of tag and 43,690 frames of 960 bytes come to 41,942,912 bytes, just under
		// twice 20 MiB, but an equal split into two puts the tag's 512 bytes over the limit.
		const tag = new Uint8Array(512);
		tag.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0x03, 0x76]);
		const episode = Buffer.concat([tag, mp3Bytes(stream, 43_690)]);

		const parts = await chunk(episode, 1400);

		expect(
			parts.map(
				(part, index) => (part.bytes.length - (index === 0 ? 512 : 0)) / stream.frameBytes,
			),
		).toEqual([14_564, 14_563, 14_563]);
		for (const part of parts) expect(part.bytes.length).toBeLessThanOrEqual(CHUNK_SIZE_BYTES);
		expect(joinsInto(parts, episode)).toBe(true);
	});

	test("an MP3 whose equal split misses the size limit by its odd frame still goes in two chunks", async () => {
		const stream = MP3_STREAMS.mpeg1At320Kbps;
		// 512 bytes of tag and 43,689 frames: 21,845 + 21,844 puts the first chunk 192 bytes
		// over 20 MiB, but 21,844 + 21,845 fits.
		const tag = new Uint8Array(512);
		tag.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0x03, 0x76]);
		const episode = Buffer.concat([tag, mp3Bytes(stream, 43_689)]);

		const parts = await chunk(episode, 1400);

		expect(
			parts.map(
				(part, index) => (part.bytes.length - (index === 0 ? 512 : 0)) / stream.frameBytes,
			),
		).toEqual([21_844, 21_845]);
		for (const part of parts) expect(part.bytes.length).toBeLessThanOrEqual(CHUNK_SIZE_BYTES);
		expect(joinsInto(parts, episode)).toBe(true);
	});

	test("counts the last frame before a trailing tag, so the last chunk stays under maxSeconds", async () => {
		const stream = MP3_STREAMS.mpeg1At96Kbps;
		// 600 s holds 25,000 frames of 24 ms, so 25,001 and an ID3v1 tag need two chunks.
		const tag = new Uint8Array(128);
		tag.set([0x54, 0x41, 0x47]);
		const episode = Buffer.concat([mp3Bytes(stream, 25_001), tag]);

		const parts = await chunk(episode, 600);

		expect(
			parts.map(
				(part, index) =>
					(part.bytes.length - (index === parts.length - 1 ? tag.length : 0)) /
					stream.frameBytes,
			),
		).toEqual([12_501, 12_500]);
		expect(joinsInto(parts, episode)).toBe(true);
	});

	test("audio inside a leading tag's declared size is not cut or counted", async () => {
		const stream = MP3_STREAMS.mpeg1At96Kbps;
		// An ID3v2.4 tag whose 5,760,000-byte private payload is 480 s of MP3 frames, before
		// 720 s of real audio: two requests of 360 s.
		const payload = mp3Bytes(stream, 20_000);
		const header = [0x49, 0x44, 0x33, 4, 0, 0];
		for (const shift of [21, 14, 7, 0]) header.push((payload.length >> shift) & 0x7f);
		const tag = Buffer.concat([new Uint8Array(header), payload]);
		const episode = Buffer.concat([tag, mp3Bytes(stream, 30_000)]);

		const parts = await chunk(episode, 600);

		expect(parts.map((part) => part.bytes.length)).toEqual([
			tag.length + 15_000 * stream.frameBytes,
			15_000 * stream.frameBytes,
		]);
	});

	test("an MP3 that fills the time limit exactly goes whole despite frame-like bytes in its tag", async () => {
		const stream = MP3_STREAMS.mpeg1At96Kbps;
		const tag = new Uint8Array(8192);
		tag.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0x3f, 0x76]);
		tag.set(stream.header, 100);
		tag.set(stream.header, 388);
		const episode = Buffer.concat([tag, mp3Bytes(stream, 25_000)]);

		const parts = await chunk(episode, 600);

		expect(parts.map((part) => part.bytes.length)).toEqual([episode.length]);
	});

	test("an MP3 that fills the time limit exactly goes whole despite frame-like bytes in a trailing tag", async () => {
		const stream = MP3_STREAMS.mpeg1At96Kbps;
		// An ID3v2.4 tag with a footer after the last frame.
		const tag = new Uint8Array(8202);
		tag.set([0x49, 0x44, 0x33, 4, 0, 0x10, 0, 0, 0x3f, 0x76]);
		tag.set(stream.header, 100);
		tag.set(stream.header, 388);
		tag.set([0x33, 0x44, 0x49, 4, 0, 0x10, 0, 0, 0x3f, 0x76], 8192);
		const episode = Buffer.concat([mp3Bytes(stream, 25_000), tag]);

		const parts = await chunk(episode, 600);

		expect(parts.map((part) => part.bytes.length)).toEqual([episode.length]);
	});

	test("tag-like bytes where no frame could start do not hide the audio after them", async () => {
		const stream = MP3_STREAMS.mpeg1At96Kbps;
		// 64 bytes of junk holding "ID3" and a size of 32 MiB, before 720 s of audio.
		const junk = new Uint8Array(64);
		junk.set([0x49, 0x44, 0x33, 4, 0, 0, 0x10, 0, 0, 0], 20);
		const episode = Buffer.concat([junk, mp3Bytes(stream, 30_000)]);

		const parts = await chunk(episode, 600);

		expect(parts.map((part) => part.bytes.length)).toEqual([
			junk.length + 15_000 * stream.frameBytes,
			15_000 * stream.frameBytes,
		]);
	});

	test("frame-like bytes in a leading tag do not set the duration of every frame", async () => {
		const stream = MP3_STREAMS.mpeg25At8Kbps;
		const fake = MP3_STREAMS.mpeg1At96Kbps;
		// An ID3v2.4 tag holding two MPEG-1 headers 288 bytes apart, which pass for two 24 ms
		// frames, before 24,001 real 72 ms frames: 1,728 s of audio.
		const tag = new Uint8Array(8192);
		tag.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0x3f, 0x76]);
		tag.set(fake.header, 100);
		tag.set(fake.header, 388);
		const episode = Buffer.concat([tag, mp3Bytes(stream, 24_001)]);

		const parts = await chunk(episode, 600);

		const seconds = parts.map(
			(part, index) =>
				((part.bytes.length - (index === 0 ? tag.length : 0)) / stream.frameBytes) *
				stream.frameSeconds,
		);
		expect(seconds).toHaveLength(3);
		for (const part of seconds) expect(part).toBeLessThanOrEqual(600);
		expect(joinsInto(parts, episode)).toBe(true);
	});

	test("an MP3 whose bitrate rises moves the cut forward rather than adding a chunk", async () => {
		const low = MP3_STREAMS.mpeg1At96Kbps;
		const high = MP3_STREAMS.mpeg1At320Kbps;
		// 21,847 low-bitrate frames, then 21,845 high-bitrate frames and an ID3v1 tag. An even
		// cut leaves 288 + 20,971,200 + 128 bytes after it, over 20 MiB; one frame later fits.
		const tag = new Uint8Array(128);
		tag.set([0x54, 0x41, 0x47]);
		const episode = Buffer.concat([mp3Bytes(low, 21_847), mp3Bytes(high, 21_845), tag]);

		const parts = await chunk(episode, 1400);

		expect(parts.map((part) => part.bytes.length)).toEqual([
			21_847 * low.frameBytes,
			21_845 * high.frameBytes + tag.length,
		]);
		for (const part of parts) expect(part.bytes.length).toBeLessThanOrEqual(CHUNK_SIZE_BYTES);
		expect(joinsInto(parts, episode)).toBe(true);
	});

	test("cuts every MP3 into the fewest chunks that fit both limits", () => {
		// A seeded generator, so a failure names a reproducible case.
		let seed = 532;
		const random = () => {
			seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
			return seed / 2_147_483_648;
		};
		const kinds = [
			MP3_STREAMS.mpeg1At96Kbps,
			MP3_STREAMS.mpeg1At320Kbps,
			MP3_STREAMS.mpeg25At8Kbps,
		];
		for (let trial = 0; trial < 300; trial++) {
			const frames: (typeof kinds)[number][] = [];
			while (frames.length < 20 + Math.floor(random() * 100)) {
				const kind = kinds[Math.floor(random() * kinds.length)];
				for (let run = 1 + Math.floor(random() * 12); run > 0; run--) frames.push(kind);
			}
			const lead = random() < 0.5 ? 512 : 0;
			const trail = random() < 0.5 ? 128 : 0;
			const tail = new Uint8Array(trail);
			if (trail) tail.set([0x54, 0x41, 0x47]);
			const bytes = new Uint8Array(
				Buffer.concat([
					new Uint8Array(lead),
					...frames.map((kind) => mp3Bytes(kind, 1)),
					tail,
				]),
			);
			const maxBytes = 2_000 + Math.floor(random() * 20_000);
			const maxSeconds = (3 + Math.floor(random() * 40)) * 0.024;

			// Brute force: the fewest chunks, where a chunk is a run of frames within both limits.
			const starts = [lead];
			const elapsed = [0];
			for (const kind of frames) {
				starts.push(starts[starts.length - 1] + kind.frameBytes);
				elapsed.push(elapsed[elapsed.length - 1] + kind.frameSeconds);
			}
			const startOf = (index: number) => (index === 0 ? 0 : starts[index]);
			const endOf = (index: number) =>
				index === frames.length ? bytes.length : starts[index];
			const fits = (first: number, end: number) =>
				endOf(end) - startOf(first) <= maxBytes &&
				elapsed[end] - elapsed[first] <= maxSeconds + 1e-6;
			const fewest: number[] = [0];
			for (let end = 1; end <= frames.length; end++) {
				fewest[end] = Infinity;
				for (let first = 0; first < end; first++) {
					if (fits(first, end)) fewest[end] = Math.min(fewest[end], fewest[first] + 1);
				}
			}
			if (fewest[frames.length] === Infinity) continue;

			const ends = mp3ChunkEnds(bytes, maxBytes, maxSeconds);
			const context = `trial ${trial}`;
			expect(ends.length, context).toBe(fewest[frames.length]);
			ends.forEach((end, index) => {
				const first = index === 0 ? 0 : starts.indexOf(ends[index - 1]);
				const last = end === bytes.length ? frames.length : starts.indexOf(end);
				expect(last, context).toBeGreaterThan(first);
				expect(fits(first, last), context).toBe(true);
			});
			expect(ends[ends.length - 1], context).toBe(bytes.length);
		}
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
