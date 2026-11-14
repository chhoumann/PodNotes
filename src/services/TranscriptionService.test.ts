// @vitest-environment jsdom
import { describe, expect, onTestFinished, test, vi } from "vitest";
import { Notice, type RequestUrlParam } from "obsidian";
import { deferred, feedDocument, MemoryStorage } from "../../tests/mocks/feeds";
import {
	createMockPlugin,
	getEpisodeAudioBufferMock,
	installTranscriptionMocks,
	mockEpisode,
	noticeMessages,
} from "../../tests/mocks/transcriptionService";
import { MP3_STREAMS, mp3Bytes, mp3Seconds } from "../../tests/mocks/mp3";
import { providerMock, sentBytes, sentForm, sentText } from "../../tests/mocks/providerRequestUrl";
import { FeedRepository } from "./FeedRepository";
import { TranscriptionService } from "./TranscriptionService";
import type PodNotes from "src/main";
import type { Episode } from "src/types/Episode";
import type { LocalEpisode } from "src/types/LocalEpisode";
import type { PodcastFeed } from "src/types/PodcastFeed";
import { privateFeedPlaceholder } from "src/utility/privateFeedUrl";

vi.mock("obsidian", async (importOriginal) => {
	const { mockedObsidian } = await import("../../tests/mocks/transcriptionService");
	return mockedObsidian(await importOriginal<typeof import("obsidian")>());
});

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

vi.mock("../downloadEpisode", async () => ({
	getEpisodeAudioBuffer: (await import("../../tests/mocks/transcriptionService"))
		.getEpisodeAudioBufferMock,
}));

installTranscriptionMocks();

type AudioJob = { episode: Episode; source: { kind: "audio" } };
const audioJob: AudioJob = { episode: mockEpisode, source: { kind: "audio" } };

/** Runs one audio job to its end, as the queue does. */
const transcribe = (plugin: PodNotes, episode = mockEpisode) =>
	(
		new TranscriptionService(plugin) as unknown as {
			transcribeEpisode: (job: AudioJob) => Promise<void>;
		}
	).transcribeEpisode({ episode, source: { kind: "audio" } });

/** The last message of the job's progress notice, after every timer has run. */
const finalNotice = async (plugin: PodNotes, episode = mockEpisode): Promise<string> => {
	vi.useFakeTimers();
	const setMessage = vi.spyOn(Notice.prototype, "setMessage");
	const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
	try {
		const pending = transcribe(plugin, episode);
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

const savedNote = (plugin: PodNotes) =>
	String(vi.mocked(plugin.app.vault.create).mock.calls[0]?.[1]);

const openAIReturns = (text: string) =>
	providerMock.mockImplementation(async () => Response.json({ text }));

// Vitest's jsdom Request names every multipart file "blob", so these tests tell parts apart by size.
const sentFile = async (request: RequestUrlParam) => (await sentForm(request)).get("file") as File;

const openAIError = (status: number, error: Record<string, unknown>) => async () =>
	Response.json({ error }, { status });

const rateLimited = (headers: Record<string, string>) =>
	Response.json(
		{ error: { message: "Rate limit reached for requests.", code: "rate_limit_exceeded" } },
		{ status: 429, headers },
	);

/**
 * A feed repository with `feed` saved under its title. Loading it gives a document that
 * lists `episodes`, fetched from the address `resolveUrl` gives for the feed.
 */
function savedFeedRepository(
	feed: PodcastFeed,
	episodes: readonly Episode[],
	resolveUrl: (feed: Pick<PodcastFeed, "url">) => string | null = ({ url }) => url,
): FeedRepository {
	const feeds = new FeedRepository({
		load: async () => feedDocument(feed.title, episodes),
		resolveUrl,
		storage: new MemoryStorage(),
		now: Date.now,
	});
	feeds.setSubscriptions({ [feed.title]: feed });
	return feeds;
}

const publicFeed: PodcastFeed = {
	title: "Test Podcast",
	url: "https://example.com/feed.xml",
	artworkUrl: "",
};

/** An hour of MP3 in 3.2 MB, which OpenAI takes in two parts of 26 min 48 s. */
const twoPartStream = MP3_STREAMS.mpeg25At8Kbps;
const twoPartFrames = 44_668;
const twoPartAudio = () => ({
	buffer: mp3Bytes(twoPartStream, twoPartFrames).buffer,
	extension: "mp3",
});

describe("TranscriptionService", () => {
	describe("transcribeCurrentEpisode validation", () => {
		test("shows notice when no API key is configured", async () => {
			const mockPlugin = createMockPlugin({ openAIKey: "" });
			const service = new TranscriptionService(mockPlugin);

			await service.transcribeCurrentEpisode();

			expect(noticeMessages).toEqual([
				"Select or create an OpenAI API key in the transcript settings on this device.",
			]);
		});

		test("asks for the Deepgram key when speaker labels use Deepgram", async () => {
			const service = new TranscriptionService(createMockPlugin({ speakers: "deepgram" }));

			await service.transcribeCurrentEpisode();

			expect(noticeMessages).toEqual([
				"Select or create a Deepgram API key in the transcript settings on this device.",
			]);
		});

		test("refuses an episode whose note is already at the transcript path", async () => {
			const path = "Transcripts/Test Podcast/Test Episode.md";
			const service = new TranscriptionService(
				createMockPlugin({ existingTranscriptPath: path }),
			);

			await service.transcribeCurrentEpisode();

			expect(noticeMessages).toEqual([
				`You've already transcribed this episode - found ${path}.`,
			]);
			expect(getEpisodeAudioBufferMock).not.toHaveBeenCalled();
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

			expect(getEpisodeAudioBufferMock).not.toHaveBeenCalled();
			expect(plugin.credentials.get).not.toHaveBeenCalled();
		});

		test("settles promptly when unloaded during audio acquisition", async () => {
			const audioRequest = deferred<{ buffer: ArrayBuffer; extension: string }>();
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

		test("sends nothing for audio that arrives after unload", async () => {
			const audioRequest = deferred<{ buffer: ArrayBuffer; extension: string }>();
			getEpisodeAudioBufferMock.mockReturnValue(audioRequest.promise);
			const service = new TranscriptionService(createMockPlugin());
			const pending = (
				service as unknown as {
					transcribeEpisode: (job: AudioJob) => Promise<void>;
				}
			).transcribeEpisode(audioJob);
			await vi.waitFor(() => expect(getEpisodeAudioBufferMock).toHaveBeenCalledOnce());

			service.dispose();
			await pending;
			audioRequest.resolve({ buffer: new ArrayBuffer(1024), extension: "mp3" });
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(providerMock).not.toHaveBeenCalled();
		});

		test("decodes no audio that arrives after unload", async () => {
			const audioRequest = deferred<{ buffer: ArrayBuffer; extension: string }>();
			getEpisodeAudioBufferMock.mockReturnValue(audioRequest.promise);
			// A count, because a failed assertion on the call would print its 24 MB argument.
			let decodes = 0;
			vi.stubGlobal(
				"AudioContext",
				class {
					async decodeAudioData(): Promise<never> {
						decodes++;
						throw new Error("Unsupported codec");
					}
					async close(): Promise<void> {}
				},
			);
			const service = new TranscriptionService(createMockPlugin());
			const pending = (
				service as unknown as {
					transcribeEpisode: (job: AudioJob) => Promise<void>;
				}
			).transcribeEpisode(audioJob);
			await vi.waitFor(() => expect(getEpisodeAudioBufferMock).toHaveBeenCalledOnce());

			service.dispose();
			await pending;
			// Over OpenAI's size cap, so it would be decoded into WAV parts.
			audioRequest.resolve({ buffer: new ArrayBuffer(24_000_001), extension: "ogg" });
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(decodes).toBe(0);
		});

		test("decodes no audio whose length its metadata gives after unload", async () => {
			getEpisodeAudioBufferMock.mockResolvedValue({
				buffer: new ArrayBuffer(4096),
				extension: "m4a",
			});
			// Longer than OpenAI's length cap, so it would be decoded into WAV parts.
			const duration = vi
				.spyOn(HTMLMediaElement.prototype, "duration", "get")
				.mockReturnValue(3000);
			// The probe's element loads nothing until the test fires its metadata.
			let probe: HTMLElement | undefined;
			const createElement = document.createElement.bind(document);
			const create = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
				const element = createElement(tag);
				if (tag === "audio") probe = element;
				return element;
			});
			const src = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
			Object.defineProperty(HTMLMediaElement.prototype, "src", { ...src, set() {} });
			onTestFinished(() => {
				duration.mockRestore();
				create.mockRestore();
				if (src) Object.defineProperty(HTMLMediaElement.prototype, "src", src);
			});
			let decodes = 0;
			vi.stubGlobal(
				"AudioContext",
				class {
					async decodeAudioData(): Promise<never> {
						decodes++;
						throw new Error("Unsupported codec");
					}
					async close(): Promise<void> {}
				},
			);
			const service = new TranscriptionService(createMockPlugin());
			const pending = (
				service as unknown as {
					transcribeEpisode: (job: AudioJob) => Promise<void>;
				}
			).transcribeEpisode(audioJob);
			await vi.waitFor(() => expect(probe).toBeDefined());

			service.dispose();
			probe?.dispatchEvent(new Event("loadedmetadata"));
			await pending;
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(decodes).toBe(0);
		});

		test("downloads no audio when unloaded while it looks the episode up in its feed", async () => {
			const lookup = deferred<ReturnType<typeof feedDocument>>();
			const load = vi.fn(() => lookup.promise);
			const feeds = new FeedRepository({
				load,
				resolveUrl: ({ url }) => url,
				storage: new MemoryStorage(),
				now: Date.now,
			});
			feeds.setSubscriptions({ [publicFeed.title]: publicFeed });
			const service = new TranscriptionService(
				createMockPlugin({ speakers: "deepgram", deepgramKey: "deepgram-key", feeds }),
			);
			const pending = (
				service as unknown as {
					transcribeEpisode: (job: AudioJob) => Promise<void>;
				}
			).transcribeEpisode(audioJob);
			await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());

			service.dispose();
			await pending;
			// The feed does not list the episode, so its audio would be uploaded.
			lookup.resolve(feedDocument(publicFeed.title, []));
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(getEpisodeAudioBufferMock).not.toHaveBeenCalled();
			expect(providerMock).not.toHaveBeenCalled();
		});

		test.each([
			["OpenAI", {}, { text: "This must not be saved." }],
			[
				"Deepgram",
				{ speakers: "deepgram", deepgramKey: "deepgram-key" } as const,
				deepgramAnswer([{ word: "Unsaved.", start: 0, end: 1, speaker: 0 }]),
			],
		])(
			"aborts active %s work without writing a note or updating notices",
			async (_provider, overrides, answer) => {
				const plugin = createMockPlugin(overrides);
				const service = new TranscriptionService(plugin);
				let finishRequest!: (response: Response) => void;
				providerMock.mockImplementation(
					() =>
						new Promise((resolve) => {
							finishRequest = resolve;
						}),
				);
				const setMessage = vi.spyOn(Notice.prototype, "setMessage");
				const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
				try {
					const pending = (
						service as unknown as {
							transcribeEpisode: (job: AudioJob) => Promise<void>;
						}
					).transcribeEpisode(audioJob);
					await vi.waitFor(() => expect(providerMock).toHaveBeenCalledOnce());

					const messagesBeforeDispose = setMessage.mock.calls.length;
					service.dispose();
					const settledPromptly = await settlesAfterMicrotasks(pending);
					finishRequest(Response.json(answer));
					await pending;

					expect(settledPromptly).toBe(true);
					expect(plugin.app.vault.create).not.toHaveBeenCalled();
					expect(setMessage).toHaveBeenCalledTimes(messagesBeforeDispose);
					expect(consoleError).not.toHaveBeenCalled();
				} finally {
					setMessage.mockRestore();
					consoleError.mockRestore();
				}
			},
		);

		test("cancels a completed notice hide timer when disposed", async () => {
			vi.useFakeTimers();
			const hide = vi.spyOn(Notice.prototype, "hide");
			try {
				openAIReturns("Completed transcript.");
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

	describe("the progress notice", () => {
		const hiddenAfter = async (plugin: PodNotes, ms: number): Promise<boolean> => {
			vi.useFakeTimers();
			const hide = vi.spyOn(Notice.prototype, "hide");
			const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
			try {
				await transcribe(plugin);
				await vi.advanceTimersByTimeAsync(ms);
				return hide.mock.calls.length > 0;
			} finally {
				hide.mockRestore();
				consoleError.mockRestore();
				vi.useRealTimers();
			}
		};

		test("hides 5 s after a transcript is saved", async () => {
			openAIReturns("Completed transcript.");

			expect(await hiddenAfter(createMockPlugin(), 5000)).toBe(true);
		});

		test("stays until clicked after a failure", async () => {
			providerMock.mockImplementation(openAIError(401, { message: "Incorrect API key." }));

			expect(await hiddenAfter(createMockPlugin(), 60 * 60_000)).toBe(false);
		});
	});

	describe("an OpenAI transcript", () => {
		test("sends OpenAI the model, the episode file and the JSON format", async () => {
			openAIReturns("Hello.");

			await transcribe(createMockPlugin());

			expect(providerMock).toHaveBeenCalledOnce();
			const [request] = providerMock.mock.calls[0];
			expect(request.url).toBe("https://api.openai.com/v1/audio/transcriptions");
			expect(request.method).toBe("POST");
			expect(request.headers).toEqual({ Authorization: "Bearer test-api-key" });
			const form = await sentForm(request);
			expect([...form.keys()]).toEqual(["model", "file", "response_format"]);
			expect(form.get("model")).toBe("gpt-transcribe");
			expect(form.get("response_format")).toBe("json");
			const file = form.get("file") as File;
			expect(file.type).toBe("audio/mp3");
			expect(file.size).toBe(1024);
		});

		test("is saved as paragraphs without timestamps", async () => {
			const sentence = "This sentence is forty characters long. ";
			openAIReturns(sentence.repeat(20));
			const plugin = createMockPlugin();

			await expect(finalNotice(plugin)).resolves.toBe("Transcription completed and saved.");

			const paragraph = sentence.repeat(13).trim();
			expect(plugin.app.vault.create).toHaveBeenCalledExactlyOnceWith(
				"Transcripts/Test Podcast/Test Episode.md",
				`# Test Episode\n\n${paragraph}\n\n${sentence.repeat(7).trim()}`,
			);
		});

		test.each(["", "   \n\t  "])("writes no note for the text %j", async (text) => {
			openAIReturns(text);
			const plugin = createMockPlugin();

			await expect(finalNotice(plugin)).resolves.toBe(
				"Transcription failed: OpenAI found no speech in this episode.",
			);

			expect(plugin.app.vault.create).not.toHaveBeenCalled();
		});

		test("with speaker labels on is saved without them, and the notice names the providers that label speakers and stays", async () => {
			vi.useFakeTimers();
			const hide = vi.spyOn(Notice.prototype, "hide");
			const setMessage = vi.spyOn(Notice.prototype, "setMessage");
			try {
				openAIReturns("Hello there. Hi!");
				const plugin = createMockPlugin({ speakers: "openai" });

				await transcribe(plugin);
				await vi.advanceTimersByTimeAsync(60 * 60_000);

				expect(String(setMessage.mock.calls.at(-1)?.[0])).toMatch(
					/\n\nSaved without speaker labels, because OpenAI does not label speakers\. These providers do: Deepgram\.$/,
				);
				expect(hide).not.toHaveBeenCalled();
				expect(savedNote(plugin)).toBe("# Test Episode\n\nHello there. Hi!");
				const form = await sentForm(providerMock.mock.calls[0][0]);
				expect([...form.keys()]).toEqual(["model", "file", "response_format"]);
				expect(form.get("model")).toBe("gpt-transcribe");
			} finally {
				hide.mockRestore();
				setMessage.mockRestore();
				vi.useRealTimers();
			}
		});

		test("reads the current OpenAI key for each transcription", async () => {
			openAIReturns("Hello.");
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
				providerMock.mock.calls[call][0].headers?.Authorization;
			expect(providerMock).toHaveBeenCalledTimes(2);
			expect(authorization(0)).toBe("Bearer first-key");
			expect(authorization(1)).toBe("Bearer second-key");
		});
	});

	describe("an episode over one request's limits", () => {
		test("goes to OpenAI in parts no longer than 2,070 s, one at a time, and reads in order", async () => {
			getEpisodeAudioBufferMock.mockResolvedValue(twoPartAudio());
			const sentSeconds: number[] = [];
			let inFlight = 0;
			let mostInFlight = 0;
			providerMock.mockImplementation(async (request) => {
				mostInFlight = Math.max(mostInFlight, ++inFlight);
				const seconds = mp3Seconds(twoPartStream, (await sentFile(request)).size);
				sentSeconds.push(seconds);
				await new Promise((resolve) => setTimeout(resolve, 0));
				inFlight--;
				return Response.json({ text: `Part ${sentSeconds.length}.` });
			});
			const plugin = createMockPlugin();

			await transcribe(plugin);

			expect(sentSeconds).toHaveLength(2);
			expect(Math.max(...sentSeconds)).toBeLessThanOrEqual(2070);
			expect(sentSeconds[0] + sentSeconds[1]).toBeCloseTo(
				mp3Seconds(twoPartStream, twoPartFrames * twoPartStream.frameBytes),
			);
			expect(mostInFlight).toBe(1);
			expect(savedNote(plugin)).toBe("# Test Episode\n\nPart 1. Part 2.");
		});

		test("keeps the parts that worked, marks the one that failed, and says so", async () => {
			getEpisodeAudioBufferMock.mockResolvedValue(twoPartAudio());
			let sends = 0;
			providerMock.mockImplementation(async () =>
				++sends === 1
					? Response.json({ text: "Good part." })
					: new Response("boom", { status: 500 }),
			);
			const plugin = createMockPlugin();

			await expect(finalNotice(plugin)).resolves.toBe(
				"Transcription saved, but 1 of 2 chunk(s) failed - look for [Error transcribing chunk N] markers and re-run after deleting the note to retry.",
			);

			expect(sends).toBe(4);
			expect(savedNote(plugin)).toBe(
				"# Test Episode\n\nGood part. \\[Error transcribing chunk 2]",
			);
		});

		test("writes no note when one part fails and the other holds no speech", async () => {
			getEpisodeAudioBufferMock.mockResolvedValue(twoPartAudio());
			let sends = 0;
			providerMock.mockImplementation(async () =>
				++sends <= 3 ? new Response("boom", { status: 500 }) : Response.json({ text: " " }),
			);
			const plugin = createMockPlugin();

			await expect(finalNotice(plugin)).resolves.toBe(
				"Transcription failed: OpenAI failed (HTTP 500). Try again later.",
			);

			expect(plugin.app.vault.create).not.toHaveBeenCalled();
		});

		test.each([401, 402, 404, 400])(
			"stops at a %i on the first part and sends no second part",
			async (status) => {
				getEpisodeAudioBufferMock.mockResolvedValue(twoPartAudio());
				providerMock.mockImplementation(openAIError(status, { message: "No." }));
				const plugin = createMockPlugin();

				await finalNotice(plugin);

				expect(providerMock).toHaveBeenCalledOnce();
				expect(plugin.app.vault.create).not.toHaveBeenCalled();
			},
		);
	});

	describe("a failed request", () => {
		const neverAnswers = () => new Promise<Response>(() => {});
		const quotaUsedUp = openAIError(429, {
			message: "You exceeded your current quota, please check your plan and billing details.",
			type: "insufficient_quota",
			code: "insufficient_quota",
		});

		test.each<[name: string, sends: number, respond: () => Promise<Response>, shown: string]>([
			[
				"401",
				1,
				openAIError(401, { message: "Incorrect API key provided: sk-test." }),
				"OpenAI rejected the API key. Check it in the transcript settings.",
			],
			[
				"402",
				1,
				openAIError(402, { message: "Payment required." }),
				"Your OpenAI account is out of credit. Add credit there, then try again.",
			],
			[
				"404",
				1,
				openAIError(404, { message: "The model `gpt-transcribe` does not exist." }),
				"OpenAI does not offer the gpt-transcribe model to this API key.",
			],
			[
				"400",
				1,
				openAIError(400, { message: "Audio file might be corrupted or unsupported." }),
				"OpenAI could not transcribe this audio.",
			],
			[
				"429 for a used-up quota",
				1,
				quotaUsedUp,
				"Your OpenAI account is out of credit. Add credit there, then try again.",
			],
			[
				"429",
				3,
				async () => rateLimited({}),
				"OpenAI is limiting how fast your key may be used. Try again in a few minutes.",
			],
			[
				"503 with an empty body",
				3,
				async () => new Response("", { status: 503 }),
				"OpenAI failed (HTTP 503). Try again later.",
			],
			[
				"200 that is not JSON",
				3,
				async () => new Response("<html>Sign in</html>"),
				"OpenAI failed (HTTP 200). Try again later.",
			],
			[
				"lost connection",
				3,
				() => Promise.reject(new TypeError("Failed to fetch")),
				"Could not reach OpenAI. Check your connection.",
			],
			[
				"429 that asks to wait over a minute",
				1,
				async () => rateLimited({ "retry-after": "61" }),
				"OpenAI is limiting how fast your key may be used. Try again in a few minutes.",
			],
			["timeout", 1, neverAnswers, "OpenAI did not answer within 10 minutes."],
		])("%s saves no note after %i of 3 sends", async (_name, sends, respond, shown) => {
			providerMock.mockImplementation(respond);
			const plugin = createMockPlugin();

			await expect(finalNotice(plugin)).resolves.toBe(`Transcription failed: ${shown}`);

			expect(providerMock).toHaveBeenCalledTimes(sends);
			expect(plugin.app.vault.create).not.toHaveBeenCalled();
		});

		test.each<[name: string, failure: () => Response, waitMs: number]>([
			["429 with Retry-After", () => rateLimited({ "retry-after": "4" }), 4000],
			["429 with retry-after-ms", () => rateLimited({ "retry-after-ms": "1500" }), 1500],
			["503", () => new Response("", { status: 503 }), 1000],
		])("%s is sent again after the wait and the note is saved", async (_name, fail, waitMs) => {
			vi.useFakeTimers();
			try {
				const sentAt: number[] = [];
				providerMock.mockImplementation(async () => {
					sentAt.push(Date.now());
					return sentAt.length === 1 ? fail() : Response.json({ text: "Recovered." });
				});
				const plugin = createMockPlugin();

				const pending = transcribe(plugin);
				await vi.runAllTimersAsync();
				await pending;

				expect(sentAt.map((time) => time - sentAt[0])).toEqual([0, waitMs]);
				expect(savedNote(plugin)).toBe("# Test Episode\n\nRecovered.");
			} finally {
				vi.useRealTimers();
			}
		});

		test("unloading during a Retry-After wait cancels the run", async () => {
			vi.useFakeTimers();
			const setMessage = vi.spyOn(Notice.prototype, "setMessage");
			try {
				providerMock.mockImplementation(async () => rateLimited({ "retry-after": "30" }));
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
				expect(providerMock).toHaveBeenCalledOnce();

				const messagesBeforeDispose = setMessage.mock.calls.length;
				service.dispose();
				await vi.advanceTimersByTimeAsync(0);

				expect(settled).toBe(true);
				await pending;
				await vi.advanceTimersByTimeAsync(60_000);
				expect(providerMock).toHaveBeenCalledOnce();
				expect(plugin.app.vault.create).not.toHaveBeenCalled();
				expect(setMessage).toHaveBeenCalledTimes(messagesBeforeDispose);
			} finally {
				setMessage.mockRestore();
				vi.useRealTimers();
			}
		});

		test("shows and logs none of the provider's own words, which can quote a private address", async () => {
			vi.useFakeTimers();
			const setMessage = vi.spyOn(Notice.prototype, "setMessage");
			const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
			try {
				providerMock.mockImplementation(async () =>
					Response.json(
						{
							err_code: "Bad Request",
							err_msg: "Could not read https://private.example.com/feed/SENTINEL.mp3",
						},
						{ status: 400 },
					),
				);
				const plugin = createMockPlugin({
					speakers: "deepgram",
					deepgramKey: "deepgram-key",
				});

				const pending = transcribe(plugin);
				await vi.runAllTimersAsync();
				await pending;

				const shown = setMessage.mock.calls.map(([message]) => String(message));
				expect(shown.at(-1)).toMatch(
					/\n\nTranscription failed: Deepgram could not transcribe this audio\.$/,
				);
				expect(consoleError).toHaveBeenCalled();
				const logged = consoleError.mock.calls.flatMap((args) =>
					args.map((arg) => (arg instanceof Error ? `${arg.stack}` : String(arg))),
				);
				for (const text of [...shown, ...noticeMessages, ...logged]) {
					expect(text).not.toContain("SENTINEL");
				}
			} finally {
				setMessage.mockRestore();
				consoleError.mockRestore();
				vi.useRealTimers();
			}
		});
	});

	describe("a Deepgram transcript", () => {
		const audio = new Uint8Array(2048).map((_, index) => (index * 31) % 251);
		const useDeepgram = (feeds?: ReturnType<typeof savedFeedRepository>) => {
			getEpisodeAudioBufferMock.mockResolvedValue({
				buffer: audio.buffer,
				extension: "mp3",
			});
			return createMockPlugin({ speakers: "deepgram", deepgramKey: "deepgram-key", feeds });
		};
		const answers = deepgramAnswer([
			{ word: "hello", punctuated_word: "Hello", start: 1.2, end: 1.5, speaker: 1 },
			{ word: "there", punctuated_word: "there.", start: 1.5, end: 1.9, speaker: 1 },
			{ word: "hi", punctuated_word: "Hi!", start: 10.16, end: 10.5, speaker: 0 },
		]);
		const link = (time: string) =>
			`obsidian://podnotes?episodeName=Test%20Episode&url=https%3A%2F%2Fexample.com%2Ffeed.xml&time=${time}`;
		const LISTEN =
			"https://api.deepgram.com/v1/listen?model=nova-3&diarize=true&punctuate=true&smart_format=true&utterances=true";

		/** The one request a job sent, which must carry the audio and nothing of `secrets`. */
		const expectUpload = (...secrets: string[]) => {
			expect(providerMock).toHaveBeenCalledOnce();
			const [request] = providerMock.mock.calls[0];
			expect(request.contentType).toBe("audio/mp3");
			expect(sentBytes(request)).toEqual(audio);
			for (const secret of secrets) expect(sentText(request)).not.toContain(secret);
		};

		test("has a timestamp on each paragraph and numbers the speakers in the order they first speak", async () => {
			providerMock.mockImplementation(async () => Response.json(answers));
			const plugin = useDeepgram();

			await expect(finalNotice(plugin)).resolves.toBe("Transcription completed and saved.");

			expect(savedNote(plugin)).toBe(
				`# Test Episode\n\n[00:00:01](${link("1.2")}) **1:** Hello there.\n\n` +
					`[00:00:10](${link("10.16")}) **2:** Hi!`,
			);
		});

		test("a public episode goes by its address, and its audio is never loaded", async () => {
			providerMock.mockImplementation(async () => Response.json(answers));
			const plugin = useDeepgram(savedFeedRepository(publicFeed, [mockEpisode]));

			await transcribe(plugin);

			expect(getEpisodeAudioBufferMock).not.toHaveBeenCalled();
			expect(providerMock).toHaveBeenCalledOnce();
			const [request] = providerMock.mock.calls[0];
			expect(request.url).toBe(LISTEN);
			expect(request.method).toBe("POST");
			expect(request.headers).toEqual({ Authorization: "Token deepgram-key" });
			expect(request.contentType).toBe("application/json");
			expect(JSON.parse(new TextDecoder().decode(sentBytes(request)))).toEqual({
				url: "https://example.com/episode.mp3",
			});
			expect(savedNote(plugin)).toContain("**1:** Hello there.");
		});

		test("an episode with no saved feed is uploaded as the released request", async () => {
			providerMock.mockImplementation(async () => Response.json(answers));
			const plugin = useDeepgram();

			await transcribe(plugin);

			expectUpload();
			const [request] = providerMock.mock.calls[0];
			expect(request.url).toBe(LISTEN);
			expect(request.headers).toEqual({ Authorization: "Token deepgram-key" });
		});

		test("a private feed's episode is uploaded, and no request holds its address or its feed's", async () => {
			providerMock.mockImplementation(async () => Response.json(answers));
			const secretFeed = "https://private.example.com/feed/SUBSCRIBER-TOKEN.rss";
			const privateFeed: PodcastFeed = {
				...publicFeed,
				url: privateFeedPlaceholder("Test Podcast"),
				urlSecretId: "podnotes-feed-url-1",
			};
			const episode: Episode = {
				...mockEpisode,
				streamUrl: "https://cdn.example.com/SUBSCRIBER-TOKEN/episode.mp3",
				feedUrl: privateFeed.url,
			};
			const plugin = useDeepgram(
				savedFeedRepository(privateFeed, [episode], () => secretFeed),
			);

			await transcribe(plugin, episode);

			expectUpload("SUBSCRIBER-TOKEN", "cdn.example.com", "private.example.com");
		});

		test("an episode whose address carries a credential is uploaded, and no request holds the address", async () => {
			providerMock.mockImplementation(async () => Response.json(answers));
			const episode: Episode = {
				...mockEpisode,
				streamUrl: "https://cdn.example.com/episode.mp3?token=SIGNED-TOKEN",
			};
			const plugin = useDeepgram(savedFeedRepository(publicFeed, [episode]));

			await transcribe(plugin, episode);

			expectUpload("SIGNED-TOKEN", "cdn.example.com");
		});

		test.each([
			[
				"AWS",
				"X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=CRED&X-Amz-Signature=SIGNED",
			],
			[
				"Google Cloud",
				"X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=CRED&X-Goog-Signature=SIGNED",
			],
			["CloudFront", "Expires=1900000000&Signature=SIGNED&Key-Pair-Id=CRED"],
			["Azure", "sv=2024-11-04&se=2030-01-01&sp=r&sig=SIGNED"],
			["Akamai query token", "hdnts=exp=1900000000~acl=/*~hmac=SIGNED"],
			["Akamai cookie token", "hdnea=exp=1900000000~acl=/*~hmac=SIGNED"],
		])(
			"an episode whose address is a %s signed URL is uploaded, and no request holds the address",
			async (_, query) => {
				providerMock.mockImplementation(async () => Response.json(answers));
				const episode: Episode = {
					...mockEpisode,
					streamUrl: `https://cdn.example.com/episode.mp3?${query}`,
				};
				const plugin = useDeepgram(savedFeedRepository(publicFeed, [episode]));

				await transcribe(plugin, episode);

				expectUpload("SIGNED", "cdn.example.com");
			},
		);

		test("a public episode whose address has tracking parameters goes by its address", async () => {
			providerMock.mockImplementation(async () => Response.json(answers));
			const streamUrl =
				"https://cdn.example.com/episode.mp3?aid=rss_feed&feed=AbC123&updated=1700000000&utm_source=podcast";
			const episode: Episode = { ...mockEpisode, streamUrl };
			const plugin = useDeepgram(savedFeedRepository(publicFeed, [episode]));

			await transcribe(plugin, episode);

			expect(getEpisodeAudioBufferMock).not.toHaveBeenCalled();
			const [request] = providerMock.mock.calls[0];
			expect(JSON.parse(new TextDecoder().decode(sentBytes(request)))).toEqual({
				url: streamUrl,
			});
		});

		test("an episode on a private network is uploaded, and no request holds its address", async () => {
			providerMock.mockImplementation(async () => Response.json(answers));
			const episode: Episode = {
				...mockEpisode,
				streamUrl: "http://192.168.1.20/library/episode.mp3",
			};
			const plugin = useDeepgram(savedFeedRepository(publicFeed, [episode]));

			await transcribe(plugin, episode);

			expectUpload("192.168.1.20", "library");
		});

		test("an episode its saved feed does not list is uploaded, and no request holds its address", async () => {
			providerMock.mockImplementation(async () => Response.json(answers));
			const unlisted: Episode = {
				...mockEpisode,
				streamUrl: "https://elsewhere.example.com/episode.mp3",
			};
			const plugin = useDeepgram(savedFeedRepository(publicFeed, [mockEpisode]));

			await transcribe(plugin, unlisted);

			expectUpload("elsewhere.example.com");
		});

		test("a local file is uploaded, and no request holds its path", async () => {
			providerMock.mockImplementation(async () => Response.json(answers));
			const local: LocalEpisode = {
				title: "Interview",
				streamUrl: "app://f3a9/home/me/vault/Recordings/Interview.mp3?1700000000000",
				url: "[[Recordings/Interview.mp3]]",
				description: "",
				content: "",
				podcastName: "local file",
				filePath: "Recordings/Interview.mp3",
			};
			const plugin = useDeepgram(savedFeedRepository(publicFeed, [mockEpisode]));

			await transcribe(plugin, local);

			expectUpload("Recordings", "Interview", "app://", "vault");
		});

		test("an address Deepgram could not fetch is followed by one upload", async () => {
			providerMock.mockImplementation(async (request) =>
				request.contentType === "application/json"
					? Response.json(
							{
								err_code: "REMOTE_CONTENT_ERROR",
								err_msg:
									"The remote server hosting the media returned a client error: 403 Forbidden.",
							},
							{ status: 400 },
						)
					: Response.json(answers),
			);
			const plugin = useDeepgram(savedFeedRepository(publicFeed, [mockEpisode]));

			await expect(finalNotice(plugin)).resolves.toBe("Transcription completed and saved.");

			expect(providerMock.mock.calls.map(([request]) => request.contentType)).toEqual([
				"application/json",
				"audio/mp3",
			]);
			expect(sentBytes(providerMock.mock.calls[1][0])).toEqual(audio);
			expect(getEpisodeAudioBufferMock).toHaveBeenCalledOnce();
			expect(savedNote(plugin)).toContain("**1:** Hello there.");
		});

		test.each([
			[401, "Deepgram rejected the API key. Check it in the transcript settings."],
			[400, "Deepgram could not transcribe this audio."],
		])("a %i for a request by address is not followed by an upload", async (status, shown) => {
			providerMock.mockImplementation(async () =>
				Response.json({ err_code: "INVALID_AUTH", err_msg: "No." }, { status }),
			);
			const plugin = useDeepgram(savedFeedRepository(publicFeed, [mockEpisode]));

			await expect(finalNotice(plugin)).resolves.toBe(`Transcription failed: ${shown}`);

			expect(providerMock).toHaveBeenCalledOnce();
			expect(getEpisodeAudioBufferMock).not.toHaveBeenCalled();
			expect(plugin.app.vault.create).not.toHaveBeenCalled();
		});

		test("an answer without words writes no note", async () => {
			providerMock.mockImplementation(async () => Response.json(deepgramAnswer([])));
			const plugin = useDeepgram();

			await expect(finalNotice(plugin)).resolves.toBe(
				"Transcription failed: Deepgram found no speech in this episode.",
			);

			expect(plugin.app.vault.create).not.toHaveBeenCalled();
		});
	});
});

function deepgramAnswer(words: Record<string, unknown>[]) {
	return { results: { channels: [{ alternatives: [{ words }] }] } };
}
