import { Writable } from "svelte/store";
import { QUEUE_SETTINGS } from "./constants";
import { IPodNotes } from "./types/IPodNotes";
import { Playlist } from "./types/Playlist";
import { StoreController } from "./types/StoreController";

export class QueueController extends StoreController<Playlist> {
	private plugin: IPodNotes;

	constructor(store: Writable<Playlist>, plugin: IPodNotes) {
		super(store)
		this.plugin = plugin;
	}

	protected onChange(value: Playlist) {
		this.plugin.settings.queue = {
			...value,
			// To ensure we always keep the correct playlist name
			...QUEUE_SETTINGS
		};

		this.plugin.saveSettings();
	}
}
