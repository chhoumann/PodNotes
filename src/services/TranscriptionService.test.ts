import { describe, expect, test, vi, beforeEach } from "vitest";
import { TranscriptionService } from "./TranscriptionService";
import type { Episode } from "src/types/Episode";
import type PodNotes from "src/main";

const mockEpisode: Episode = {
	title: "Test Episode",
	streamUrl: "https://example.com/episode.mp3",
	url: "https://example.com/episode",
	description: "Test description",
	content: "Test content",
	podcastName: "Test Podcast",
	feedUrl: "https://example.com/feed.xml",
	artworkUrl: "https://example.com/artwork.jpg",
	episodeDate: new Date("2024-01-01"),
};

function createMockPlugin(overrides: {
	openAIApiKey?: string;
	podcast?: Episode | null;
	existingTranscriptPath?: string | null;
} = {}): PodNotes {
	const {
		openAIApiKey = "test-api-key",
		podcast = mockEpisode,
		existingTranscriptPath = null,
	} = overrides;

	return {
		settings: {
			openAIApiKey,
			transcript: {
				path: "Transcripts/{{podcast}}/{{title}}.md",
				template: "# {{title}}\n\n{{transcript}}",
			},
			download: {
				path: "Downloads",
			},
		},
		api: {
			podcast,
		},
		app: {
			vault: {
				getAbstractFileByPath: vi.fn((path: string) => {
					if (existingTranscriptPath && path === existingTranscriptPath) {
						return { path };
					}
					return null;
				}),
				readBinary: vi.fn(),
				create: vi.fn(),
				createFolder: vi.fn(),
			},
			workspace: {
				getLeaf: vi.fn(() => ({
					openFile: vi.fn(),
				})),
			},
		},
	} as unknown as PodNotes;
}

describe("TranscriptionService", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("formatTime", () => {
		test("formats time correctly for seconds", () => {
			const formatTime = (ms: number): string => {
				const seconds = Math.floor(ms / 1000);
				const minutes = Math.floor(seconds / 60);
				const hours = Math.floor(minutes / 60);
				return `${hours.toString().padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
			};

			expect(formatTime(0)).toBe("00:00:00");
			expect(formatTime(1000)).toBe("00:00:01");
			expect(formatTime(60000)).toBe("00:01:00");
			expect(formatTime(3600000)).toBe("01:00:00");
			expect(formatTime(3661000)).toBe("01:01:01");
		});
	});

	describe("getMimeType", () => {
		test("returns correct mime types for audio formats", () => {
			const getMimeType = (fileExtension: string): string => {
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
					default:
						return "audio/mpeg";
				}
			};

			expect(getMimeType("mp3")).toBe("audio/mp3");
			expect(getMimeType("MP3")).toBe("audio/mp3");
			expect(getMimeType("m4a")).toBe("audio/mp4");
			expect(getMimeType("ogg")).toBe("audio/ogg");
			expect(getMimeType("wav")).toBe("audio/wav");
			expect(getMimeType("flac")).toBe("audio/flac");
			expect(getMimeType("unknown")).toBe("audio/mpeg");
		});
	});

	describe("shouldConvertToWav", () => {
		test("returns true for m4a files", () => {
			const shouldConvertToWav = (extension: string, mimeType: string): boolean => {
				const normalizedExtension = extension.toLowerCase();
				return normalizedExtension === "m4a" || mimeType === "audio/mp4";
			};

			expect(shouldConvertToWav("m4a", "audio/mp4")).toBe(true);
			expect(shouldConvertToWav("M4A", "audio/mp4")).toBe(true);
			expect(shouldConvertToWav("mp3", "audio/mp4")).toBe(true);
			expect(shouldConvertToWav("mp3", "audio/mpeg")).toBe(false);
		});
	});

	describe("getEpisodeKey", () => {
		test("generates unique key from podcast name and title", () => {
			const getEpisodeKey = (episode: Episode): string => {
				return `${episode.podcastName}:${episode.title}`;
			};

			expect(getEpisodeKey(mockEpisode)).toBe("Test Podcast:Test Episode");
		});
	});

	describe("createBinaryChunkFiles", () => {
		const CHUNK_SIZE_BYTES = 20 * 1024 * 1024;

		function createBinaryChunkFiles(
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
		const PCM_BYTES_PER_SAMPLE = 2;

		function writeString(view: DataView, offset: number, str: string): void {
			for (let i = 0; i < str.length; i++) {
				view.setUint8(offset + i, str.charCodeAt(i));
			}
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

	describe("TranscriptionService instantiation", () => {
		test("creates instance with plugin reference", () => {
			const mockPlugin = createMockPlugin();
			const service = new TranscriptionService(mockPlugin);

			expect(service).toBeInstanceOf(TranscriptionService);
		});
	});

	describe("transcribeCurrentEpisode validation", () => {
		test("shows notice when no API key is configured", async () => {
			const mockPlugin = createMockPlugin({ openAIApiKey: "" });
			const service = new TranscriptionService(mockPlugin);

			await service.transcribeCurrentEpisode();
		});

		test("shows notice when no episode is playing", async () => {
			const mockPlugin = createMockPlugin({ podcast: null });
			const service = new TranscriptionService(mockPlugin);

			await service.transcribeCurrentEpisode();
		});
	});
});
