// @vitest-environment jsdom
import { afterEach, describe, expect, type MockInstance, test, vi, beforeEach } from "vitest";
import { Notice } from "obsidian";
import { OPENAI_FAILURES, rateLimited } from "../../tests/mocks/openaiFailures";
import { TranscriptionService } from "./TranscriptionService";
import type { TranscriptLink } from "src/parser/feedDocumentParser";
import type { Episode } from "src/types/Episode";
import { NetworkError } from "src/utility/networkRequest";
import { privateFeedPlaceholder } from "src/utility/privateFeedUrl";
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
const fetchTextMock = vi.hoisted(() => vi.fn());

vi.mock("src/utility/networkRequest", async (importOriginal) => ({
	...(await importOriginal<typeof import("src/utility/networkRequest")>()),
	fetchTextWithTimeout: fetchTextMock,
}));

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

type AudioJob = { episode: Episode; source: { kind: "audio" } };
const audioJob: AudioJob = { episode: mockEpisode, source: { kind: "audio" } };

function createMockPlugin(
	overrides: {
		openAIKey?: string;
		podcast?: Episode | null;
		existingTranscriptPath?: string | null;
		transcripts?: TranscriptLink[];
		feedUrl?: string;
		loadFeed?: () => Promise<void>;
	} = {},
): PodNotes {
	const {
		openAIKey = "test-api-key",
		podcast = mockEpisode,
		existingTranscriptPath = null,
		transcripts,
		feedUrl = "https://example.com/feed.xml",
		loadFeed = async () => {},
	} = overrides;

	return {
		settings: {
			openAISecretId: openAIKey ? "openai-secret" : "",
			deepgramSecretId: "",
			timestamp: { template: "- {{linktime}} ", offset: 5 },
			transcript: {
				path: "Transcripts/{{podcast}}/{{title}}.md",
				template: "# {{title}}\n\n{{transcript}}",
			},
			download: {
				path: "Downloads",
			},
		},
		feeds: {
			load: vi.fn(loadFeed),
			episodeMetadata: vi.fn(() => (transcripts ? { transcripts } : undefined)),
			itemUrl: vi.fn((_key: string, link: string) => new URL(link, feedUrl).href),
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
		fetchTextMock.mockReset();
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
			(service as unknown as { pendingJobs: AudioJob[] }).pendingJobs = [audioJob];
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
					transcribeEpisode: (job: AudioJob) => Promise<void>;
				}
			).transcribeEpisode(audioJob);
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
						transcribeEpisode: (job: AudioJob) => Promise<void>;
					}
				).transcribeEpisode(audioJob);
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
					transcribeEpisode: (job: AudioJob) => Promise<void>;
				}
			).transcribeEpisode(audioJob);
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
					transcribeEpisode: (job: AudioJob) => Promise<void>;
				}
			).transcribeEpisode(audioJob);
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
						transcribeEpisode: (job: AudioJob) => Promise<void>;
					}
				).transcribeEpisode(audioJob);

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
					transcribeEpisode: (job: AudioJob) => Promise<void>;
				}
			).transcribeEpisode(audioJob);
			return service;
		};

		test("does not write a file when the transcript is empty", async () => {
			whisperReturns("");
			const plugin = createMockPlugin();

			await runTranscribeEpisode(plugin);

			expect(plugin.app.vault.create).not.toHaveBeenCalled();
		});

		test("does not write a file when the transcript is only whitespace", async () => {
			// Multiple empty chunks join to " ", not "", so the trimmed-emptiness check
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
						transcribeEpisode: (job: AudioJob) => Promise<void>;
					}
				).transcribeEpisode(audioJob);
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
					transcribeEpisode: (job: AudioJob) => Promise<void>;
				}
			).transcribeEpisode(audioJob);

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
						transcribeEpisode: (job: AudioJob) => Promise<void>;
					}
				)
					.transcribeEpisode(audioJob)
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
				transcribeEpisode: (job: AudioJob) => Promise<void>;
			};

			await service.transcribeEpisode(audioJob);
			vi.mocked(plugin.credentials.get).mockImplementation((_settings, kind) =>
				kind === "openai" ? "second-key" : null,
			);
			await service.transcribeEpisode(audioJob);

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

	describe("published transcripts", () => {
		const VTT =
			"WEBVTT\n\n00:00:00.480 --> 00:00:04.410\n<v Justin>Hello there.\n\n00:00:10.160 --> 00:00:12.000\n<v Michael>Hi!\n";
		const published: TranscriptLink[] = [
			{ url: "1.html", type: "text/html" },
			{ url: "1.vtt", type: "text/vtt" },
		];
		const link = (time: string) =>
			`obsidian://podnotes?episodeName=Test%20Episode&url=https%3A%2F%2Fexample.com%2Ffeed.xml&time=${time}`;
		const publishedNote =
			`# Test Episode\n\n[00:00:00](${link("0.48")}) **Justin:** Hello there.\n\n` +
			`[00:00:10](${link("10.16")}) **Michael:** Hi!`;
		const fromAudioOffer =
			' Run "Transcribe current episode from audio" to transcribe it with OpenAI instead, which uses your API credit.';

		let setMessage: MockInstance<Notice["setMessage"]>;
		beforeEach(() => {
			setMessage = vi.spyOn(Notice.prototype, "setMessage");
		});
		afterEach(() => {
			setMessage.mockRestore();
		});

		const timerMessages = () =>
			setMessage.mock.calls.map(([message]) => {
				const text = String(message);
				return text.slice(text.indexOf("\n\n") + 2);
			});
		const finished = (service: TranscriptionService, message: string) =>
			vi
				.waitFor(() => expect(timerMessages()).toContain(message))
				.finally(() => service.dispose());

		const withDeepgram = (plugin: PodNotes) => {
			plugin.settings.transcript.diarization = {
				enabled: true,
				provider: "deepgram",
				speakerTemplate: "",
			};
			vi.mocked(plugin.credentials.has).mockImplementation(
				(_settings, kind) => kind === "deepgram",
			);
			vi.mocked(plugin.credentials.get).mockImplementation((_settings, kind) =>
				kind === "deepgram" ? "deepgram-key" : null,
			);
			return plugin;
		};

		test("with no API key, the feed's VTT becomes the note with no audio and no provider", async () => {
			fetchTextMock.mockResolvedValue(VTT);
			const plugin = createMockPlugin({ openAIKey: "", transcripts: published });
			const service = new TranscriptionService(plugin);

			await service.transcribeCurrentEpisode();
			await finished(service, "Saved the transcript the feed publishes.");

			expect(plugin.feeds.load).toHaveBeenCalledWith(["Test Podcast"], "complete");
			expect(fetchTextMock).toHaveBeenCalledExactlyOnceWith(
				"https://example.com/1.vtt",
				expect.objectContaining({ acceptedStatuses: [200] }),
			);
			expect(plugin.app.vault.create).toHaveBeenCalledExactlyOnceWith(
				"Transcripts/Test Podcast/Test Episode.md",
				publishedNote,
			);
			expect(noticeMessages).toEqual([
				'Queued "Test Episode" for transcription. It will start automatically.',
				"Preparing to transcribe...",
			]);
			expect(getEpisodeAudioBufferMock).not.toHaveBeenCalled();
			expect(fetchMock).not.toHaveBeenCalled();
			expect(diarizeWithDeepgramMock).not.toHaveBeenCalled();
		});

		test("with a key and Deepgram diarization, the feed's transcript still wins", async () => {
			fetchTextMock.mockResolvedValue(VTT);
			const plugin = withDeepgram(createMockPlugin({ transcripts: published }));
			const service = new TranscriptionService(plugin);

			await service.transcribeCurrentEpisode();
			await finished(service, "Saved the transcript the feed publishes.");

			expect(vi.mocked(plugin.app.vault.create).mock.calls[0][1]).toBe(publishedNote);
			expect(getEpisodeAudioBufferMock).not.toHaveBeenCalled();
			expect(fetchMock).not.toHaveBeenCalled();
			expect(diarizeWithDeepgramMock).not.toHaveBeenCalled();
		});

		test("links of unknown types keep today's key notice", async () => {
			const plugin = createMockPlugin({
				openAIKey: "",
				transcripts: [{ url: "1.bin", type: "application/octet-stream" }],
			});

			await new TranscriptionService(plugin).transcribeCurrentEpisode();

			expect(noticeMessages).toEqual([
				"Select or create an OpenAI API key in the transcript settings on this device.",
			]);
			expect(fetchTextMock).not.toHaveBeenCalled();
		});

		test("a failed published transcript offers transcription from audio to a user with a key", async () => {
			fetchTextMock.mockRejectedValue(new NetworkError("unexpected-status", 404));
			const plugin = createMockPlugin({ transcripts: published });
			const service = new TranscriptionService(plugin);
			vi.spyOn(console, "error").mockImplementation(() => {});

			await service.transcribeCurrentEpisode();
			await finished(
				service,
				`The published transcript could not be fetched: Network response returned HTTP 404.${fromAudioOffer}`,
			);

			expect(plugin.app.vault.create).not.toHaveBeenCalled();
			expect(getEpisodeAudioBufferMock).not.toHaveBeenCalled();
			expect(fetchMock).not.toHaveBeenCalled();
		});

		test("the offer names Deepgram when diarization uses it", async () => {
			fetchTextMock.mockResolvedValue("WEBVTT\n");
			const service = new TranscriptionService(
				withDeepgram(createMockPlugin({ transcripts: published })),
			);
			vi.spyOn(console, "error").mockImplementation(() => {});

			await service.transcribeCurrentEpisode();
			await finished(
				service,
				`The published transcript could not be read.${fromAudioOffer.replace("OpenAI", "Deepgram")}`,
			);

			expect(diarizeWithDeepgramMock).not.toHaveBeenCalled();
			expect(getEpisodeAudioBufferMock).not.toHaveBeenCalled();
		});

		test("a failed published transcript without a key says only what failed", async () => {
			fetchTextMock.mockRejectedValue(new NetworkError("unexpected-status", 404));
			const plugin = createMockPlugin({ openAIKey: "", transcripts: published });
			const service = new TranscriptionService(plugin);
			vi.spyOn(console, "error").mockImplementation(() => {});

			await service.transcribeCurrentEpisode();
			await finished(
				service,
				"The published transcript could not be fetched: Network response returned HTTP 404.",
			);

			expect(timerMessages().some((message) => message.includes("from audio"))).toBe(false);
			expect(plugin.app.vault.create).not.toHaveBeenCalled();
			expect(getEpisodeAudioBufferMock).not.toHaveBeenCalled();
		});

		test("transcribing from audio never looks for a published transcript", async () => {
			whisperReturns("Spoken words.");
			const plugin = createMockPlugin({ transcripts: published });
			const service = new TranscriptionService(plugin);

			service.transcribeCurrentEpisodeFromAudio();
			await finished(service, "Transcription completed and saved.");

			expect(plugin.feeds.load).not.toHaveBeenCalled();
			expect(plugin.feeds.episodeMetadata).not.toHaveBeenCalled();
			expect(fetchTextMock).not.toHaveBeenCalled();
			expect(getEpisodeAudioBufferMock).toHaveBeenCalledOnce();
			expect(vi.mocked(plugin.app.vault.create).mock.calls[0][1]).toBe(
				"# Test Episode\n\nSpoken words.",
			);
		});

		test("transcribing from audio without a key shows today's key notice", () => {
			const plugin = createMockPlugin({ openAIKey: "", transcripts: published });

			new TranscriptionService(plugin).transcribeCurrentEpisodeFromAudio();

			expect(noticeMessages).toEqual([
				"Select or create an OpenAI API key in the transcript settings on this device.",
			]);
		});

		test("two runs during one feed lookup queue the episode once", async () => {
			const lookup = deferred<void>();
			fetchTextMock.mockResolvedValue(VTT);
			const plugin = createMockPlugin({
				transcripts: published,
				loadFeed: () => lookup.promise,
			});
			const service = new TranscriptionService(plugin);

			const first = service.transcribeCurrentEpisode();
			const second = service.transcribeCurrentEpisode();
			lookup.resolve();
			await Promise.all([first, second]);
			await finished(service, "Saved the transcript the feed publishes.");

			expect(noticeMessages).toEqual([
				'Queued "Test Episode" for transcription. It will start automatically.',
				"Preparing to transcribe...",
				"This episode is already queued or transcribing.",
			]);
			expect(fetchTextMock).toHaveBeenCalledOnce();
			expect(plugin.app.vault.create).toHaveBeenCalledOnce();
		});

		test("unloading during the feed lookup ends quietly", async () => {
			const lookup = deferred<void>();
			const plugin = createMockPlugin({
				transcripts: published,
				loadFeed: () => lookup.promise,
			});
			const service = new TranscriptionService(plugin);

			const pending = service.transcribeCurrentEpisode();
			service.dispose();
			lookup.resolve();
			await pending;

			expect(noticeMessages).toEqual([]);
			expect(fetchTextMock).not.toHaveBeenCalled();
			expect(plugin.app.vault.create).not.toHaveBeenCalled();
		});

		test("a private feed's secret URL reaches no notice, log or note", async () => {
			const secretFeed = "https://private.example.com/SENTINEL-s3cret/feed.xml?auth=SENTINEL";
			const privateEpisode = {
				...mockEpisode,
				feedUrl: privateFeedPlaceholder("Test Podcast"),
			};
			const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
			const transcribe = async (respond: () => Promise<string>, message: string) => {
				fetchTextMock.mockReset().mockImplementation(respond);
				const plugin = createMockPlugin({
					podcast: privateEpisode,
					transcripts: published,
					feedUrl: secretFeed,
				});
				const service = new TranscriptionService(plugin);
				await service.transcribeCurrentEpisode();
				await finished(service, message);
				expect(fetchTextMock).toHaveBeenCalledWith(
					"https://private.example.com/SENTINEL-s3cret/1.vtt",
					expect.anything(),
				);
				return plugin;
			};

			const saved = await transcribe(
				async () => VTT,
				"Saved the transcript the feed publishes.",
			);
			await transcribe(async () => {
				throw new NetworkError("transport-failure");
			}, `The published transcript could not be fetched: Network request failed.${fromAudioOffer}`);

			const note = String(vi.mocked(saved.app.vault.create).mock.calls[0][1]);
			expect(note).toContain(
				"[00:00:10](obsidian://podnotes?episodeName=Test%20Episode&url=",
			);
			expect(consoleError).toHaveBeenCalled();
			for (const shown of [note, ...noticeMessages, ...timerMessages()]) {
				expect(shown).not.toContain("SENTINEL");
			}
			for (const args of consoleError.mock.calls) {
				expect(args.map((arg) => String(arg))).not.toContainEqual(
					expect.stringContaining("SENTINEL"),
				);
			}
		});
	});
});
