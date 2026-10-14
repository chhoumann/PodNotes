import type { App, Scope } from "obsidian";
import { createContext } from "svelte";
import type { Readable, Writable } from "svelte/store";
import type { IAPI } from "src/API/IAPI";
import type { PlayerController } from "src/player/PlayerController";
import type { Capture } from "src/services/CaptureService";
import type { FeedRepository } from "src/services/FeedRepository";
import type { LibraryActions } from "src/services/library";
import type DownloadedEpisode from "src/types/DownloadedEpisode";
import type { Episode } from "src/types/Episode";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import type { PlayedEpisode } from "src/types/PlayedEpisode";
import type { Playlist } from "src/types/Playlist";
import type { PodcastFeed } from "src/types/PodcastFeed";
import type { Navigation } from "./Navigation";
import type { PodcastSearch } from "./podcastSearch";

/** The user's library, as the view reads it, and the preference its lists toggle. */
export interface Library {
	readonly savedFeeds: Readable<Record<string, PodcastFeed>>;
	readonly queue: Readable<Playlist>;
	readonly favorites: Readable<Playlist>;
	readonly playlists: Readable<Record<string, Playlist>>;
	readonly localFiles: Readable<Playlist>;
	readonly playedEpisodes: Readable<Record<string, PlayedEpisode>>;
	readonly downloadedEpisodes: Readable<Record<string, DownloadedEpisode[]>>;
	readonly episodeListLimit: Readable<number>;
	readonly hidePlayedEpisodes: Writable<boolean>;
}

/** What the view's components get from the plugin. */
export interface ShellServices {
	readonly app: App;
	readonly api: IAPI;
	readonly player: PlayerController;
	readonly feeds: FeedRepository;
	readonly navigation: Navigation;
	/** The view's own keys. Obsidian hands them every key typed while the view's leaf is active. */
	readonly scope: Scope;
	readonly library: Library;
	readonly actions: LibraryActions;
	readonly search: PodcastSearch;
	/** Whether the device has a connection. Network controls follow it, and lists group by it. */
	readonly online: Readable<boolean>;
	/**
	 * Current through a settings toggle, the note path field and an import, which replaces
	 * the object.
	 */
	readonly settings: Readable<IPodNotesSettings>;
	/** Into the note being written, else into the episode note. Null when nothing was captured. */
	captureTimestamp(): Promise<Capture | null>;
	/** Opens Obsidian's settings at the PodNotes tab. */
	openSettings(): void;
	/** Whether playback queues the episode the user switches from, and plays the queue on. */
	setAutoQueue(enabled: boolean): void;
	/** Whether the episode has a note: a vault lookup, so a caller decides when to ask again. */
	hasNote(episode: Episode): boolean;
	/**
	 * Whether a row shows its episode's note: found by guid or at its template path only,
	 * so every row can ask. A new lookup each time a note is created, deleted or renamed, and
	 * when the note path setting changes.
	 */
	readonly rowHasNote: Readable<(episode: Episode) => boolean>;
}

/** `useServices` throws outside a component tree that called `provideServices`. */
export const [useServices, provideServices] = createContext<ShellServices>();
