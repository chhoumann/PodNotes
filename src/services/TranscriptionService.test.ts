import { describe, expect, test, vi, beforeEach } from "vitest";
import { Notice } from "obsidian";
import { TranscriptionService } from "./TranscriptionService";
import type { Episode } from "src/types/Episode";
import type PodNotes from "src/main";

// The shared obsidian mock's Notice has no setMessage; TimerNotice needs one.
(Notice.prototype as unknown as { setMessage: () => void }).setMessage = () => {};

const getEpisodeAudioBufferMock = vi.fn();
const transcriptionsCreateMock = vi.fn();
const diarizeWithDeepgramMock = vi.hoisted(() => vi.fn());

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

async function settlesAfterMicrotasks(promise: Promise<unknown>): Promise<boolean> {
	let settled = false;
	void promise.then(
		() => {
			settled = true;
		},
		() => {
			settled = true;
		},
	);

	for (let turn = 0; turn < 10 && !settled; turn++) await Promise.resolve();
	return settled;
}

vi.mock("../downloadEpisode", () => ({
	getEpisodeAudioBuffer: (...args: unknown[]) => getEpisodeAudioBufferMock(...args),
}));

vi.mock("openai", () => ({
	OpenAI: class {
		audio = { transcriptions: { create: transcriptionsCreateMock } };
	},
}));

vi.mock("./diarization", async () => {
	const actual = await vi.importActual<typeof import("./diarization")>("./diarization");
	return {
		...actual,
		diarizeWithDeepgram: diarizeWithDeepgramMock,
	};
});

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

function createMockPlugin(
	overrides: {
		openAIKey?: string;
		podcast?: Episode | null;
		existingTranscriptPath?: string | null;
	} = {},
): PodNotes {
	const {
		openAIKey = "test-api-key",
		podcast = mockEpisode,
		existingTranscriptPath = null,
	} = overrides;

	return {
		settings: {
			openAISecretId: openAIKey ? "openai-secret" : "",
			deepgramSecretId: "",
			transcript: {
				path: "Transcripts/{{podcast}}/{{title}}.md",
				template: "# {{title}}\n\n{{transcript}}",
			},
			download: {
				path: "Downloads",
			},
		},
		credentials: {
			get: vi.fn((_settings, kind: "openai" | "deepgram") =>
				kind === "openai" ? openAIKey || null : null,
			),
			has: vi.fn((_settings, kind: "openai" | "deepgram") =>
				kind === "openai" ? Boolean(openAIKey) : false,
			),
			status: vi.fn((_settings, kind: "openai" | "deepgram") =>
				kind === "openai" && openAIKey ? "available" : "unconfigured",
			),
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
		diarizeWithDeepgramMock.mockReset();
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
			const mockPlugin = createMockPlugin({ openAIKey: "" });
			const service = new TranscriptionService(mockPlugin);

			await service.transcribeCurrentEpisode();
		});

		test("shows notice when no episode is playing", async () => {
			const mockPlugin = createMockPlugin({ podcast: null });
			const service = new TranscriptionService(mockPlugin);

			await service.transcribeCurrentEpisode();
		});
	});

	describe("dispose", () => {
		test("prevents queued work and credential reads after unload", async () => {
			const plugin = createMockPlugin();
			const service = new TranscriptionService(plugin);
			(service as unknown as { pendingEpisodes: Episode[] }).pendingEpisodes = [mockEpisode];
			service.dispose();

			(service as unknown as { drainQueue: () => void }).drainQueue();
			await expect(
				(service as unknown as { getClient: () => Promise<unknown> }).getClient(),
			).rejects.toThrow("unloaded");

			expect(getEpisodeAudioBufferMock).not.toHaveBeenCalled();
			expect(plugin.credentials.get).not.toHaveBeenCalled();
		});

		test("cannot recreate a client when unload happens during the dynamic import", async () => {
			const plugin = createMockPlugin();
			let resolveModule!: (module: Pick<typeof import("openai"), "OpenAI">) => void;
			const loader = vi.fn(
				() =>
					new Promise<Pick<typeof import("openai"), "OpenAI">>((resolve) => {
						resolveModule = resolve;
					}),
			);
			const constructor = vi.fn(() => ({ audio: { transcriptions: { create: vi.fn() } } }));
			const service = new TranscriptionService(plugin, loader);
			const pending = (
				service as unknown as { getClient: () => Promise<unknown> }
			).getClient();
			await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());

			service.dispose();
			resolveModule({ OpenAI: constructor as unknown as typeof import("openai").OpenAI });

			await expect(pending).rejects.toThrow("unloaded");
			expect(constructor).not.toHaveBeenCalled();
			expect(
				(service as unknown as { client: unknown; cachedApiKey: unknown }).client,
			).toBeNull();
			expect(
				(service as unknown as { client: unknown; cachedApiKey: unknown }).cachedApiKey,
			).toBeNull();
		});

		test("settles promptly when unloaded during audio acquisition", async () => {
			const audioRequest = deferred<{
				buffer: ArrayBuffer;
				extension: string;
				basename: string;
			}>();
			getEpisodeAudioBufferMock.mockReturnValue(audioRequest.promise);
			const plugin = createMockPlugin();
			const service = new TranscriptionService(plugin);
			const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
			const pending = (
				service as unknown as {
					transcribeEpisode: (episode: Episode) => Promise<void>;
				}
			).transcribeEpisode(mockEpisode);
			await vi.waitFor(() => expect(getEpisodeAudioBufferMock).toHaveBeenCalledOnce());

			service.dispose();
			const settledPromptly = await settlesAfterMicrotasks(pending);
			audioRequest.reject(new Error("late audio failure"));
			await pending;

			expect(settledPromptly).toBe(true);
			expect(plugin.app.vault.create).not.toHaveBeenCalled();
			expect(consoleError).not.toHaveBeenCalled();
			consoleError.mockRestore();
		});

		test("aborts active OpenAI work without writing a note or updating notices", async () => {
			const plugin = createMockPlugin();
			const service = new TranscriptionService(plugin);
			let finishRequest!: (result: { text: string }) => void;
			let requestSignal: AbortSignal | undefined;
			transcriptionsCreateMock.mockImplementation(
				(
					_request: unknown,
					options?: { signal?: AbortSignal },
				): Promise<{ text: string }> =>
					new Promise((resolve, reject) => {
						finishRequest = resolve;
						requestSignal = options?.signal;
						requestSignal?.addEventListener(
							"abort",
							() => reject(requestSignal?.reason ?? new Error("aborted")),
							{ once: true },
						);
					}),
			);
			const setMessage = vi.spyOn(Notice.prototype, "setMessage");
			try {
				const pending = (
					service as unknown as {
						transcribeEpisode: (episode: Episode) => Promise<void>;
					}
				).transcribeEpisode(mockEpisode);
				await vi.waitFor(() => expect(transcriptionsCreateMock).toHaveBeenCalledOnce());

				const messagesBeforeDispose = setMessage.mock.calls.length;
				service.dispose();
				finishRequest({ text: "This must not be saved." });
				await pending;

				expect(requestSignal?.aborted).toBe(true);
				expect(plugin.app.vault.create).not.toHaveBeenCalled();
				expect(setMessage).toHaveBeenCalledTimes(messagesBeforeDispose);
			} finally {
				setMessage.mockRestore();
			}
		});

		test("does not save Deepgram results that finish after unload", async () => {
			const plugin = createMockPlugin();
			plugin.settings.transcript.diarization = {
				enabled: true,
				provider: "deepgram",
				speakerTemplate: "**{{speaker}}:** {{text}}",
			};
			vi.mocked(plugin.credentials.get).mockImplementation((_settings, kind) =>
				kind === "deepgram" ? "deepgram-key" : "test-api-key",
			);
			let finishRequest!: (segments: Array<{ speaker: string; text: string }>) => void;
			diarizeWithDeepgramMock.mockImplementation(
				() =>
					new Promise((resolve) => {
						finishRequest = resolve;
					}),
			);
			const service = new TranscriptionService(plugin);
			const pending = (
				service as unknown as {
					transcribeEpisode: (episode: Episode) => Promise<void>;
				}
			).transcribeEpisode(mockEpisode);
			await vi.waitFor(() => expect(diarizeWithDeepgramMock).toHaveBeenCalledOnce());

			service.dispose();
			finishRequest([{ speaker: "A", text: "This must not be saved." }]);
			await pending;

			expect(plugin.app.vault.create).not.toHaveBeenCalled();
		});

		test("settles promptly when unloaded during a non-cancelable Deepgram request", async () => {
			const plugin = createMockPlugin();
			plugin.settings.transcript.diarization = {
				enabled: true,
				provider: "deepgram",
				speakerTemplate: "**{{speaker}}:** {{text}}",
			};
			vi.mocked(plugin.credentials.get).mockImplementation((_settings, kind) =>
				kind === "deepgram" ? "deepgram-key" : "test-api-key",
			);
			const request = deferred<Array<{ speaker: string; text: string }>>();
			diarizeWithDeepgramMock.mockReturnValue(request.promise);
			const service = new TranscriptionService(plugin);
			const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
			const pending = (
				service as unknown as {
					transcribeEpisode: (episode: Episode) => Promise<void>;
				}
			).transcribeEpisode(mockEpisode);
			await vi.waitFor(() => expect(diarizeWithDeepgramMock).toHaveBeenCalledOnce());

			service.dispose();
			const settledPromptly = await settlesAfterMicrotasks(pending);
			request.reject(new Error("late Deepgram failure"));
			await pending;

			expect(settledPromptly).toBe(true);
			expect(plugin.app.vault.create).not.toHaveBeenCalled();
			expect(consoleError).not.toHaveBeenCalled();
			consoleError.mockRestore();
		});

		test("cancels a completed notice hide timer when disposed", async () => {
			vi.useFakeTimers();
			const hide = vi.spyOn(Notice.prototype, "hide");
			try {
				transcriptionsCreateMock.mockResolvedValue({ text: "Completed transcript." });
				const plugin = createMockPlugin();
				const service = new TranscriptionService(plugin);
				await (
					service as unknown as {
						transcribeEpisode: (episode: Episode) => Promise<void>;
					}
				).transcribeEpisode(mockEpisode);

				expect(hide).not.toHaveBeenCalled();
				service.dispose();
				expect(hide).toHaveBeenCalledOnce();

				await vi.advanceTimersByTimeAsync(5000);
				expect(hide).toHaveBeenCalledOnce();
			} finally {
				hide.mockRestore();
				vi.useRealTimers();
			}
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
			transcriptionsCreateMock.mockImplementation(async ({ file }: { file: File }) => {
				if (file.name.includes("part0")) {
					throw new Error("boom");
				}
				return { text: "   " };
			});

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
			transcriptionsCreateMock.mockImplementation(async ({ file }: { file: File }) => {
				if (file.name.includes("part1")) {
					throw new Error("boom");
				}
				return { text: "Good chunk." };
			});

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
