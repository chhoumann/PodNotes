// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { MP3_STREAMS, mp3Bytes, mp3Seconds } from "../../../tests/mocks/mp3";
import { type PartCaps, splitAudio } from "./split";

const MIB = 1024 * 1024;

const split = async (bytes: Uint8Array, caps: PartCaps, extension = "mp3") =>
	Promise.all(
		(await splitAudio({ buffer: bytes.buffer as ArrayBuffer, extension }, caps)).map(
			async ({ file, start }) => ({
				name: file.name,
				type: file.type,
				start,
				bytes: new Uint8Array(await file.arrayBuffer()),
			}),
		),
	);
const joinsInto = (parts: { bytes: Uint8Array }[], episode: Uint8Array) =>
	Buffer.concat(parts.map((part) => part.bytes)).equals(episode);

describe("audio within the caps", () => {
	test.each([
		["mp3", "audio/mp3"],
		["MP3", "audio/mp3"],
		["m4a", "audio/mp4"],
		["ogg", "audio/ogg"],
		["wav", "audio/wav"],
		["flac", "audio/flac"],
		["webm", "audio/webm"],
		["opus", "audio/mpeg"],
	])("a .%s file goes whole as %s, named for its format only", async (extension, type) => {
		const episode = new Uint8Array(4096).fill(7);

		const parts = await split(episode, { maxBytes: 20 * MIB }, extension);

		expect(parts).toEqual([{ name: `audio.${extension}`, type, start: 0, bytes: episode }]);
	});

	test("an MP3 that fits both caps goes whole", async () => {
		const episode = mp3Bytes(MP3_STREAMS.mpeg1At96Kbps, 58_000);

		const parts = await split(episode, { maxBytes: 20 * MIB, maxSeconds: 1400 });

		expect(parts.map((part) => part.name)).toEqual(["audio.mp3"]);
		expect(joinsInto(parts, episode)).toBe(true);
	});
});

describe("an MP3 over a cap", () => {
	test("under the size cap is cut into equal parts no longer than maxSeconds, each starting where the last ended", async () => {
		const stream = MP3_STREAMS.mpeg1At96Kbps;
		const episode = mp3Bytes(stream, 134_000);

		const parts = await split(episode, { maxBytes: 20 * MIB, maxSeconds: 1400 });

		expect(parts.map((part) => part.name)).toEqual([
			"audio.part0.mp3",
			"audio.part1.mp3",
			"audio.part2.mp3",
		]);
		expect(parts.map((part) => part.bytes.length / stream.frameBytes)).toEqual([
			44_667, 44_667, 44_666,
		]);
		expect(mp3Seconds(stream, parts[0].bytes.length)).toBeLessThanOrEqual(1400);
		expect(parts[0].start).toBe(0);
		expect(parts[1].start).toBeCloseTo(44_667 * stream.frameSeconds, 6);
		expect(parts[2].start).toBeCloseTo(89_334 * stream.frameSeconds, 6);
		for (const part of parts) {
			expect(part.type).toBe("audio/mp3");
			expect(Array.from(part.bytes.subarray(0, 4))).toEqual(stream.header);
		}
		expect(joinsInto(parts, episode)).toBe(true);
	});

	test("over the size cap is cut at frame starts into parts under it", async () => {
		const stream = MP3_STREAMS.mpeg1At320Kbps;
		const episode = mp3Bytes(stream, 50_000);

		const parts = await split(episode, { maxBytes: 20 * MIB });

		expect(parts).toHaveLength(3);
		let frames = 0;
		for (const part of parts) {
			expect(part.bytes.length).toBeLessThanOrEqual(20 * MIB);
			expect(Array.from(part.bytes.subarray(0, 4))).toEqual(stream.header);
			expect(part.start).toBeCloseTo(frames * stream.frameSeconds, 6);
			frames += part.bytes.length / stream.frameBytes;
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

		const parts = await split(episode, { maxBytes: 20 * MIB, maxSeconds: 1400 });

		expect(parts.map((part) => part.bytes.length)).toEqual([
			tag.length + 18_000 * stream.frameBytes,
			18_000 * stream.frameBytes,
		]);
		expect(Array.from(parts[0].bytes.subarray(0, 3))).toEqual([0x49, 0x44, 0x33]);
		expect(parts[1].start).toBeCloseTo(18_000 * stream.frameSeconds, 6);
		expect(joinsInto(parts, episode)).toBe(true);
	});

	test("an MP3 a frame over a whole number of capped parts is cut into equal parts, not a one-frame tail", async () => {
		const stream = MP3_STREAMS.mpeg25At8Kbps;
		// 1,400 s holds 19,444 frames of 72 ms, so 58,333 frames need 4 parts.
		const episode = mp3Bytes(stream, 58_333);

		const parts = await split(episode, { maxBytes: 20 * MIB, maxSeconds: 1400 });

		expect(parts.map((part) => part.bytes.length / stream.frameBytes)).toEqual([
			14_584, 14_583, 14_583, 14_583,
		]);
		expect(joinsInto(parts, episode)).toBe(true);
	});

	test("an MP3 whose equal split misses the size cap by its odd frame still goes in two parts", async () => {
		const stream = MP3_STREAMS.mpeg1At320Kbps;
		// 512 bytes of tag and 43,689 frames: 21,845 + 21,844 puts the first part 192 bytes
		// over 20 MiB, but 21,844 + 21,845 fits.
		const tag = new Uint8Array(512);
		tag.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0x03, 0x76]);
		const episode = Buffer.concat([tag, mp3Bytes(stream, 43_689)]);

		const parts = await split(episode, { maxBytes: 20 * MIB, maxSeconds: 1400 });

		expect(
			parts.map(
				(part, index) => (part.bytes.length - (index === 0 ? 512 : 0)) / stream.frameBytes,
			),
		).toEqual([21_844, 21_845]);
		for (const part of parts) expect(part.bytes.length).toBeLessThanOrEqual(20 * MIB);
		expect(joinsInto(parts, episode)).toBe(true);
	});

	test("an MP3 that a leading tag pushes over the size cap splits into equal parts, with no one-frame tail", async () => {
		const stream = MP3_STREAMS.mpeg1At320Kbps;
		// 512 bytes of tag and 43,690 frames of 960 bytes come to 41,942,912 bytes, just under
		// twice 20 MiB, but an equal split into two puts the tag's 512 bytes over the cap.
		const tag = new Uint8Array(512);
		tag.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0x03, 0x76]);
		const episode = Buffer.concat([tag, mp3Bytes(stream, 43_690)]);

		const parts = await split(episode, { maxBytes: 20 * MIB, maxSeconds: 1400 });

		expect(
			parts.map(
				(part, index) => (part.bytes.length - (index === 0 ? 512 : 0)) / stream.frameBytes,
			),
		).toEqual([14_564, 14_563, 14_563]);
		for (const part of parts) expect(part.bytes.length).toBeLessThanOrEqual(20 * MIB);
		expect(joinsInto(parts, episode)).toBe(true);
	});

	test("an MP3 whose bitrate rises moves the cut forward rather than adding a part", async () => {
		const low = MP3_STREAMS.mpeg1At96Kbps;
		const high = MP3_STREAMS.mpeg1At320Kbps;
		// 21,847 low-bitrate frames, then 21,845 high-bitrate frames and an ID3v1 tag. An even
		// cut leaves 288 + 20,971,200 + 128 bytes after it, over 20 MiB; one frame later fits.
		const tag = new Uint8Array(128);
		tag.set([0x54, 0x41, 0x47]);
		const episode = Buffer.concat([mp3Bytes(low, 21_847), mp3Bytes(high, 21_845), tag]);

		const parts = await split(episode, { maxBytes: 20 * MIB, maxSeconds: 1400 });

		expect(parts.map((part) => part.bytes.length)).toEqual([
			21_847 * low.frameBytes,
			21_845 * high.frameBytes + tag.length,
		]);
		expect(joinsInto(parts, episode)).toBe(true);
	});

	test("cuts every MP3 into the fewest parts that fit both caps", async () => {
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
			const tail = new Uint8Array(random() < 0.5 ? 128 : 0);
			if (tail.length) tail.set([0x54, 0x41, 0x47]);
			const bytes = new Uint8Array(
				Buffer.concat([
					new Uint8Array(lead),
					...frames.map((kind) => mp3Bytes(kind, 1)),
					tail,
				]),
			);
			const maxBytes = 2_000 + Math.floor(random() * 20_000);
			const maxSeconds = (3 + Math.floor(random() * 40)) * 0.024;

			// Brute force: the fewest parts, where a part is a run of frames within both caps.
			const offsets = [lead];
			const elapsed = [0];
			for (const kind of frames) {
				offsets.push(offsets[offsets.length - 1] + kind.frameBytes);
				elapsed.push(elapsed[elapsed.length - 1] + kind.frameSeconds);
			}
			const startOf = (index: number) => (index === 0 ? 0 : offsets[index]);
			const endOf = (index: number) =>
				index === frames.length ? bytes.length : offsets[index];
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

			const parts = await split(bytes, { maxBytes, maxSeconds });

			const context = `trial ${trial}`;
			expect(parts.length, context).toBe(fewest[frames.length]);
			let begin = 0;
			for (const part of parts) {
				const end = begin + part.bytes.length;
				const first = begin === 0 ? 0 : offsets.indexOf(begin);
				const last = end === bytes.length ? frames.length : offsets.indexOf(end);
				expect(last, context).toBeGreaterThan(first);
				expect(fits(first, last), context).toBe(true);
				expect(part.start, context).toBeCloseTo(elapsed[first], 6);
				begin = end;
			}
			expect(joinsInto(parts, bytes), context).toBe(true);
		}
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

		const parts = await split(episode, { maxBytes: 20 * MIB, maxSeconds: 600 });

		const seconds = parts.map(
			(part, index) =>
				((part.bytes.length - (index === 0 ? tag.length : 0)) / stream.frameBytes) *
				stream.frameSeconds,
		);
		expect(seconds).toHaveLength(3);
		for (const part of seconds) expect(part).toBeLessThanOrEqual(600);
		expect(joinsInto(parts, episode)).toBe(true);
	});

	test("an MP3 one frame short of two full parts splits into two, with no one-frame tail", async () => {
		const stream = MP3_STREAMS.mpeg1At96Kbps;
		// 600 s holds 25,000 frames of 24 ms. Summing 0.024 s 25,000 times overshoots 600.
		const episode = mp3Bytes(stream, 49_999);

		const parts = await split(episode, { maxBytes: 20 * MIB, maxSeconds: 600 });

		expect(parts.map((part) => part.bytes.length / stream.frameBytes)).toEqual([
			25_000, 24_999,
		]);
		expect(joinsInto(parts, episode)).toBe(true);
	});

	test("counts the last frame before trailing metadata, so the last part stays under maxSeconds", async () => {
		const stream = MP3_STREAMS.mpeg25At8Kbps;
		// An ID3v1 tag after the last frame. A 72.01 s part holds 1,000 frames, so 2,001 need three parts.
		const tag = new Uint8Array(128);
		tag.set([0x54, 0x41, 0x47]);
		const episode = Buffer.concat([mp3Bytes(stream, 2001), tag]);

		const parts = await split(episode, { maxBytes: 20 * MIB, maxSeconds: 72.01 });

		const frames = parts.map(
			(part, index) =>
				(part.bytes.length - (index === parts.length - 1 ? tag.length : 0)) /
				stream.frameBytes,
		);
		expect(frames).toEqual([667, 667, 667]);
		expect(joinsInto(parts, episode)).toBe(true);
	});
});

describe("audio over the size cap that cannot be cut where it is", () => {
	const SAMPLE_RATE = 44_100;

	// jsdom has no Web Audio, so a decoder that returns silence of the given length stands in.
	class FakeAudioBuffer {
		numberOfChannels = 1;
		sampleRate = SAMPLE_RATE;
		private channel: Float32Array;
		constructor(readonly length: number) {
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

	test.each(["ogg", "mp3"])(
		"a .%s file without MP3 frames is decoded into WAV parts under the cap, each with its start time",
		async (extension) => {
			const samples = 100_000;
			stubAudioContext(() => new FakeAudioBuffer(samples));
			const maxBytes = 64 * 1024;
			const samplesPerPart = (maxBytes - 44) / 2;

			const parts = await split(new Uint8Array(maxBytes + 1), { maxBytes }, extension);

			expect(parts.map((part) => part.name)).toEqual([
				"audio.part0.wav",
				"audio.part1.wav",
				"audio.part2.wav",
				"audio.part3.wav",
			]);
			expect(parts.map((part) => part.start)).toEqual(
				[0, 1, 2, 3].map((index) => (index * samplesPerPart) / SAMPLE_RATE),
			);
			for (const part of parts) {
				expect(part.type).toBe("audio/wav");
				expect(part.bytes.length).toBeLessThanOrEqual(maxBytes);
				const view = new DataView(part.bytes.buffer);
				expect(new TextDecoder().decode(part.bytes.subarray(0, 4))).toBe("RIFF");
				expect(new TextDecoder().decode(part.bytes.subarray(8, 12))).toBe("WAVE");
				expect(view.getUint16(22, true)).toBe(1);
				expect(view.getUint32(24, true)).toBe(SAMPLE_RATE);
				expect(view.getUint16(34, true)).toBe(16);
				expect(view.getUint32(40, true)).toBe(part.bytes.length - 44);
			}
			expect(parts.reduce((total, part) => total + (part.bytes.length - 44) / 2, 0)).toBe(
				samples,
			);
		},
	);

	test("throws when no decoder is available", async () => {
		await expect(split(new Uint8Array(1025), { maxBytes: 1024 }, "flac")).rejects.toThrow(
			/Could not split flac audio/,
		);
	});

	test("throws when the decoder cannot decode it", async () => {
		stubAudioContext(() => {
			throw new Error("Unsupported codec");
		});
		const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

		await expect(split(new Uint8Array(1025), { maxBytes: 1024 }, "webm")).rejects.toThrow(
			/Could not split webm audio/,
		);
		consoleWarn.mockRestore();
	});
});
