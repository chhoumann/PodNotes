import { afterEach, describe, expect, test, vi, beforeEach } from "vitest";
import { Notice } from "obsidian";
import { OPENAI_FAILURES, rateLimited } from "../../tests/mocks/openaiFailures";
import { TranscriptionService } from "./TranscriptionService";
import type { Episode } from "src/types/Episode";
import type PodNotes from "src/main";

const noticeMessages = vi.hoisted(() => [] as string[]);

vi.mock("obsidian", async (importOriginal) => {
	const obsidian = await importOriginal<typeof import("obsidian")>();
	class RecordingNotice extends obsidian.Notice {
		constructor(message: string | DocumentFragment, duration?: number) {
			super(message, duration);
			noticeMessages.push(String(message));
		}
	}
	return { ...obsidian, Notice: RecordingNotice };
});

const getEpisodeAudioBufferMock = vi.fn();
const fetchMock = vi.fn<typeof fetch>();
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

const whisperReturns = (text: string) =>
	fetchMock.mockImplementation(async () => Response.json({ text }));

const sentFile = (init?: RequestInit) => (init?.body as FormData | undefined)?.get("file") as File;

describe("TranscriptionService", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		noticeMessages.length = 0;
		fetchMock.mockReset();
		vi.stubGlobal("fetch", fetchMock);
		diarizeWithDeepgramMock.mockReset();
		getEpisodeAudioBufferMock.mockResolvedValue({
			buffer: new ArrayBuffer(1024),
			extension: "mp3",
			basename: "episode",
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	describe("transcribeCurrentEpisode validation", () => {
		test("shows notice when no API key is configured", async () => {
			const mockPlugin = createMockPlugin({ openAIKey: "" });
			const service = new TranscriptionService(mockPlugin);

			await service.transcribeCurrentEpisode();

			expect(noticeMessages).toEqual([
				"Select or create an OpenAI API key in the transcript settings on this device.",
			]);
		});

		test("shows notice when no episode is playing", async () => {
			const mockPlugin = createMockPlugin({ podcast: null });
			const service = new TranscriptionService(mockPlugin);

			await service.transcribeCurrentEpisode();

			expect(noticeMessages).toEqual(["No episode is currently playing."]);
		});
	});

	describe("dispose", () => {
		test("prevents queued work and credential reads after unload", async () => {
			const plugin = createMockPlugin();
			const service = new TranscriptionService(plugin);
			(service as unknown as { pendingEpisodes: Episode[] }).pendingEpisodes = [mockEpisode];
			service.dispose();

			(service as unknown as { drainQueue: () => void }).drainQueue();
			expect(() => (service as unknown as { getApiKey: () => string }).getApiKey()).toThrow(
				"unloaded",
			);

			expect(getEpisodeAudioBufferMock).not.toHaveBeenCalled();
			expect(plugin.credentials.get).not.toHaveBeenCalled();
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
			let finishRequest!: (response: Response) => void;
			fetchMock.mockImplementation(
				() =>
					new Promise((resolve) => {
						finishRequest = resolve;
					}),
			);
			const setMessage = vi.spyOn(Notice.prototype, "setMessage");
			try {
				const pending = (
					service as unknown as {
						transcribeEpisode: (episode: Episode) => Promise<void>;
					}
				).transcribeEpisode(mockEpisode);
				await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

				const messagesBeforeDispose = setMessage.mock.calls.length;
				service.dispose();
				finishRequest(Response.json({ text: "This must not be saved." }));
				await pending;

				expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
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
				whisperReturns("Completed transcript.");
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
			whisperReturns("");
			const plugin = createMockPlugin();

			await runTranscribeEpisode(plugin);

			expect(plugin.app.vault.create).not.toHaveBeenCalled();
		});

		test("does not write a file when the transcript is only whitespace", async () => {
			// Multiple empty chunks join to " ", not "" — the trimmed-emptiness check
			// must still treat this as failure.
			whisperReturns("   \n\t  ");
			const plugin = createMockPlugin();

			await runTranscribeEpisode(plugin);

			expect(plugin.app.vault.create).not.toHaveBeenCalled();
		});

		test("writes a file when the transcript has content", async () => {
			whisperReturns("Hello world. This is a transcript.");
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
			whisperReturns("   \n  ");

			await expect(buildBody(createMockPlugin())).rejects.toThrow(
				"Transcription returned no text.",
			);
		});

		test("returns the reflowed body when there is text", async () => {
			whisperReturns("One. Two.");

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
			fetchMock.mockImplementation(async () => new Response("boom", { status: 500 }));
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
			fetchMock.mockImplementation(async (_url, init) =>
				sentFile(init).name.includes("part0")
					? new Response("boom", { status: 500 })
					: Response.json({ text: "   " }),
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
			fetchMock.mockImplementation(async () => new Response("boom", { status: 500 }));
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
			fetchMock.mockImplementation(async (_url, init) =>
				sentFile(init).name.includes("part1")
					? new Response("boom", { status: 500 })
					: Response.json({ text: "Good chunk." }),
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

	describe("OpenAI requests and failures", () => {
		const transcribe = (plugin: PodNotes) =>
			(
				new TranscriptionService(plugin) as unknown as {
					transcribeEpisode: (episode: Episode) => Promise<void>;
				}
			).transcribeEpisode(mockEpisode);

		const finalNotice = async (plugin: PodNotes): Promise<string> => {
			vi.useFakeTimers();
			const setMessage = vi.spyOn(Notice.prototype, "setMessage");
			const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
			try {
				const pending = transcribe(plugin);
				await vi.runAllTimersAsync();
				await pending;
				const calls = setMessage.mock.calls;
				const message = String(calls[calls.length - 1][0]);
				return message.slice(message.indexOf("\n\n") + 2);
			} finally {
				setMessage.mockRestore();
				consoleError.mockRestore();
				vi.useRealTimers();
			}
		};

		test("sends Whisper only the model and the episode file", async () => {
			whisperReturns("Hello.");

			await transcribe(createMockPlugin());

			expect(fetchMock).toHaveBeenCalledOnce();
			const form = fetchMock.mock.calls[0][1]?.body as FormData;
			expect([...form.keys()]).toEqual(["model", "file"]);
			expect(form.get("model")).toBe("whisper-1");
			const file = sentFile(fetchMock.mock.calls[0][1]);
			expect(file.name).toBe("episode.mp3");
			expect(file.type).toBe("audio/mp3");
			expect(file.size).toBe(1024);
		});

		test.each(OPENAI_FAILURES)(
			"Whisper %s fails the run after three sends",
			async (_name, respond) => {
				fetchMock.mockImplementation(respond);

				await expect(finalNotice(createMockPlugin())).resolves.toBe(
					"Transcription failed: Transcription failed: all 1 audio chunk(s) failed or returned no text.",
				);
				expect(fetchMock).toHaveBeenCalledTimes(3);
			},
		);

		test("Whisper answering without text fails the run after three sends", async () => {
			fetchMock.mockImplementation(async () => Response.json({}));

			await expect(finalNotice(createMockPlugin())).resolves.toBe(
				"Transcription failed: Transcription failed: all 1 audio chunk(s) failed or returned no text.",
			);
			expect(fetchMock).toHaveBeenCalledTimes(3);
		});

		test("Whisper waits out the server's Retry-After and recovers", async () => {
			vi.useFakeTimers();
			try {
				const sentAt: number[] = [];
				fetchMock.mockImplementation(async () => {
					sentAt.push(Date.now());
					return Date.now() - sentAt[0] < 4000
						? rateLimited({ "retry-after": "4" })
						: Response.json({ text: "Recovered." });
				});
				const plugin = createMockPlugin();

				const pending = transcribe(plugin);
				await vi.runAllTimersAsync();
				await pending;

				expect(sentAt.map((time) => time - sentAt[0])).toEqual([0, 4000]);
				expect(plugin.app.vault.create).toHaveBeenCalledOnce();
				expect(vi.mocked(plugin.app.vault.create).mock.calls[0][1]).toContain("Recovered.");
			} finally {
				vi.useRealTimers();
			}
		});

		test("unloading while Whisper waits out a Retry-After cancels the run", async () => {
			vi.useFakeTimers();
			const setMessage = vi.spyOn(Notice.prototype, "setMessage");
			try {
				fetchMock.mockImplementation(async () => rateLimited({ "retry-after": "30" }));
				const plugin = createMockPlugin();
				const service = new TranscriptionService(plugin);
				let settled = false;
				const pending = (
					service as unknown as {
						transcribeEpisode: (episode: Episode) => Promise<void>;
					}
				)
					.transcribeEpisode(mockEpisode)
					.finally(() => {
						settled = true;
					});
				await vi.advanceTimersByTimeAsync(29_000);
				expect(fetchMock).toHaveBeenCalledOnce();

				const messagesBeforeDispose = setMessage.mock.calls.length;
				service.dispose();
				await vi.advanceTimersByTimeAsync(0);

				expect(settled).toBe(true);
				await pending;
				expect(fetchMock).toHaveBeenCalledOnce();
				expect(plugin.app.vault.create).not.toHaveBeenCalled();
				expect(setMessage).toHaveBeenCalledTimes(messagesBeforeDispose);
			} finally {
				setMessage.mockRestore();
				vi.useRealTimers();
			}
		});

		test("reads the current OpenAI key for each transcription", async () => {
			whisperReturns("Hello.");
			const plugin = createMockPlugin({ openAIKey: "first-key" });
			const service = new TranscriptionService(plugin) as unknown as {
				transcribeEpisode: (episode: Episode) => Promise<void>;
			};

			await service.transcribeEpisode(mockEpisode);
			vi.mocked(plugin.credentials.get).mockImplementation((_settings, kind) =>
				kind === "openai" ? "second-key" : null,
			);
			await service.transcribeEpisode(mockEpisode);

			const authorization = (call: number) =>
				new Headers(fetchMock.mock.calls[call][1]?.headers).get("authorization");
			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(authorization(0)).toBe("Bearer first-key");
			expect(authorization(1)).toBe("Bearer second-key");
		});

		test.each(OPENAI_FAILURES)(
			"OpenAI diarization %s shows the API error after three sends",
			async (_name, respond, message) => {
				fetchMock.mockImplementation(respond);
				const plugin = createMockPlugin();
				plugin.settings.transcript.diarization = {
					enabled: true,
					provider: "openai",
					speakerTemplate: "**{{speaker}}:** {{text}}",
				};

				await expect(finalNotice(plugin)).resolves.toBe(
					`Transcription failed: OpenAI diarization failed for every chunk: ${message}`,
				);
				expect(fetchMock).toHaveBeenCalledTimes(3);
			},
		);
	});
});
