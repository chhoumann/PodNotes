import type { Writable } from "svelte/store";
import { StoreController } from "../types/StoreController";
import type { IPodNotes } from "../types/IPodNotes";
import type { PlayedEpisode } from "../types/PlayedEpisode";

type TPlayedStoreValue = { [episodeName: string]: PlayedEpisode };

export class EpisodeStatusController extends StoreController<TPlayedStoreValue> {
	private plugin: IPodNotes;

	constructor(store: Writable<TPlayedStoreValue>, plugin: IPodNotes) {
		super(store);
		this.plugin = plugin;
	}

	protected override onChange(value: TPlayedStoreValue) {
		this.plugin.settings.playedEpisodes = value;

		this.plugin.saveSettings();
	}
}
