const WAV_HEADER_SIZE = 44;
const PCM_BYTES_PER_SAMPLE = 2;

export interface AudioPart {
	readonly file: File;
	/** Seconds into the episode where this part starts. */
	readonly start: number;
}

/** What one request may carry. `maxSeconds` limits MP3 parts only, because other formats are not measured without decoding them. */
export interface PartCaps {
	readonly maxBytes: number;
	readonly maxSeconds?: number;
}

function getMimeType(fileExtension: string): string {
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
 * The files to send for an episode, in order. Audio within the caps goes whole, in its own
 * format. A larger MP3 is cut at frame starts, where each part decodes on its own and its
 * start time is known. Every other format keeps its codec setup at the start of the file,
 * so it is decoded and sent as WAV parts.
 *
 * Files are named for their format only: a local file's own name is part of its path.
 */
export async function splitAudio(
	audio: { readonly buffer: ArrayBuffer; readonly extension: string },
	{ maxBytes, maxSeconds = Infinity }: PartCaps,
): Promise<AudioPart[]> {
	const { buffer, extension } = audio;
	const type = getMimeType(extension);
	const whole = () => [{ file: new File([buffer], `audio.${extension}`, { type }), start: 0 }];
	const fits = buffer.byteLength <= maxBytes;
	if (fits && maxSeconds === Infinity) return whole();

	const frames = type === "audio/mp3" ? mp3Frames(new Uint8Array(buffer)) : [];
	if (frames.length > 0) {
		const starts = mp3PartStarts(frames, buffer.byteLength, maxBytes, maxSeconds);
		if (starts.length === 1) return whole();
		return starts.map(({ offset, seconds }, index) => ({
			file: new File(
				[buffer.slice(offset, starts[index + 1]?.offset)],
				`audio.part${index}.${extension}`,
				{ type },
			),
			start: seconds,
		}));
	}

	if (fits) return whole();
	const parts = await convertToWavParts(buffer, maxBytes);
	if (parts.length === 0) {
		throw new Error(
			`Could not split ${extension || "audio"} audio for transcription. This format must be decoded to WAV before splitting, but the audio decoder is unavailable or could not decode it.`,
		);
	}
	return parts;
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
 * Where each part of an MP3 starts, in bytes and in seconds of audio. Parts start at frame
 * starts, there are as few as both caps allow, and they hold an equal number of frames, so
 * no part is a few seconds long. The first part starts at byte 0 and keeps a leading tag.
 */
function mp3PartStarts(
	frames: Mp3Frame[],
	byteLength: number,
	maxBytes: number,
	maxSeconds: number,
): { offset: number; seconds: number }[] {
	// Frames in one stream last equally long, so parts are counted in frames: summing frame
	// durations drifts past maxSeconds and would split off a one-frame tail.
	const framesPerCap =
		frames.length > 0 ? Math.floor(maxSeconds / frames[0].seconds + 1e-9) : Infinity;
	const parts = Math.max(
		Math.ceil(byteLength / maxBytes),
		Math.ceil(frames.length / framesPerCap),
	);
	const framesPerPart = Math.ceil(frames.length / parts);
	const starts = [{ offset: 0, seconds: 0 }];
	let elapsed = 0;
	let partFrames = 0;
	for (const frame of frames) {
		if (
			partFrames === framesPerPart ||
			frame.offset + frame.length - starts[starts.length - 1].offset > maxBytes
		) {
			starts.push({ offset: frame.offset, seconds: elapsed });
			partFrames = 0;
		}
		partFrames++;
		elapsed += frame.seconds;
	}
	return starts;
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

async function convertToWavParts(buffer: ArrayBuffer, maxBytes: number): Promise<AudioPart[]> {
	const audioContext = createAudioContext();
	if (!audioContext) return [];

	try {
		const audioBuffer = await audioContext.decodeAudioData(buffer.slice(0));
		return renderWavParts(audioBuffer, maxBytes);
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

function renderWavParts(audioBuffer: AudioBuffer, maxBytes: number): AudioPart[] {
	const numChannels = audioBuffer.numberOfChannels;
	const bytesPerFrame = numChannels * PCM_BYTES_PER_SAMPLE;
	const maxSamplesPerPart = Math.max(1, Math.floor((maxBytes - WAV_HEADER_SIZE) / bytesPerFrame));
	const channelData = Array.from({ length: numChannels }, (_, channelIndex) =>
		audioBuffer.getChannelData(channelIndex),
	);
	const parts: AudioPart[] = [];

	for (let startSample = 0; startSample < audioBuffer.length; startSample += maxSamplesPerPart) {
		const endSample = Math.min(audioBuffer.length, startSample + maxSamplesPerPart);
		const wavBuffer = renderWavBuffer(
			channelData,
			audioBuffer.sampleRate,
			startSample,
			endSample,
		);
		parts.push({
			file: new File([wavBuffer], `audio.part${parts.length}.wav`, { type: "audio/wav" }),
			start: startSample / audioBuffer.sampleRate,
		});
	}

	return parts;
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

function writeWavHeader(
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
