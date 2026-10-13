import type { IAPI } from "src/API/IAPI";
import type { PlayerController } from "src/player/PlayerController";
import type { FeedRepository } from "src/services/FeedRepository";
import type { Navigation } from "src/ui/PodcastView/Navigation";
import type { IPodNotesSettings } from "./IPodNotesSettings";

interface PodNotesViewRegistration {
	mountPodcastView(): void;
}

export interface IPodNotes {
	settings: IPodNotesSettings;
	api: IAPI;
	player: PlayerController;
	feeds: FeedRepository;
	navigation: Navigation;
	shouldMountPodcastView(): boolean;
	unregisterPodcastView(view: PodNotesViewRegistration): void;
	saveSettings(): Promise<void>;
	showPlayer(): Promise<void>;
	openSettingsTab(): void;
	captureTimestampToEditorOrNote(): Promise<string | null>;
}
