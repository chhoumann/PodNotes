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
		const buildBody = (
			plugin: PodNotes,
			audio: {
				buffer: ArrayBuffer;
				mimeType: string;
				extension: string;
				basename: string;
			} = {
				buffer: new ArrayBuffer(1024),
				mimeType: "audio/mpeg",
				extension: "mp3",
				basename: "episode",
			},
		) => {
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
					) => Promise<{ body: string; warning?: string }>;
				}
			).buildTranscriptBody(audio, () => {});
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

			await expect(buildBody(createMockPlugin())).resolves.toEqual({
				body: "One.\n\nTwo.",
				warning: undefined,
			});
		});
	});

	describe("failed chunks are not saved as a completed transcript (other-silent-failure)", () => {
		const buildBodyDirect = (
			plugin: PodNotes,
			audio: {
				buffer: ArrayBuffer;
				mimeType: string;
				extension: string;
				basename: string;
			},
		) => {
			const service = new TranscriptionService(plugin);
			return (
				service as unknown as {
					buildTranscriptBody: (
						a: typeof audio,
						update: (message: string) => void,
					) => Promise<{ body: string; warning?: string }>;
				}
			).buildTranscriptBody(audio, () => {});
		};

		const mp3Audio = (byteLength: number) => ({
			buffer: new ArrayBuffer(byteLength),
			mimeType: "audio/mp3",
			extension: "mp3",
			basename: "episode",
		});

		test("throws (no file) when the single chunk fails every retry", async () => {
			transcriptionsCreateMock.mockRejectedValue(new Error("boom"));
			vi.useFakeTimers();
			try {
				const promise = buildBodyDirect(createMockPlugin(), mp3Audio(1024));
				const assertion = expect(promise).rejects.toThrow(
					"Transcription failed: all 1 audio chunk(s) failed or returned no text.",
				);
				await vi.runAllTimersAsync();
				await assertion;
			} finally {
				vi.useRealTimers();
			}
		});

		test("throws when failed chunks plus empty successes leave no real text", async () => {
			// >20 MB mp3 → two chunks. chunk 0 fails every retry; chunk 1 "succeeds"
			// but returns empty text. The body is then only an error marker, which
			// must NOT be saved as a completed transcript.
			transcriptionsCreateMock.mockImplementation(
				async ({ file }: { file: File }) => {
					if (file.name.includes("part0")) {
						throw new Error("boom");
					}
					return { text: "   " };
				},
			);

			vi.useFakeTimers();
			try {
				const promise = buildBodyDirect(
					createMockPlugin(),
					mp3Audio(20 * 1024 * 1024 + 1024),
				);
				const assertion = expect(promise).rejects.toThrow(
					"Transcription failed: all 2 audio chunk(s) failed or returned no text.",
				);
				await vi.runAllTimersAsync();
				await assertion;
			} finally {
				vi.useRealTimers();
			}
		});

		test("does not write a file when transcription fails completely", async () => {
			transcriptionsCreateMock.mockRejectedValue(new Error("boom"));
			const plugin = createMockPlugin();
			const service = new TranscriptionService(plugin);

			vi.useFakeTimers();
			try {
				const promise = (
					service as unknown as {
						transcribeEpisode: (episode: Episode) => Promise<void>;
					}
				).transcribeEpisode(mockEpisode);
				// One chunk, MAX_RETRIES=3 → backoff 1000ms + 2000ms before it gives up.
				await vi.advanceTimersByTimeAsync(3500);
				await promise;
			} finally {
				vi.useRealTimers();
			}

			expect(plugin.app.vault.create).not.toHaveBeenCalled();
		});

		test("keeps an otherwise-good transcript but warns when only some chunks fail", async () => {
			// A >20 MB mp3 byte-splits into two chunks; fail the second one.
			transcriptionsCreateMock.mockImplementation(
				async ({ file }: { file: File }) => {
					if (file.name.includes("part1")) {
						throw new Error("boom");
					}
					return { text: "Good chunk." };
				},
			);

			vi.useFakeTimers();
			try {
				const promise = buildBodyDirect(
					createMockPlugin(),
					mp3Audio(20 * 1024 * 1024 + 1024),
				);
				await vi.runAllTimersAsync();
				const result = await promise;

				expect(result.body).toContain("Good chunk.");
				expect(result.body).toContain("[Error transcribing chunk 1]");
				expect(result.warning).toContain("1 of 2 chunk(s) failed");
			} finally {
				vi.useRealTimers();
			}
		});
	});
});
