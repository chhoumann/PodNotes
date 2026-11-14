// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { Notice, type RequestUrlParam } from "obsidian";
import { deferred, feedDocument, MemoryStorage } from "../../tests/mocks/feeds";
import {
	createMockPlugin,
	getEpisodeAudioBufferMock,
	installTranscriptionMocks,
	mockEpisode,
	noticeMessages,
} from "../../tests/mocks/transcriptionService";
import { MP3_STREAMS, mp3Bytes, mp3Seconds, voicedMp3Bytes } from "../../tests/mocks/mp3";
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

		test("asks for the key of the provider the settings choose", async () => {
			const service = new TranscriptionService(createMockPlugin({ provider: "deepgram" }));

			await service.transcribeCurrentEpisode();

			expect(noticeMessages).toEqual([
				"Select or create a Deepgram API key in the transcript settings on this device.",
			]);
		});

		test.each([
			[
				"Transcribe current episode",
				(service: TranscriptionService) => service.transcribeCurrentEpisode(),
			],
			[
				"Transcribe current episode from audio",
				(service: TranscriptionService) => service.transcribeCurrentEpisodeFromAudio(),
			],
		])(
			"%s refuses a provider this version does not have, and sends nothing",
			async (_command, run) => {
				const plugin = createMockPlugin({
					provider: "assemblyai",
					model: "universal-3-6-pro",
				});

				await run(new TranscriptionService(plugin));

				expect(noticeMessages).toEqual([
					"This version of PodNotes cannot transcribe with assemblyai. Update PodNotes, or choose another provider in the transcript settings.",
				]);
				expect(getEpisodeAudioBufferMock).not.toHaveBeenCalled();
				expect(providerMock).not.toHaveBeenCalled();
				expect(plugin.settings.transcript).toMatchObject({
					provider: "assemblyai",
					model: "universal-3-6-pro",
				});
			},
		);

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
				createMockPlugin({
					provider: "deepgram",
					speakers: true,
					deepgramKey: "deepgram-key",
					feeds,
				}),
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
				{ provider: "deepgram", speakers: true, deepgramKey: "deepgram-key" } as const,
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
				const plugin = createMockPlugin({ speakers: true });

				await transcribe(plugin);
				await vi.advanceTimersByTimeAsync(60 * 60_000);

				expect(String(setMessage.mock.calls.at(-1)?.[0])).toMatch(
					/\n\nSaved without speaker labels, because OpenAI does not label speakers\. These providers do: ElevenLabs, Deepgram, OpenRouter\.$/,
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

		test("a model this version does not have runs the recommended model, and the notice says so", async () => {
			openAIReturns("Hello there.");
			const plugin = createMockPlugin({ model: "gpt-transcribe-2" });

			await expect(finalNotice(plugin)).resolves.toBe(
				"This version of PodNotes has no gpt-transcribe-2 model, so OpenAI used GPT Transcribe.",
			);

			const form = await sentForm(providerMock.mock.calls[0][0]);
			expect(form.get("model")).toBe("gpt-transcribe");
			expect(savedNote(plugin)).toBe("# Test Episode\n\nHello there.");
			expect(plugin.settings.transcript.model).toBe("gpt-transcribe-2");
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
					provider: "deepgram",
					speakers: true,
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
			return createMockPlugin({
				provider: "deepgram",
				speakers: true,
				deepgramKey: "deepgram-key",
				feeds,
			});
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

		test("with speaker labels off asks Deepgram for none, and the note names no speaker", async () => {
			providerMock.mockImplementation(async () => Response.json(answers));
			const plugin = createMockPlugin({ provider: "deepgram", deepgramKey: "deepgram-key" });

			await expect(finalNotice(plugin)).resolves.toBe("Transcription completed and saved.");

			expect(providerMock.mock.calls[0][0].url).toBe(
				LISTEN.replace("diarize=true", "diarize=false"),
			);
			expect(savedNote(plugin)).toBe(
				`# Test Episode\n\n[00:00:01](${link("1.2")}) Hello there.\n\n` +
					`[00:00:10](${link("10.16")}) Hi!`,
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

	describe("an ElevenLabs transcript", () => {
		const audio = new Uint8Array(2048).map((_, index) => (index * 17) % 239);
		const useElevenLabs = (
			overrides: { speakers?: boolean; feeds?: ReturnType<typeof savedFeedRepository> } = {},
		) => {
			getEpisodeAudioBufferMock.mockResolvedValue({
				buffer: audio.buffer,
				extension: "mp3",
			});
			return createMockPlugin({
				provider: "elevenlabs",
				elevenLabsKey: "elevenlabs-key",
				speakers: true,
				...overrides,
			});
		};
		const word = (text: string, start: number, end: number, speaker: string | null) => ({
			text,
			type: "word",
			start,
			end,
			speaker_id: speaker,
			logprob: -0.1,
		});
		const spacing = (start: number, end: number, speaker: string | null) => ({
			text: " ",
			type: "spacing",
			start,
			end,
			speaker_id: speaker,
		});
		const answers = {
			language_code: "eng",
			text: "Hello there. (laughter) Hi!",
			words: [
				word("Hello", 1.2, 1.5, "speaker_1"),
				spacing(1.5, 1.5, "speaker_1"),
				word("there.", 1.5, 1.9, "speaker_1"),
				{
					text: "(laughter)",
					type: "audio_event",
					start: 2,
					end: 3,
					speaker_id: "speaker_1",
				},
				word("Hi!", 10.16, 10.5, "speaker_0"),
			],
		};
		const failed = (status: number, code: string, message: string) =>
			Response.json({ detail: { code, message } }, { status });
		const link = (time: string) =>
			`obsidian://podnotes?episodeName=Test%20Episode&url=https%3A%2F%2Fexample.com%2Ffeed.xml&time=${time}`;
		const fields = async (request: RequestUrlParam) =>
			Object.fromEntries(
				[...(await sentForm(request))].filter(([, value]) => typeof value === "string"),
			);
		const uploaded = async (request: RequestUrlParam) =>
			new Uint8Array(await (await sentFile(request)).arrayBuffer());

		test("has a timestamp on each paragraph, numbers the speakers in the order they first speak, and leaves out sounds", async () => {
			providerMock.mockImplementation(async () => Response.json(answers));
			const plugin = useElevenLabs();

			await expect(finalNotice(plugin)).resolves.toBe("Transcription completed and saved.");

			expect(savedNote(plugin)).toBe(
				`# Test Episode\n\n[00:00:01](${link("1.2")}) **1:** Hello there.\n\n` +
					`[00:00:10](${link("10.16")}) **2:** Hi!`,
			);
		});

		test("a public episode goes by its address in one request without a file, and its audio is never loaded", async () => {
			providerMock.mockImplementation(async () => Response.json(answers));
			const plugin = useElevenLabs({ feeds: savedFeedRepository(publicFeed, [mockEpisode]) });

			await transcribe(plugin);

			expect(getEpisodeAudioBufferMock).not.toHaveBeenCalled();
			expect(providerMock).toHaveBeenCalledOnce();
			const [request] = providerMock.mock.calls[0];
			expect(request.url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
			expect(request.method).toBe("POST");
			expect(request.headers).toEqual({ "xi-api-key": "elevenlabs-key" });
			expect([...(await sentForm(request))]).toEqual([
				["model_id", "scribe_v3"],
				["diarize", "true"],
				["timestamps_granularity", "word"],
				["tag_audio_events", "false"],
				["source_url", "https://example.com/episode.mp3"],
			]);
			expect(savedNote(plugin)).toContain("**1:** Hello there.");
		});

		test("a private feed's episode is uploaded to ElevenLabs, and no request holds its address or its feed's", async () => {
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
			const plugin = useElevenLabs({
				feeds: savedFeedRepository(privateFeed, [episode], () => secretFeed),
			});

			await transcribe(plugin, episode);

			expect(providerMock).toHaveBeenCalledOnce();
			const [request] = providerMock.mock.calls[0];
			expect(await fields(request)).toEqual({
				model_id: "scribe_v3",
				diarize: "true",
				timestamps_granularity: "word",
				tag_audio_events: "false",
			});
			expect(await uploaded(request)).toEqual(audio);
			for (const secret of ["SUBSCRIBER-TOKEN", "cdn.example.com", "private.example.com"]) {
				expect(sentText(request)).not.toContain(secret);
			}
		});

		test("with speaker labels off asks ElevenLabs for none, and the note names no speaker", async () => {
			providerMock.mockImplementation(async () => Response.json(answers));
			const plugin = useElevenLabs({ speakers: false });

			await expect(finalNotice(plugin)).resolves.toBe("Transcription completed and saved.");

			expect((await fields(providerMock.mock.calls[0][0])).diarize).toBe("false");
			expect(savedNote(plugin)).toBe(
				`# Test Episode\n\n[00:00:01](${link("1.2")}) Hello there.\n\n` +
					`[00:00:10](${link("10.16")}) Hi!`,
			);
		});

		test("an address ElevenLabs could not download is followed by one upload", async () => {
			providerMock.mockImplementation(async (request) =>
				(await sentForm(request)).has("source_url")
					? failed(
							400,
							"bad_request",
							"Failed to download the file from the provided URL: https://example.com/episode.mp3",
						)
					: Response.json(answers),
			);
			const plugin = useElevenLabs({ feeds: savedFeedRepository(publicFeed, [mockEpisode]) });

			await expect(finalNotice(plugin)).resolves.toBe("Transcription completed and saved.");

			expect(providerMock).toHaveBeenCalledTimes(2);
			expect(await uploaded(providerMock.mock.calls[1][0])).toEqual(audio);
			expect(getEpisodeAudioBufferMock).toHaveBeenCalledOnce();
			expect(savedNote(plugin)).toContain("**1:** Hello there.");
		});

		test.each([
			[
				"a rejected key",
				failed(401, "unauthorized", "Invalid API key"),
				"ElevenLabs rejected the API key. Check it in the transcript settings.",
			],
			[
				"a used-up quota",
				failed(401, "quota_exceeded", "This request exceeds your quota of 10000."),
				"Your ElevenLabs account is out of credit. Add credit there, then try again.",
			],
			[
				"a model the key may not use",
				failed(400, "unsupported_model", "Model scribe_v3 is not supported."),
				"ElevenLabs does not offer the scribe_v3 model to this API key.",
			],
			[
				"a request ElevenLabs could not read",
				failed(
					400,
					"bad_request",
					"The source_url https://example.com/episode.mp3 is invalid.",
				),
				"ElevenLabs could not transcribe this audio.",
			],
		])(
			"%s for a request by address is said in PodNotes' words and is not followed by an upload",
			async (_failure, response, shown) => {
				providerMock.mockImplementation(async () => response.clone());
				const plugin = useElevenLabs({
					feeds: savedFeedRepository(publicFeed, [mockEpisode]),
				});

				await expect(finalNotice(plugin)).resolves.toBe(`Transcription failed: ${shown}`);

				expect(providerMock).toHaveBeenCalledOnce();
				expect(getEpisodeAudioBufferMock).not.toHaveBeenCalled();
				expect(plugin.app.vault.create).not.toHaveBeenCalled();
			},
		);
	});

	describe("an OpenRouter transcript", () => {
		const TRANSCRIPTIONS = "https://openrouter.ai/api/v1/audio/transcriptions";
		const CATALOG = "https://openrouter.ai/api/v1/models?output_modalities=transcription";
		const HOUR_MS = 60 * 60 * 1000;
		const audio = new Uint8Array(2048).map((_, index) => (index * 13) % 241);
		const useOpenRouter = (
			overrides: { model?: string; speakers?: boolean; feeds?: FeedRepository } = {},
		) => {
			getEpisodeAudioBufferMock.mockResolvedValue({ buffer: audio.buffer, extension: "mp3" });
			return createMockPlugin({
				provider: "openrouter",
				openRouterKey: "openrouter-key",
				speakers: true,
				...overrides,
			});
		};
		/** A word as OpenRouter's verbose_json lists it, with a speaker when one is given. */
		const word = (text: string, start: number, end: number, speaker?: number) => ({
			word: text,
			start,
			end,
			confidence: 0.99,
			...(speaker !== undefined && { speaker, speaker_label: `speaker_${speaker}` }),
		});
		const answers = {
			text: "Hello there. [laughter] Hi!",
			duration: 11,
			words: [
				word("Hello", 1.2, 1.5, 0),
				word("there.", 1.5, 1.9, 0),
				{ ...word("[laughter]", 2, 3, 0), type: "audio_event" },
				word("Hi!", 10.16, 10.5, 1),
			],
		};
		/** OpenRouter's public catalog, listing each model with its end date or null. */
		const catalog = (models: Record<string, string | null>) => ({
			data: Object.entries(models).map(([id, expiration_date]) => ({
				id,
				name: id,
				expiration_date,
				endpoints: ["/api/v1/audio/transcriptions"],
			})),
		});
		const EVERY_MODEL = catalog({
			"x-ai/grok-stt-2.0": null,
			"x-ai/grok-stt-1.0": "2026-11-15",
			"elevenlabs/scribe-v2": null,
			"microsoft/mai-transcribe-2": null,
		});
		/** Answers the catalog with `listed`, and each transcription request with `answer`. */
		const openRouter = (
			answer: (request: RequestUrlParam) => Response | Promise<Response> = () =>
				Response.json(answers),
			listed: unknown = EVERY_MODEL,
		) =>
			providerMock.mockImplementation(async (request) =>
				request.url === CATALOG ? Response.json(listed) : answer(request),
			);
		/** The transcription requests the jobs sent, oldest first. */
		const sent = () =>
			providerMock.mock.calls
				.map(([request]) => request)
				.filter(({ url }) => url === TRANSCRIPTIONS);
		const catalogReads = () =>
			providerMock.mock.calls.filter(([request]) => request.url === CATALOG).length;
		const sentJson = (request: RequestUrlParam) =>
			JSON.parse(new TextDecoder().decode(sentBytes(request)));
		const fields = async (request: RequestUrlParam) =>
			Object.fromEntries(
				[...(await sentForm(request))].filter(([, value]) => typeof value === "string"),
			);
		const sentModel = async (request: RequestUrlParam) =>
			request.contentType === "application/json"
				? sentJson(request).model
				: (await sentForm(request)).get("model");
		const link = (time: string) =>
			`obsidian://podnotes?episodeName=Test%20Episode&url=https%3A%2F%2Fexample.com%2Ffeed.xml&time=${time}`;
		const labeled = `# Test Episode\n\n[00:00:01](${link("1.2")}) **1:** Hello there.\n\n[00:00:10](${link("10.16")}) **2:** Hi!`;
		const unlabeled = `# Test Episode\n\n[00:00:01](${link("1.2")}) Hello there.\n\n[00:00:10](${link("10.16")}) Hi!`;

		test("Grok STT 2.0, the recommended model, gets even a public episode as base64 JSON, routed to xAI and asked there for speaker labels", async () => {
			openRouter();
			const plugin = useOpenRouter({ feeds: savedFeedRepository(publicFeed, [mockEpisode]) });

			await expect(finalNotice(plugin)).resolves.toBe("Transcription completed and saved.");

			expect(getEpisodeAudioBufferMock).toHaveBeenCalledOnce();
			expect(sent()).toHaveLength(1);
			const [request] = sent();
			expect(request.method).toBe("POST");
			expect(request.headers).toEqual({ Authorization: "Bearer openrouter-key" });
			expect(request.contentType).toBe("application/json");
			expect(sentJson(request)).toEqual({
				model: "x-ai/grok-stt-2.0",
				input_audio: { data: Buffer.from(audio).toString("base64"), format: "mp3" },
				response_format: "verbose_json",
				timestamp_granularities: ["word", "segment"],
				provider: { only: ["xai"], options: { xai: { diarize: true } } },
			});
			expect(savedNote(plugin)).toBe(labeled);
		});

		test.each(["elevenlabs/scribe-v2", "microsoft/mai-transcribe-2"])(
			"%s gets an upload as multipart, asked for speaker labels beside the model",
			async (model) => {
				openRouter();
				const plugin = useOpenRouter({ model });

				await transcribe(plugin);

				expect(sent()).toHaveLength(1);
				const [request] = sent();
				expect(request.headers).toEqual({ Authorization: "Bearer openrouter-key" });
				expect(await fields(request)).toEqual({
					model,
					response_format: "verbose_json",
					"timestamp_granularities[]": "word",
					diarize: "true",
				});
				expect(new Uint8Array(await (await sentFile(request)).arrayBuffer())).toEqual(
					audio,
				);
				expect(savedNote(plugin)).toBe(labeled);
			},
		);

		test.each(["x-ai/grok-stt-2.0", "elevenlabs/scribe-v2", "microsoft/mai-transcribe-2"])(
			"with speaker labels off, %s is asked for none, and the note names no speaker",
			async (model) => {
				openRouter();
				const plugin = useOpenRouter({ model, speakers: false });

				await expect(finalNotice(plugin)).resolves.toBe(
					"Transcription completed and saved.",
				);

				expect(sent()).toHaveLength(1);
				expect(sentText(sent()[0])).not.toContain("diarize");
				expect(savedNote(plugin)).toBe(unlabeled);
			},
		);

		test.each(["elevenlabs/scribe-v2", "microsoft/mai-transcribe-2"])(
			"with speaker labels off, %s is still asked for word times, which OpenRouter sends only when asked",
			async (model) => {
				openRouter((request) =>
					Response.json(
						/timestamp_granularities|diarize/.test(sentText(request))
							? {
									...answers,
									words: answers.words.map(
										({ speaker: _speaker, speaker_label: _label, ...rest }) =>
											rest,
									),
								}
							: {
									text: answers.text,
									duration: 11,
									segments: [{ id: 0, start: 0, end: 11, text: answers.text }],
								},
					),
				);
				const plugin = useOpenRouter({ model, speakers: false });

				await expect(finalNotice(plugin)).resolves.toBe(
					"Transcription completed and saved.",
				);
				expect(savedNote(plugin)).toBe(unlabeled);
			},
		);

		test("Scribe v2 uploads the episode once when OpenRouter's provider cannot download its address", async () => {
			openRouter((request) =>
				request.contentType === "application/json"
					? Response.json(
							{
								error: {
									message:
										"Provider could not download input_audio.url; ensure it is publicly reachable and serves a supported audio file",
									code: 400,
								},
							},
							{ status: 400 },
						)
					: Response.json(answers),
			);
			const plugin = useOpenRouter({
				model: "elevenlabs/scribe-v2",
				feeds: savedFeedRepository(publicFeed, [mockEpisode]),
			});

			await expect(finalNotice(plugin)).resolves.toBe("Transcription completed and saved.");

			expect(sent().map(({ contentType }) => contentType === "application/json")).toEqual([
				true,
				false,
			]);
			expect(getEpisodeAudioBufferMock).toHaveBeenCalledOnce();
			expect(savedNote(plugin)).toBe(labeled);
		});

		test("Scribe v2 takes a public episode by its address in one request, and its audio is never loaded", async () => {
			openRouter();
			const plugin = useOpenRouter({
				model: "elevenlabs/scribe-v2",
				feeds: savedFeedRepository(publicFeed, [mockEpisode]),
			});

			await expect(finalNotice(plugin)).resolves.toBe("Transcription completed and saved.");

			expect(getEpisodeAudioBufferMock).not.toHaveBeenCalled();
			expect(sent()).toHaveLength(1);
			const [request] = sent();
			expect(request.headers).toEqual({ Authorization: "Bearer openrouter-key" });
			expect(request.contentType).toBe("application/json");
			expect(sentJson(request)).toEqual({
				model: "elevenlabs/scribe-v2",
				input_audio: { url: "https://example.com/episode.mp3", format: "mp3" },
				response_format: "verbose_json",
				timestamp_granularities: ["word"],
				diarize: true,
			});
			expect(savedNote(plugin)).toBe(labeled);
		});

		test("a 40 MB episode goes in parts of at most 18 MB and 1,800 s, one at a time, timed to the millisecond from the episode's start", async () => {
			const stream = MP3_STREAMS.mpeg1At96Kbps;
			const frames = Math.ceil(40_000_000 / stream.frameBytes);
			getEpisodeAudioBufferMock.mockResolvedValue({
				buffer: mp3Bytes(stream, frames).buffer,
				extension: "mp3",
			});
			const partBytes: number[] = [];
			openRouter((request) => {
				partBytes.push(
					Buffer.from(sentJson(request).input_audio.data, "base64").byteLength,
				);
				return Response.json({ words: [word(`Part ${partBytes.length}.`, 1, 1.5)] });
			});
			const plugin = createMockPlugin({
				provider: "openrouter",
				openRouterKey: "openrouter-key",
			});

			await expect(finalNotice(plugin)).resolves.toBe("Transcription completed and saved.");

			expect(partBytes.length).toBeGreaterThan(2);
			expect(partBytes.reduce((sum, bytes) => sum + bytes)).toBe(frames * stream.frameBytes);
			for (const bytes of partBytes) {
				expect(bytes).toBeLessThanOrEqual(18_000_000);
				expect(mp3Seconds(stream, bytes)).toBeLessThanOrEqual(1800);
			}
			// Each part's word is 1 s into it.
			const expected = partBytes.map(
				(_, index) =>
					Math.round((mp3Seconds(stream, sumOf(partBytes.slice(0, index))) + 1) * 1000) /
					1000,
			);
			const note = savedNote(plugin);
			const times = [...note.matchAll(/time=([\d.]+)\)/g)].map(([, time]) => time);
			expect(times).toEqual(expected.map(String));
			expect(note).toContain(`Part ${partBytes.length}.`);
		});

		describe("speaker labels across the parts of an episode", () => {
			const stream = MP3_STREAMS.mpeg25At8KbpsCrcPadded;
			const VOICES = ["", "Ann", "Bob", "Cy"];
			const [ANN, BOB, CY] = [1, 2, 3];
			/** The stream's header with no CRC and no padding, then nothing: a frame of silence. */
			const SILENCE = [0xff, 0xe3, 0x18, 0xc0, ...Array<number>(68).fill(0)];
			/**
			 * Episode frames, start inclusive and end exclusive. 417 frames are 30.024 s, and the
			 * second part starts at frame 22,334, 1,608.048 s in.
			 */
			const TURNS = [
				{ voice: ANN, from: 0, to: 417 },
				{ voice: BOB, from: 417, to: 834 },
				{ voice: BOB, from: 22_500, to: 22_917 },
				{ voice: ANN, from: 22_917, to: 23_334 },
			];
			const episode = (turns = TURNS, frames = twoPartFrames) => ({
				buffer: voicedMp3Bytes(
					stream,
					frames,
					(frame) =>
						turns.find(({ from, to }) => frame >= from && frame < to)?.voice ?? 0,
				).buffer,
				extension: "mp3",
			});

			type Frame = { readonly index: number; readonly voice: number } | "silence";
			/** The frames of a request's audio. Throws at the first byte where no frame of the stream starts. */
			const framesOf = (bytes: Uint8Array): Frame[] => {
				const frames: Frame[] = [];
				const starts = (at: number, expected: readonly number[]) =>
					expected.every((byte, index) => bytes[at + index] === byte);
				for (let at = 0; at < bytes.length;) {
					if (starts(at, stream.header)) {
						const end = at + stream.frameBytes;
						frames.push({
							voice: bytes[end - 3],
							index: (bytes[end - 2] << 8) | bytes[end - 1],
						});
						at = end;
					} else if (starts(at, SILENCE)) {
						frames.push("silence");
						at += SILENCE.length;
					} else {
						throw new Error(`No frame of the stream starts at byte ${at}.`);
					}
				}
				return frames;
			};
			const sentAudio = async (request: RequestUrlParam): Promise<Uint8Array> =>
				request.contentType === "application/json"
					? Buffer.from(sentJson(request).input_audio.data, "base64")
					: new Uint8Array(await (await sentFile(request)).arrayBuffer());
			/**
			 * Answers as a model that hears who speaks in each frame: a word for each turn,
			 * named for its voice, with labels numbered in the order voices first speak in this request.
			 */
			const heard = (frames: readonly Frame[]) => {
				const labels = new Map<number, number>();
				const words: ReturnType<typeof word>[] = [];
				let voiceBefore = 0;
				frames.forEach((frame, at) => {
					const voice = frame === "silence" ? 0 : frame.voice;
					const [start, end] = [at, at + 1].map((n) => n * stream.frameSeconds);
					if (voice !== 0 && voice === voiceBefore) words[words.length - 1].end = end;
					else if (voice !== 0) {
						if (!labels.has(voice)) labels.set(voice, labels.size);
						words.push(word(VOICES[voice], start, end, labels.get(voice)));
					}
					voiceBefore = voice;
				});
				return { words };
			};
			/** OpenRouter answering each request as `heard` does, and the reel with `reel` when given. */
			const hearing = (reel?: () => Response) =>
				openRouter(async (request) => {
					const frames = framesOf(await sentAudio(request));
					const isReel = frames.length * stream.frameSeconds < 60;
					return isReel && reel ? reel() : Response.json(heard(frames));
				});
			const spoken = (note: string) =>
				[...note.matchAll(/\*\*(\d+):\*\* (\w+)/g)].map(([, n, text]) => `${n} ${text}`);
			const grok = () =>
				createMockPlugin({
					provider: "openrouter",
					openRouterKey: "openrouter-key",
					speakers: true,
				});
			const RESTART =
				"OpenRouter transcribed this episode in 2 parts, and speaker labels restart in each, so one person can have several labels.";

			test("Grok STT 2.0 numbers each voice once across two parts that label them in the other order", async () => {
				getEpisodeAudioBufferMock.mockResolvedValue(episode());
				hearing();
				const plugin = grok();

				const notice = await finalNotice(plugin);

				expect(spoken(savedNote(plugin))).toEqual(["1 Ann", "2 Bob", "2 Bob", "1 Ann"]);
				expect(notice).toBe("Transcription completed and saved.");
				expect(sent()).toHaveLength(3);
			});

			test("the reel is the stream's own frames, 9 s from 0.2 s into each voice's longest turn in each part, with 1.5 s of silent frames between clips", async () => {
				getEpisodeAudioBufferMock.mockResolvedValue(episode());
				hearing();

				await transcribe(grok());

				expect(sent()).toHaveLength(3);
				const reel = framesOf(await sentAudio(sent()[2]));
				// A run of silent frames has no first index.
				const indexes = reel.map((frame) => (frame === "silence" ? -1 : frame.index));
				const runs: { first: number; frames: number }[] = [];
				indexes.forEach((index, at) => {
					const previous = indexes[at - 1];
					const follows =
						at > 0 && (index === -1 ? previous === -1 : index === previous + 1);
					if (follows) runs[runs.length - 1].frames++;
					else runs.push({ first: index, frames: 1 });
				});
				const gapFrames = Math.ceil(1.5 / stream.frameSeconds);
				expect(runs.map(({ first, frames }) => (first === -1 ? frames : "clip"))).toEqual([
					"clip",
					gapFrames,
					"clip",
					gapFrames,
					"clip",
					gapFrames,
					"clip",
				]);
				// 0.2 s is 2.8 frames, so each clip starts at the third frame of its turn and holds 125.
				const clips = runs
					.filter(({ first }) => first !== -1)
					.map(({ first, frames }) => [first, frames])
					.sort(([a], [b]) => a - b);
				expect(clips).toEqual(TURNS.map(({ from }) => [from + 3, 125]));
				expect(reel.length * stream.frameSeconds).toBeCloseTo(
					4 * 9 + 3 * gapFrames * 0.072,
					6,
				);
			});

			test("a voice whose turns are all under 2.6 s gets no clip and keeps its own number", async () => {
				// Cy speaks 2.016 s, after Ann in the second part.
				getEpisodeAudioBufferMock.mockResolvedValue(
					episode([...TURNS, { voice: CY, from: 23_334, to: 23_362 }]),
				);
				hearing();
				const plugin = grok();

				const notice = await finalNotice(plugin);

				expect(spoken(savedNote(plugin))).toEqual([
					"1 Ann",
					"2 Bob",
					"2 Bob",
					"1 Ann",
					"3 Cy",
				]);
				expect(notice).toBe("Transcription completed and saved.");
				expect(sent()).toHaveLength(3);
				const reelVoices = framesOf(await sentAudio(sent()[2])).map((frame) =>
					frame === "silence" ? 0 : frame.voice,
				);
				expect(new Set(reelVoices)).toEqual(new Set([0, ANN, BOB]));
			});

			test("a reel OpenRouter refuses keeps the parts' labels, saves the note and says labels restart", async () => {
				getEpisodeAudioBufferMock.mockResolvedValue(episode());
				hearing(() =>
					Response.json(
						{ error: { message: "Invalid audio SENTINEL", code: 400 } },
						{ status: 400 },
					),
				);
				const plugin = grok();

				await expect(finalNotice(plugin)).resolves.toBe(RESTART);

				expect(sent()).toHaveLength(3);
				expect(spoken(savedNote(plugin))).toEqual(["1 Ann", "2 Bob", "3 Bob", "4 Ann"]);
			});

			test.each(["elevenlabs/scribe-v2", "microsoft/mai-transcribe-2"])(
				"%s sends no reel: labels from two parts never name the same speaker, and the notice says labels restart in each",
				async (model) => {
					getEpisodeAudioBufferMock.mockResolvedValue(episode());
					hearing();
					const plugin = createMockPlugin({
						provider: "openrouter",
						openRouterKey: "openrouter-key",
						speakers: true,
						model,
					});

					await expect(finalNotice(plugin)).resolves.toBe(RESTART);

					expect(sent()).toHaveLength(2);
					expect(spoken(savedNote(plugin))).toEqual(["1 Ann", "2 Bob", "3 Bob", "4 Ann"]);
				},
			);

			test("with speaker labels off, Grok STT 2.0 sends no reel, even when its answers label speakers", async () => {
				getEpisodeAudioBufferMock.mockResolvedValue(episode());
				hearing();
				const plugin = createMockPlugin({
					provider: "openrouter",
					openRouterKey: "openrouter-key",
					speakers: false,
				});

				await expect(finalNotice(plugin)).resolves.toBe(
					"Transcription completed and saved.",
				);

				expect(sent()).toHaveLength(2);
				expect(savedNote(plugin)).not.toContain("**");
			});

			test("an episode in one part sends no reel", async () => {
				getEpisodeAudioBufferMock.mockResolvedValue(episode(TURNS, 834));
				hearing();
				const plugin = grok();

				await expect(finalNotice(plugin)).resolves.toBe(
					"Transcription completed and saved.",
				);

				expect(sent()).toHaveLength(1);
				expect(spoken(savedNote(plugin))).toEqual(["1 Ann", "2 Bob"]);
			});
		});

		test("speaker labels asked for and none returned, as from a route that ignores the option, saves the note and says so", async () => {
			openRouter(() =>
				Response.json({ words: [word("Hello", 1.2, 1.5), word("there.", 1.5, 1.9)] }),
			);
			const plugin = useOpenRouter();

			await expect(finalNotice(plugin)).resolves.toBe(
				"Saved without speaker labels, because Grok STT 2.0 returned none.",
			);

			expect(savedNote(plugin)).toBe(
				`# Test Episode\n\n[00:00:01](${link("1.2")}) Hello there.`,
			);
		});

		test.each<[name: string, status: number, message: string, shown: string]>([
			[
				"402",
				402,
				"Insufficient credits. Add more using https://openrouter.ai/settings/credits SENTINEL",
				"Your OpenRouter account is out of credit. Add credit there, then try again.",
			],
			[
				"404 for a model no route of which meets the account's privacy settings",
				404,
				"No endpoints found matching your data policy (Zero data retention). Configure: https://openrouter.ai/settings/privacy SENTINEL",
				"OpenRouter does not offer the x-ai/grok-stt-2.0 model under your OpenRouter privacy settings. Change them there, or choose another model in the transcript settings.",
			],
			[
				"404",
				404,
				"No endpoints found for x-ai/grok-stt-2.0. SENTINEL",
				"OpenRouter does not offer the x-ai/grok-stt-2.0 model to this API key.",
			],
			[
				"401",
				401,
				"No cookie auth credentials found SENTINEL",
				"OpenRouter rejected the API key. Check it in the transcript settings.",
			],
		])(
			"a %s is said in PodNotes' words, with none of OpenRouter's, and no other part is sent",
			async (_name, status, message, shown) => {
				getEpisodeAudioBufferMock.mockResolvedValue(twoPartAudio());
				openRouter(() => Response.json({ error: { message, code: status } }, { status }));
				const plugin = createMockPlugin({
					provider: "openrouter",
					openRouterKey: "openrouter-key",
				});

				await expect(finalNotice(plugin)).resolves.toBe(`Transcription failed: ${shown}`);

				expect(sent()).toHaveLength(1);
				expect(plugin.app.vault.create).not.toHaveBeenCalled();
			},
		);

		test("a chosen model the catalog no longer lists runs the recommended one, and the notice says so", async () => {
			openRouter(
				undefined,
				catalog({ "x-ai/grok-stt-2.0": null, "microsoft/mai-transcribe-2": null }),
			);
			const plugin = useOpenRouter({ model: "elevenlabs/scribe-v2" });

			await expect(finalNotice(plugin)).resolves.toBe(
				"OpenRouter no longer offers ElevenLabs Scribe v2, so PodNotes used Grok STT 2.0.",
			);

			expect(await Promise.all(sent().map(sentModel))).toEqual(["x-ai/grok-stt-2.0"]);
		});

		test("a model whose end date has come is skipped, and the next one is recommended", async () => {
			const today = new Date().toISOString().slice(0, 10);
			openRouter(
				undefined,
				catalog({
					"x-ai/grok-stt-2.0": today,
					"elevenlabs/scribe-v2": null,
					"microsoft/mai-transcribe-2": null,
				}),
			);
			const plugin = useOpenRouter();

			await expect(finalNotice(plugin)).resolves.toBe("Transcription completed and saved.");

			expect(await Promise.all(sent().map(sentModel))).toEqual(["elevenlabs/scribe-v2"]);
		});

		test("a catalog that cannot be read leaves every model offered, and the next job reads it again", async () => {
			let reads = 0;
			providerMock.mockImplementation(async (request) => {
				if (request.url !== CATALOG) return Response.json(answers);
				return ++reads === 1
					? new Response("", { status: 503 })
					: Response.json(catalog({ "x-ai/grok-stt-2.0": null }));
			});
			const plugin = useOpenRouter({ model: "elevenlabs/scribe-v2" });

			await transcribe(plugin);
			await transcribe(plugin);

			expect(reads).toBe(2);
			expect(await Promise.all(sent().map(sentModel))).toEqual([
				"elevenlabs/scribe-v2",
				"x-ai/grok-stt-2.0",
			]);
		});

		test("the catalog is read again only once a day has passed", async () => {
			vi.useFakeTimers({ toFake: ["Date"] });
			try {
				openRouter();
				const plugin = useOpenRouter();

				await transcribe(plugin);
				vi.setSystemTime(Date.now() + 23 * HOUR_MS);
				await transcribe(plugin);
				expect(catalogReads()).toBe(1);

				vi.setSystemTime(Date.now() + 2 * HOUR_MS);
				await transcribe(plugin);
				expect(catalogReads()).toBe(2);
				expect(sent()).toHaveLength(3);
			} finally {
				vi.useRealTimers();
			}
		});
	});
});

function sumOf(numbers: readonly number[]): number {
	return numbers.reduce((sum, number) => sum + number, 0);
}

function deepgramAnswer(words: Record<string, unknown>[]) {
	return { results: { channels: [{ alternatives: [{ words }] }] } };
}
