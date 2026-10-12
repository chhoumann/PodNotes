import { vi } from "vitest";
import type PodNotes from "src/main";
import type { TranscriptLink } from "src/parser/feedDocumentParser";
import type { Episode } from "src/types/Episode";

/** What each Notice opened with, oldest first. Empty it before each test. */
export const noticeMessages: string[] = [];

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
