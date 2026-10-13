import type { IAPI } from "src/API/IAPI";
import type { PlayerController } from "src/player/PlayerController";
import type { CaptureService } from "src/services/CaptureService";
import type { FeedRepository } from "src/services/FeedRepository";
import type { FeedUrlRepository } from "src/services/FeedUrlRepository";
import type { Navigation } from "src/ui/PodcastView/Navigation";
import type { Readable } from "svelte/store";
import type { IPodNotesSettings } from "./IPodNotesSettings";

interface PodNotesViewRegistration {
	mountPodcastView(): void;
}

export interface IPodNotes {
	settings: IPodNotesSettings;
	api: IAPI;
	player: PlayerController;
	feeds: FeedRepository;
	feedUrls: FeedUrlRepository;
	navigation: Navigation;
	capture: CaptureService;
	online: Readable<boolean>;
	shouldMountPodcastView(): boolean;
	unregisterPodcastView(view: PodNotesViewRegistration): void;
	saveSettings(): Promise<void>;
	showPlayer(): Promise<void>;
	openSettingsTab(): void;
	setAutoQueue(enabled: boolean): void;
}
