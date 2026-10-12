import type { App } from "obsidian";
import { createContext } from "svelte";
import type { Readable } from "svelte/store";
import type { IAPI } from "src/API/IAPI";
import type { PlayerController } from "src/player/PlayerController";
import type { FeedRepository } from "src/services/FeedRepository";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import type { Navigation } from "./Navigation";

/** What the view's components get from the plugin. */
export interface ShellServices {
	readonly app: App;
	readonly api: IAPI;
	readonly player: PlayerController;
	readonly feeds: FeedRepository;
	readonly navigation: Navigation;
	/** Current through a settings toggle or an import, which replaces the object. */
	readonly settings: Readable<IPodNotesSettings>;
	/** Into the active note, else into the episode note. Resolves to that note's name, or null. */
	captureTimestamp(): Promise<string | null>;
	/** Opens Obsidian's settings at the PodNotes tab. */
	openSettings(): void;
}

/** `useServices` throws outside a component tree that called `provideServices`. */
export const [useServices, provideServices] = createContext<ShellServices>();
