import type { Writable } from "svelte/store";
import type { IPodNotes } from "../types/IPodNotes";
import { StoreController } from "../types/StoreController";

export class HidePlayedEpisodesController extends StoreController<boolean> {
	private plugin: IPodNotes;

	constructor(store: Writable<boolean>, plugin: IPodNotes) {
		super(store);
		this.plugin = plugin;
	}

	protected override onChange(value: boolean) {
		if (this.plugin.settings.hidePlayedEpisodes === value) return;

		this.plugin.settings.hidePlayedEpisodes = value;
		this.plugin.saveSettings();
	}
}
