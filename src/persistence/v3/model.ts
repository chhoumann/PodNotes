import type { EpisodeHandle, FeedHandle } from "src/security/resourceHandles";
import type { FeedCapabilityReference } from "src/security/feedCapabilityReferences";

export const LIBRARY_V3_SCHEMA_VERSION = 3;
export const LIBRARY_V3_EXTENSIONS_SCHEMA_VERSION = 1;

export const MAX_FEEDS = 4_096;
export const MAX_EPISODES = 50_000;
export const MAX_CUSTOM_PLAYLISTS = 512;
export const MAX_PLAYLIST_EPISODE_REFERENCES = 4_096;
export const MAX_PROGRESS_ENTRIES = 50_000;
export const MAX_POD_NOTE_ENTRIES = 50_000;
export const MAX_DOWNLOADS_PER_EPISODE = 32;
export const MAX_LOCAL_ASSETS = 50_000;
export const MAX_TOTAL_EPISODE_REFERENCES = 200_000;

export const MAX_TITLE_BYTES = 2 * 1024;
export const MAX_COLLECTION_ID_BYTES = 512;
export const MAX_AUTHOR_BYTES = 2 * 1024;
export const MAX_DESCRIPTION_TEXT_BYTES = 256 * 1024;
export const MAX_CONTENT_TEXT_BYTES = 512 * 1024;
export const MAX_PLAYLIST_NAME_BYTES = 1024;
export const MAX_ICON_BYTES = 256;
export const MAX_VAULT_PATH_BYTES = 8 * 1024;
export const MAX_TOTAL_TEXT_BYTES = 8 * 1024 * 1024;
export const MAX_LIBRARY_V3_BYTES = 16 * 1024 * 1024;

export interface ValidationContext {
	textBytes: number;
	episodeReferences: number;
}

interface FeedMetadataV3 {
	feedId: FeedHandle;
	title: string;
	collectionId?: string;
	author?: string;
	descriptionText?: string;
}

export interface RemoteFeedV3 extends FeedMetadataV3 {
	kind: "remote";
	capabilityRef: FeedCapabilityReference;
}

export interface LocalFeedV3 extends FeedMetadataV3 {
	kind: "local";
}

export type LibraryFeedV3 = RemoteFeedV3 | LocalFeedV3;

export interface LibraryEpisodeV3 {
	episodeId: EpisodeHandle;
	feedId: FeedHandle;
	kind: "remote" | "local";
	title: string;
	descriptionText?: string;
	contentText?: string;
	episodeDate?: string;
	itunesTitle?: string;
	episodeNumber?: number;
	duration?: number;
	mediaType?: "audio" | "video";
}

export interface LibraryPlaylistV3 {
	name: string;
	icon: string;
	episodeIds: EpisodeHandle[];
	currentEpisodeId?: EpisodeHandle;
	shouldEpisodeRemoveAfterPlay: boolean;
	shouldRepeat: boolean;
}

export interface EpisodeProgressV3 {
	episodeId: EpisodeHandle;
	time: number;
	duration: number;
	finished: boolean;
}

export interface PodNoteV3 {
	episodeId: EpisodeHandle;
	filePath: string;
}

export interface DownloadAssetV3 {
	filePath: string;
	size: number;
}

export interface LocalAssetV3 {
	episodeId: EpisodeHandle;
	filePath: string;
}

export interface LibraryExtensionsV1 {
	schemaVersion: typeof LIBRARY_V3_EXTENSIONS_SCHEMA_VERSION;
}

export type FeedMapV3 = Readonly<Partial<Record<FeedHandle, LibraryFeedV3>>>;
export type EpisodeMapV3 = Readonly<Partial<Record<EpisodeHandle, LibraryEpisodeV3>>>;
export type ProgressMapV3 = Readonly<Partial<Record<EpisodeHandle, EpisodeProgressV3>>>;
export type PodNoteMapV3 = Readonly<Partial<Record<EpisodeHandle, PodNoteV3>>>;
export type DownloadMapV3 = Readonly<Partial<Record<EpisodeHandle, DownloadAssetV3[]>>>;
export type LocalAssetMapV3 = Readonly<Partial<Record<EpisodeHandle, LocalAssetV3>>>;

export interface LibraryV3 {
	schemaVersion: typeof LIBRARY_V3_SCHEMA_VERSION;
	feeds: FeedMapV3;
	episodes: EpisodeMapV3;
	queue: LibraryPlaylistV3;
	favorites: LibraryPlaylistV3;
	localFiles: LibraryPlaylistV3;
	playlists: Readonly<Record<string, LibraryPlaylistV3>>;
	currentEpisodeId?: EpisodeHandle;
	progress: ProgressMapV3;
	podNotes: PodNoteMapV3;
	downloads: DownloadMapV3;
	localAssets: LocalAssetMapV3;
	extensions: LibraryExtensionsV1;
}

export class LibraryV3ValidationError extends Error {
	constructor() {
		super("PodNotes schema-v3 library data is invalid.");
		this.name = "LibraryV3ValidationError";
	}
}
