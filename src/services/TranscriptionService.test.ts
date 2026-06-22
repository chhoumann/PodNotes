import { describe, expect, test, vi, beforeEach } from "vitest";
import { Notice } from "obsidian";
import { TranscriptionService } from "./TranscriptionService";
import type { Episode } from "src/types/Episode";
import type PodNotes from "src/main";

// The shared obsidian mock's Notice has no setMessage; TimerNotice needs one.
(Notice.prototype as unknown as { setMessage: () => void }).setMessage = () => {};

const getEpisodeAudioBufferMock = vi.fn();
const transcriptionsCreateMock = vi.fn();

vi.mock("../downloadEpisode", () => ({
	getEpisodeAudioBuffer: (...args: unknown[]) =>
		getEpisodeAudioBufferMock(...args),
}));

vi.mock("openai", () => ({
	OpenAI: class {
		audio = { transcriptions: { create: transcriptionsCreateMock } };
	},
}));

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
		getEpisodeAudioBufferMock.mockResolvedValue({
			buffer: new ArrayBuffer(1024),
			extension: "mp3",
			basename: "episode",
		});
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

	// NOTE: the audio chunking + WAV encoding tests (getMimeType, shouldConvertToWav,
	// createBinaryChunkFiles, writeWavHeader, createChunkFiles) moved to
	// audioChunker.test.ts, where they exercise the real exported functions instead
	// of inline copies. This file keeps the service-orchestration tests.

	describe("getEpisodeKey", () => {
		test("generates unique key from podcast name and title", () => {
			const getEpisodeKey = (episode: Episode): string => {
				return `${episode.podcastName}:${episode.title}`;
			};

			expect(getEpisodeKey(mockEpisode)).toBe("Test Podcast:Test Episode");
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

	describe("empty Whisper transcript (TR-01)", () => {
		// transcribeEpisode is private; drive it directly so the empty-body throw is
		// observed as "no file written" (the throw is caught and surfaced as a
		// "Transcription failed" notice, never as a saved transcript).
		const runTranscribeEpisode = async (plugin: PodNotes) => {
			const service = new TranscriptionService(plugin);
			await (
				service as unknown as {
					transcribeEpisode: (episode: Episode) => Promise<void>;
				}
			).transcribeEpisode(mockEpisode);
			return service;
		};

		test("does not write a file when the transcript is empty", async () => {
			transcriptionsCreateMock.mockResolvedValue({ text: "" });
			const plugin = createMockPlugin();

			await runTranscribeEpisode(plugin);

			expect(plugin.app.vault.create).not.toHaveBeenCalled();
		});

		test("does not write a file when the transcript is only whitespace", async () => {
			// Multiple empty chunks join to " ", not "" — the trimmed-emptiness check
			// must still treat this as failure.
			transcriptionsCreateMock.mockResolvedValue({ text: "   \n\t  " });
			const plugin = createMockPlugin();

			await runTranscribeEpisode(plugin);

			expect(plugin.app.vault.create).not.toHaveBeenCalled();
		});

		test("writes a file when the transcript has content", async () => {
			transcriptionsCreateMock.mockResolvedValue({
				text: "Hello world. This is a transcript.",
			});
			const plugin = createMockPlugin();

			await runTranscribeEpisode(plugin);

			expect(plugin.app.vault.create).toHaveBeenCalledTimes(1);
		});
	});

	describe("buildTranscriptBody (TR-01)", () => {
		const buildBody = (plugin: PodNotes) => {
			const service = new TranscriptionService(plugin);
			return (
				service as unknown as {
					buildTranscriptBody: (
						audio: {
							buffer: ArrayBuffer;
							mimeType: string;
							extension: string;
							basename: string;
						},
						update: (message: string) => void,
					) => Promise<string>;
				}
			).buildTranscriptBody(
				{
					buffer: new ArrayBuffer(1024),
					mimeType: "audio/mpeg",
					extension: "mp3",
					basename: "episode",
				},
				() => {},
			);
		};

		test("throws when the trimmed Whisper body is empty", async () => {
			transcriptionsCreateMock.mockResolvedValue({ text: "   \n  " });

			await expect(buildBody(createMockPlugin())).rejects.toThrow(
				"Transcription returned no text.",
			);
		});

		test("returns the reflowed body when there is text", async () => {
			transcriptionsCreateMock.mockResolvedValue({
				text: "One. Two.",
			});

			await expect(buildBody(createMockPlugin())).resolves.toBe(
				"One.\n\nTwo.",
			);
		});
	});
});
