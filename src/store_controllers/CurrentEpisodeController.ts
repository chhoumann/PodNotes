import { Episode } from "src/types/Episode";
import { IPodNotes } from "src/types/IPodNotes";
import { StoreController } from "src/types/StoreController";
import { Writable } from "svelte/store";

export default class CurrentEpisodeController extends StoreController<Episode> {
	private plugin: IPodNotes;

	constructor(store: Writable<Episode>, plugin: IPodNotes) {
		super(store);
		this.plugin = plugin;
	}

	protected onChange(value: Episode) {
		this.plugin.settings.currentEpisode = value;

		this.plugin.saveSettings();
	}
}
