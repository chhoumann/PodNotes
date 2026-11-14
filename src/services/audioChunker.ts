/**
 * Pure audio chunking + WAV encoding for transcription uploads. Splits an episode
 * audio buffer into request-sized files, decoding and re-encoding to WAV any
 * format that can't be byte-split (everything except frame-synced MP3). Kept free
 * of any TranscriptionService/plugin state so it can be unit-tested directly — the
 * service just orchestrates it.
 */

// OpenAI's per-request limit is 25 MB; we cap at 20 MB for a safety margin.
// Buffers at or under this are sent as a single file.
export const CHUNK_SIZE_BYTES = 20 * 1024 * 1024;
const WAV_HEADER_SIZE = 44;
const PCM_BYTES_PER_SAMPLE = 2;

export function getMimeType(fileExtension: string): string {
	switch (fileExtension.toLowerCase()) {
		case "mp3":
			return "audio/mp3";
		case "m4a":
			return "audio/mp4";
		case "ogg":
			return "audio/ogg";
		case "wav":
			return "audio/wav";
		case "flac":
			return "audio/flac";
		case "webm":
			return "audio/webm";
		default:
			return "audio/mpeg";
	}
}

/**
 * Whether a buffer too large for one request must be decoded and re-encoded to
 * standalone WAV chunks instead of sliced at raw byte boundaries.
 *
 * Only MP3 tolerates raw byte-splitting: its frames are self-synchronizing, so a
 * decoder resyncs at the next frame header even when a slice starts mid-stream.
 * Every other podcast format is container/header-dependent - m4a/mp4 (ISO-BMFF),
 * Ogg, WebM/Matroska (EBML) and FLAC all carry codec setup data only at the
 * stream start, and WAV is raw PCM behind a leading 44-byte header - so a
 * non-first arbitrary byte slice lacks the headers needed to decode standalone
 * and the transcription API rejects or garbles it. Treat anything that isn't
 * unambiguously MP3 as needing the WAV path (the safe default for unknown
 * formats); `getMimeType` only emits `audio/mp3` for an mp3 extension, while the
 * catch-all `audio/mpeg` is deliberately NOT treated as splittable.
 */
export function shouldConvertToWav(extension: string, mimeType: string): boolean {
	const normalizedExtension = extension.toLowerCase();
	const isMp3 = normalizedExtension === "mp3" || mimeType.toLowerCase() === "audio/mp3";
	return !isMp3;
}

/**
 * `maxSeconds` also caps each chunk's audio length, for MP3 only. Other formats
 * over 20 MB become WAV chunks of under four minutes, and smaller ones go up whole.
 */
export async function createChunkFiles({
	buffer,
	basename,
	extension,
	mimeType,
	maxSeconds,
}: {
	buffer: ArrayBuffer;
	basename: string;
	extension: string;
	mimeType: string;
	maxSeconds?: number;
}): Promise<File[]> {
	if (maxSeconds !== undefined && !shouldConvertToWav(extension, mimeType)) {
		const ends = mp3ChunkEnds(new Uint8Array(buffer), CHUNK_SIZE_BYTES, maxSeconds);
		return sliceIntoFiles(buffer, ends, basename, extension, mimeType);
	}

	// A file that already fits in a single request needs neither conversion nor
	// splitting: send the original (compressed) bytes. OpenAI accepts m4a/mp3/etc.
	// directly under the upload limit, so this skips the m4a->WAV path below for
	// small m4a episodes — that path only exists to SAFELY SPLIT an m4a (which
	// can't be byte-split) and would otherwise balloon a small m4a into many
	// uncompressed WAV chunks, multiplying requests and, for diarization,
	// resetting speaker labels at artificial chunk boundaries (#168 / PR #204 review).
	if (buffer.byteLength <= CHUNK_SIZE_BYTES) {
		return [new File([buffer], `${basename}.${extension}`, { type: mimeType })];
	}

	// Container/header-dependent formats must be decoded and re-encoded to WAV;
	// only frame-synced MP3 falls through to raw byte-splitting.
	if (shouldConvertToWav(extension, mimeType)) {
		const wavChunks = await convertToWavChunks(buffer, basename);
		if (wavChunks.length > 0) {
			return wavChunks;
		}
		// WAV conversion produced nothing - the platform has no Web Audio decoder
		// or couldn't decode this codec. Byte-splitting the raw container here would
		// hand the API undecodable chunks (garbled or rejected output saved as a
		// transcript), so fail loudly and keep the run retryable instead.
		throw new Error(
			`Could not split ${extension || "audio"} audio for transcription. This format must be decoded to WAV before splitting, but the audio decoder is unavailable or could not decode it.`,
		);
	}

	return createBinaryChunkFiles(buffer, basename, extension, mimeType);
}

export function createBinaryChunkFiles(
	buffer: ArrayBuffer,
	basename: string,
	extension: string,
	mimeType: string,
): File[] {
	const ends: number[] = [];
	for (let end = CHUNK_SIZE_BYTES; end < buffer.byteLength; end += CHUNK_SIZE_BYTES) {
		ends.push(end);
	}
	ends.push(buffer.byteLength);
	return sliceIntoFiles(buffer, ends, basename, extension, mimeType);
}

/** One file per chunk, where `ends` holds each chunk's end offset in order. */
function sliceIntoFiles(
	buffer: ArrayBuffer,
	ends: number[],
	basename: string,
	extension: string,
	mimeType: string,
): File[] {
	if (ends.length === 1) {
		return [new File([buffer], `${basename}.${extension}`, { type: mimeType })];
	}
	return ends.map(
		(end, index) =>
			new File(
				[buffer.slice(index === 0 ? 0 : ends[index - 1], end)],
				`${basename}.part${index}.${extension}`,
				{ type: mimeType },
			),
	);
}

interface Mp3Frame {
	offset: number;
	length: number;
	seconds: number;
}

const MPEG1_LAYER3_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_LAYER3_KBPS = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
/** Indexed by the header's version bits: 0 is MPEG-2.5, 2 is MPEG-2, 3 is MPEG-1. */
const SAMPLE_RATES = [
	[11025, 12000, 8000],
	undefined,
	[22050, 24000, 16000],
	[44100, 48000, 32000],
];

/**
 * Where each chunk of an MP3 ends. Chunks end at frame starts, there are as few as
 * both limits allow, and they hold an equal number of frames, so no short last
 * chunk resets the speaker labels for a few seconds of speech.
 */
function mp3ChunkEnds(bytes: Uint8Array, maxBytes: number, maxSeconds: number): number[] {
	const frames = mp3Frames(bytes);
	if (frames.length === 0) return [bytes.length];
	// Frames in one stream last equally long, so chunks are counted in frames: summing
	// frame durations drifts past maxSeconds.
	const framesPerCap = Math.floor(maxSeconds / frames[0].seconds + 1e-9);
	const offsetOf = (first: number) => (first === 0 ? 0 : frames[first].offset);
	// The fewest chunks that fit both limits, each taking an equal share of the frames
	// still to place and stepping back a frame at a time while it is over maxBytes, so
	// chunks differ by a frame or so and none is a one-frame tail.
	for (
		let chunks = Math.max(
			Math.ceil(bytes.length / maxBytes),
			Math.ceil(frames.length / framesPerCap),
		);
		;
		chunks++
	) {
		const firsts = [0];
		for (let left = chunks - 1; left > 0; left--) {
			const first = firsts[firsts.length - 1];
			const share = Math.ceil((frames.length - first) / (left + 1));
			let next = Math.min(first + Math.min(share, framesPerCap), frames.length - left);
			while (next > first + 1 && frames[next].offset - offsetOf(first) > maxBytes) next--;
			firsts.push(next);
		}
		const last = firsts[firsts.length - 1];
		const lastFits =
			frames.length - last <= framesPerCap && bytes.length - offsetOf(last) <= maxBytes;
		if (lastFits || chunks >= frames.length) {
			return [...firsts.slice(1).map((first) => frames[first].offset), bytes.length];
		}
	}
}

/**
 * The Layer III frames in `bytes`. A frame counts when it continues the frames before it,
 * or when another frame or the end of the buffer follows it, so sync-like bytes in a tag
 * or cover art don't, and the last frame before trailing metadata does.
 */
function mp3Frames(bytes: Uint8Array): Mp3Frame[] {
	const frames: Mp3Frame[] = [];
	let offset = 0;
	while (offset + 4 <= bytes.length) {
		const frame = mp3FrameAt(bytes, offset);
		const next = frame ? offset + frame.length : 0;
		const last = frames[frames.length - 1];
		const continues = last !== undefined && last.offset + last.length === offset;
		if (frame && (continues || next === bytes.length || mp3FrameAt(bytes, next))) {
			frames.push(frame);
			offset = next;
		} else {
			offset++;
		}
	}
	return frames;
}

function mp3FrameAt(bytes: Uint8Array, offset: number): Mp3Frame | undefined {
	if (offset + 4 > bytes.length || bytes[offset] !== 0xff) return undefined;
	const versionAndLayer = bytes[offset + 1];
	const rates = bytes[offset + 2];
	const version = (versionAndLayer >> 3) & 3;
	const isLayer3 = ((versionAndLayer >> 1) & 3) === 1;
	if ((versionAndLayer & 0xe0) !== 0xe0 || !isLayer3) return undefined;
	const kbps = (version === 3 ? MPEG1_LAYER3_KBPS : MPEG2_LAYER3_KBPS)[rates >> 4];
	const sampleRate = SAMPLE_RATES[version]?.[(rates >> 2) & 3];
	if (!kbps || !sampleRate) return undefined;
	const samples = version === 3 ? 1152 : 576;
	const padding = (rates >> 1) & 1;
	return {
		offset,
		length: Math.floor(((samples / 8) * kbps * 1000) / sampleRate) + padding,
		seconds: samples / sampleRate,
	};
}

async function convertToWavChunks(buffer: ArrayBuffer, basename: string): Promise<File[]> {
	const audioContext = createAudioContext();
	if (!audioContext) return [];

	try {
		const audioBuffer = await audioContext.decodeAudioData(buffer.slice(0));
		return renderWavChunks(audioBuffer, basename);
	} catch (error) {
		console.warn("Failed to convert audio buffer for transcription", error);
		return [];
	} finally {
		try {
			await audioContext.close();
		} catch (error) {
			console.warn("Failed to close audio context", error);
		}
	}
}

function createAudioContext(): AudioContext | null {
	if (typeof window === "undefined") {
		return null;
	}

	const contextCtor =
		window.AudioContext ||
		(window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!contextCtor) {
		return null;
	}

	return new contextCtor();
}

function renderWavChunks(audioBuffer: AudioBuffer, basename: string): File[] {
	const numChannels = audioBuffer.numberOfChannels;
	const bytesPerFrame = numChannels * PCM_BYTES_PER_SAMPLE;
	const availableBytesPerChunk = CHUNK_SIZE_BYTES - WAV_HEADER_SIZE;
	const maxSamplesPerChunk = Math.max(1, Math.floor(availableBytesPerChunk / bytesPerFrame));
	const channelData = Array.from({ length: numChannels }, (_, channelIndex) =>
		audioBuffer.getChannelData(channelIndex),
	);
	const files: File[] = [];
	let chunkIndex = 0;

	for (let startSample = 0; startSample < audioBuffer.length; startSample += maxSamplesPerChunk) {
		const endSample = Math.min(audioBuffer.length, startSample + maxSamplesPerChunk);
		const wavBuffer = renderWavBuffer(
			channelData,
			audioBuffer.sampleRate,
			startSample,
			endSample,
		);
		files.push(
			new File([wavBuffer], `${basename}.part${chunkIndex}.wav`, {
				type: "audio/wav",
			}),
		);
		chunkIndex++;
	}

	return files;
}

function renderWavBuffer(
	channelData: Float32Array[],
	sampleRate: number,
	startSample: number,
	endSample: number,
): ArrayBuffer {
	const numChannels = channelData.length;
	const sampleCount = Math.max(0, endSample - startSample);
	const blockAlign = numChannels * PCM_BYTES_PER_SAMPLE;
	const buffer = new ArrayBuffer(WAV_HEADER_SIZE + sampleCount * blockAlign);
	const view = new DataView(buffer);
	writeWavHeader(view, sampleRate, numChannels, sampleCount);
	let offset = WAV_HEADER_SIZE;

	for (let i = 0; i < sampleCount; i++) {
		for (let channel = 0; channel < numChannels; channel++) {
			const sample = channelData[channel][startSample + i] ?? 0;
			const clamped = Math.max(-1, Math.min(1, sample));
			const intSample = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
			view.setInt16(offset, Math.round(intSample), true);
			offset += PCM_BYTES_PER_SAMPLE;
		}
	}

	return buffer;
}

export function writeWavHeader(
	view: DataView,
	sampleRate: number,
	numChannels: number,
	sampleCount: number,
): void {
	const blockAlign = numChannels * PCM_BYTES_PER_SAMPLE;
	const byteRate = sampleRate * blockAlign;
	const dataSize = sampleCount * blockAlign;
	writeString(view, 0, "RIFF");
	view.setUint32(4, 36 + dataSize, true);
	writeString(view, 8, "WAVE");
	writeString(view, 12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, numChannels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, PCM_BYTES_PER_SAMPLE * 8, true);
	writeString(view, 36, "data");
	view.setUint32(40, dataSize, true);
}

function writeString(view: DataView, offset: number, str: string): void {
	for (let i = 0; i < str.length; i++) {
		view.setUint8(offset + i, str.charCodeAt(i));
	}
}
