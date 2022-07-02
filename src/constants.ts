import { PodNote } from './types/PodNotes';
import { IPodNotesSettings } from "src/types/IPodNotesSettings";

export const VIEW_TYPE = "podcast_player_view";

export const DEFAULT_SETTINGS: IPodNotesSettings = {
	savedFeeds: [],
	podNotes: new Map<string, PodNote>(),
}
