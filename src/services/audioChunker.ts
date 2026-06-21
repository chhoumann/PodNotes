/**
 * Pure audio chunking + WAV encoding for transcription uploads. Splits an episode
 * audio buffer into request-sized files, decoding and re-encoding m4a to WAV only
 * when it must be split (m4a can't be byte-split). Kept free of any
 * TranscriptionService/plugin state so it can be unit-tested directly — the
 * service just orchestrates it.
 */

// OpenAI's audio upload limit. Buffers at or under this are sent as a single file.
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

export function shouldConvertToWav(extension: string, mimeType: string): boolean {
	const normalizedExtension = extension.toLowerCase();
	return normalizedExtension === "m4a" || mimeType === "audio/mp4";
}

export async function createChunkFiles({
	buffer,
	basename,
	extension,
	mimeType,
}: {
	buffer: ArrayBuffer;
	basename: string;
	extension: string;
	mimeType: string;
}): Promise<File[]> {
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

	if (shouldConvertToWav(extension, mimeType)) {
		const wavChunks = await convertToWavChunks(buffer, basename);
		if (wavChunks.length > 0) {
			return wavChunks;
		}
	}

	return createBinaryChunkFiles(buffer, basename, extension, mimeType);
}

export function createBinaryChunkFiles(
	buffer: ArrayBuffer,
	basename: string,
	extension: string,
	mimeType: string,
): File[] {
	if (buffer.byteLength <= CHUNK_SIZE_BYTES) {
		return [
			new File([buffer], `${basename}.${extension}`, {
				type: mimeType,
			}),
		];
	}

	const files: File[] = [];
	for (
		let offset = 0, index = 0;
		offset < buffer.byteLength;
		offset += CHUNK_SIZE_BYTES, index++
	) {
		const chunk = buffer.slice(offset, offset + CHUNK_SIZE_BYTES);
		files.push(
			new File([chunk], `${basename}.part${index}.${extension}`, {
				type: mimeType,
			}),
		);
	}

	return files;
}

async function convertToWavChunks(
	buffer: ArrayBuffer,
	basename: string,
): Promise<File[]> {
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
		(window as typeof window & { webkitAudioContext?: typeof AudioContext })
			.webkitAudioContext;
	if (!contextCtor) {
		return null;
	}

	return new contextCtor();
}

function renderWavChunks(audioBuffer: AudioBuffer, basename: string): File[] {
	const numChannels = audioBuffer.numberOfChannels;
	const bytesPerFrame = numChannels * PCM_BYTES_PER_SAMPLE;
	const availableBytesPerChunk = CHUNK_SIZE_BYTES - WAV_HEADER_SIZE;
	const maxSamplesPerChunk = Math.max(
		1,
		Math.floor(availableBytesPerChunk / bytesPerFrame),
	);
	const channelData = Array.from({ length: numChannels }, (_, channelIndex) =>
		audioBuffer.getChannelData(channelIndex),
	);
	const files: File[] = [];
	let chunkIndex = 0;

	for (
		let startSample = 0;
		startSample < audioBuffer.length;
		startSample += maxSamplesPerChunk
	) {
		const endSample = Math.min(
			audioBuffer.length,
			startSample + maxSamplesPerChunk,
		);
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
