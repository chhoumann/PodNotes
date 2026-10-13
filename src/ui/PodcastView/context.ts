import type { App } from "obsidian";
import { createContext } from "svelte";
import type { Readable } from "svelte/store";
import type { IAPI } from "src/API/IAPI";
import type { PlayerController } from "src/player/PlayerController";
import type { FeedRepository } from "src/services/FeedRepository";
import type DownloadedEpisode from "src/types/DownloadedEpisode";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import type { PlayedEpisode } from "src/types/PlayedEpisode";
import type { Playlist } from "src/types/Playlist";
import type { PodcastFeed } from "src/types/PodcastFeed";
import type { Navigation } from "./Navigation";

/** The user's library, as the view reads it. */
export interface Library {
	readonly savedFeeds: Readable<Record<string, PodcastFeed>>;
	readonly queue: Readable<Playlist>;
	readonly favorites: Readable<Playlist>;
	readonly playlists: Readable<Record<string, Playlist>>;
	readonly localFiles: Readable<Playlist>;
	readonly playedEpisodes: Readable<Record<string, PlayedEpisode>>;
	readonly downloadedEpisodes: Readable<Record<string, DownloadedEpisode[]>>;
	readonly episodeListLimit: Readable<number>;
}

/** What the view's components get from the plugin. */
export interface ShellServices {
	readonly app: App;
	readonly api: IAPI;
	readonly player: PlayerController;
	readonly feeds: FeedRepository;
	readonly navigation: Navigation;
	readonly library: Library;
	/** Current through a settings toggle or an import, which replaces the object. */
	readonly settings: Readable<IPodNotesSettings>;
	/** Into the active note, else into the episode note. Resolves to that note's name, or null. */
	captureTimestamp(): Promise<string | null>;
	/** Opens Obsidian's settings at the PodNotes tab. */
	openSettings(): void;
}

/** `useServices` throws outside a component tree that called `provideServices`. */
export const [useServices, provideServices] = createContext<ShellServices>();
