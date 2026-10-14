// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, type MockInstance, test, vi } from "vitest";
import { Notice } from "obsidian";
import type PodNotes from "src/main";
import type { TranscriptLink } from "src/parser/feedDocumentParser";
import { NetworkError } from "src/utility/networkRequest";
import { privateFeedPlaceholder } from "src/utility/privateFeedUrl";
import { deferred } from "../../tests/mocks/feeds";
import {
	createMockPlugin,
	diarizeWithDeepgramMock,
	fetchMock,
	getEpisodeAudioBufferMock,
	installTranscriptionMocks,
	mockEpisode,
	noticeMessages,
} from "../../tests/mocks/transcriptionService";
import { TranscriptionService } from "./TranscriptionService";

vi.mock("obsidian", async (importOriginal) => {
	const { recordingNotices } = await import("../../tests/mocks/transcriptionService");
	return recordingNotices(await importOriginal<typeof import("obsidian")>());
});

const fetchTextMock = vi.hoisted(() => vi.fn());

vi.mock("src/utility/networkRequest", async (importOriginal) => ({
	...(await importOriginal<typeof import("src/utility/networkRequest")>()),
	fetchTextWithTimeout: fetchTextMock,
}));

vi.mock("../downloadEpisode", async () => ({
	getEpisodeAudioBuffer: (await import("../../tests/mocks/transcriptionService"))
		.getEpisodeAudioBufferMock,
}));

vi.mock("./diarization", async (importOriginal) => ({
	...(await importOriginal<typeof import("./diarization")>()),
	diarizeWithDeepgram: (await import("../../tests/mocks/transcriptionService"))
		.diarizeWithDeepgramMock,
}));

installTranscriptionMocks();

beforeEach(() => {
	fetchTextMock.mockReset();
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

		expect(plugin.feeds.load).toHaveBeenCalledExactlyOnceWith(["Test Podcast"], "cached");
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

	test("saving only the feed's transcript never sends the audio to a provider", async () => {
		const plugin = createMockPlugin({ transcripts: [] });

		await new TranscriptionService(plugin).transcribeCurrentEpisode({ paid: false });

		expect(noticeMessages).toEqual(["No published transcript was found for this episode."]);
		expect(getEpisodeAudioBufferMock).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
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
		fetchMock.mockImplementation(async () => Response.json({ text: "Spoken words." }));
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
		const lookup = deferred<boolean>();
		fetchTextMock.mockResolvedValue(VTT);
		const plugin = createMockPlugin({
			transcripts: published,
			loadFeed: () => lookup.promise,
		});
		const service = new TranscriptionService(plugin);

		const first = service.transcribeCurrentEpisode();
		const second = service.transcribeCurrentEpisode();
		lookup.resolve(true);
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
		const lookup = deferred<boolean>();
		const plugin = createMockPlugin({
			transcripts: published,
			loadFeed: () => lookup.promise,
		});
		const service = new TranscriptionService(plugin);

		const pending = service.transcribeCurrentEpisode();
		service.dispose();
		lookup.resolve(true);
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

		const saved = await transcribe(async () => VTT, "Saved the transcript the feed publishes.");
		await transcribe(async () => {
			throw new NetworkError("transport-failure");
		}, `The published transcript could not be fetched: Network request failed.${fromAudioOffer}`);

		const note = String(vi.mocked(saved.app.vault.create).mock.calls[0][1]);
		expect(note).toContain("[00:00:10](obsidian://podnotes?episodeName=Test%20Episode&url=");
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

	test.each([
		[
			"timed",
			{ url: "1.vtt", type: "text/vtt" },
			(feed: string) =>
				`WEBVTT\n\n00:00:00.480 --> 00:00:04.410\n<v Host ${feed}>Your feed: ${feed}\n`,
			"# Test Episode\n\n00:00:00 **Host podnotes-private-feed:Test\\%20Podcast:** Your feed: podnotes-private-feed:Test\\%20Podcast",
		],
		[
			"untimed",
			{ url: "1.txt", type: "text/plain" },
			(feed: string) => `Your feed: ${feed}`,
			"# Test Episode\n\nYour feed: podnotes-private-feed:Test\\%20Podcast",
		],
	])(
		"a %s transcript quoting the episode's private feed keeps no address",
		async (_, link, body, note) => {
			const secretFeed = "https://private.example.com/rss?auth=REVIEW%2FSENTINEL";
			fetchTextMock.mockResolvedValue(body(secretFeed));
			const plugin = createMockPlugin({
				openAIKey: "",
				podcast: { ...mockEpisode, feedUrl: secretFeed },
				transcripts: [link],
			});
			const service = new TranscriptionService(plugin);

			await service.transcribeCurrentEpisode();
			await finished(service, "Saved the transcript the feed publishes.");

			expect(plugin.app.vault.create).toHaveBeenCalledExactlyOnceWith(
				"Transcripts/Test Podcast/Test Episode.md",
				note,
			);
		},
	);
});
