import type { IAPI } from "src/API/IAPI";
import type { IPodNotesSettings } from "./IPodNotesSettings";

interface PodNotesViewRegistration {
	mountPodcastView(): void;
}

export interface IPodNotes {
	settings: IPodNotesSettings;
	api: IAPI;
	shouldMountPodcastView(): boolean;
	unregisterPodcastView(view: PodNotesViewRegistration): void;
	saveSettings(): Promise<void>;
}
