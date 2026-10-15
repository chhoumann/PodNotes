import { afterEach, beforeEach, vi } from "vitest";
import type PodNotes from "src/main";
import type { TranscriptLink } from "src/parser/feedDocumentParser";
import type { Episode } from "src/types/Episode";

/** What each Notice opened with, oldest first. */
export const noticeMessages: string[] = [];

/** Stand-ins for the audio download, OpenAI (through `fetch`) and Deepgram. */
export const getEpisodeAudioBufferMock = vi.fn();
export const fetchMock = vi.fn<typeof fetch>();
export const diarizeWithDeepgramMock = vi.fn();

/**
 * Resets the mocks above and `noticeMessages` before each test of the calling file,
 * and stubs `fetch` with `fetchMock`. The file still mocks `../downloadEpisode` and
 * `./diarization` with these handles, because `vi.mock` applies only to its own file.
 */
export function installTranscriptionMocks(): void {
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
}

/** The `obsidian` module whose Notice records its opening message in `noticeMessages`. */
export function recordingNotices(obsidian: typeof import("obsidian")): typeof import("obsidian") {
	class RecordingNotice extends obsidian.Notice {
		constructor(message: string | DocumentFragment, duration?: number) {
			super(message, duration);
			noticeMessages.push(String(message));
		}
	}
	return { ...obsidian, Notice: RecordingNotice };
}

export const mockEpisode: Episode = {
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

export function createMockPlugin(
	overrides: {
		openAIKey?: string;
		podcast?: Episode | null;
		existingTranscriptPath?: string | null;
		transcripts?: TranscriptLink[];
		feedUrl?: string;
		loadFeed?: () => Promise<boolean>;
	} = {},
): PodNotes {
	const {
		openAIKey = "test-api-key",
		podcast = mockEpisode,
		existingTranscriptPath = null,
		transcripts,
		feedUrl = "https://example.com/feed.xml",
		loadFeed = async () => true,
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
				getActiveViewOfType: () => null,
				getLeaf: vi.fn(() => ({
					openFile: vi.fn(),
				})),
			},
		},
	} as unknown as PodNotes;
}
