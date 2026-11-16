import { TFile } from "obsidian";
import { readable } from "svelte/store";
import { afterEach, beforeEach, vi } from "vitest";
import type PodNotes from "src/main";
import type { TranscriptLink } from "src/parser/feedDocumentParser";
import type { FeedRepository } from "src/services/FeedRepository";
import type { CredentialKind } from "src/types/Credentials";
import type { Episode } from "src/types/Episode";
import { corsBlockedFetch, providerMock, providerRequestUrl } from "./providerRequestUrl";

/** What each Notice opened with, oldest first. */
export const noticeMessages: string[] = [];

/** Stands in for the audio download. The providers answer through `providerMock`. */
export const getEpisodeAudioBufferMock = vi.fn();

/**
 * Resets the mock above, `providerMock` and `noticeMessages` before each test of the
 * calling file, and blocks `fetch` as Obsidian's CORS check does for a provider. The file
 * still mocks `obsidian` and `../downloadEpisode` with these handles, because `vi.mock`
 * applies only to its own file.
 */
export function installTranscriptionMocks(): void {
	beforeEach(() => {
		vi.clearAllMocks();
		noticeMessages.length = 0;
		providerMock.mockReset();
		vi.stubGlobal("fetch", corsBlockedFetch);
		getEpisodeAudioBufferMock.mockResolvedValue({
			buffer: new ArrayBuffer(1024),
			extension: "mp3",
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});
}

/**
 * The `obsidian` module whose Notice records its opening message in `noticeMessages`
 * and whose requestUrl answers with `providerMock`.
 */
export function mockedObsidian(obsidian: typeof import("obsidian")): typeof import("obsidian") {
	class RecordingNotice extends obsidian.Notice {
		constructor(message: string | DocumentFragment, duration?: number) {
			super(message, duration);
			noticeMessages.push(String(message));
		}
	}
	return {
		...obsidian,
		Notice: RecordingNotice,
		requestUrl: providerRequestUrl as typeof obsidian.requestUrl,
	};
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
		deepgramKey?: string;
		/** Speaker labels are on, with this provider. */
		speakers?: "openai" | "deepgram";
		/** In place of a repository with no saved feed. */
		feeds?: FeedRepository;
		podcast?: Episode | null;
		existingTranscriptPath?: string | null;
		transcripts?: TranscriptLink[];
		feedUrl?: string;
		loadFeed?: () => Promise<boolean>;
	} = {},
): PodNotes {
	const {
		openAIKey = "test-api-key",
		deepgramKey = "",
		speakers,
		feeds,
		podcast = mockEpisode,
		existingTranscriptPath = null,
		transcripts,
		feedUrl = "https://example.com/feed.xml",
		loadFeed = async () => true,
	} = overrides;

	const existing = (path: string) =>
		path === existingTranscriptPath ? Object.assign(new TFile(), { path }) : null;
	const keys: Record<CredentialKind, string> = { openai: openAIKey, deepgram: deepgramKey };

	return {
		settings: {
			openAISecretId: openAIKey ? "openai-secret" : "",
			deepgramSecretId: "",
			timestamp: { template: "- {{linktime}} ", offset: 5 },
			transcript: {
				path: "Transcripts/{{podcast}}/{{title}}.md",
				template: "# {{title}}\n\n{{transcript}}",
				diarization: {
					enabled: speakers !== undefined,
					provider: speakers ?? "openai",
					speakerTemplate: "",
				},
			},
			download: {
				path: "Downloads",
			},
		},
		feeds: feeds ?? {
			load: vi.fn(loadFeed),
			episodeMetadata: vi.fn(() => (transcripts ? { transcripts } : undefined)),
			itemUrl: vi.fn((_key: string, link: string) => new URL(link, feedUrl).href),
			subscribe: readable(new Map()).subscribe,
		},
		credentials: {
			get: vi.fn((_settings, kind: CredentialKind) => keys[kind] || null),
			has: vi.fn((_settings, kind: CredentialKind) => Boolean(keys[kind])),
			status: vi.fn((_settings, kind: CredentialKind) =>
				keys[kind] ? "available" : "unconfigured",
			),
		},
		api: {
			podcast,
		},
		app: {
			vault: {
				getFileByPath: vi.fn(existing),
				getAbstractFileByPath: vi.fn(existing),
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
