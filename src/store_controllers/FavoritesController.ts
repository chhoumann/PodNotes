import type { Writable } from "svelte/store";
import { FAVORITES_SETTINGS } from "../constants";
import type { IPodNotes } from "../types/IPodNotes";
import type { Playlist } from "../types/Playlist";
import { StoreController } from "../types/StoreController";

export class FavoritesController extends StoreController<Playlist> {
	private plugin: IPodNotes;

	constructor(store: Writable<Playlist>, plugin: IPodNotes) {
		super(store);
		this.plugin = plugin;
	}

	protected override onChange(value: Playlist) {
		this.plugin.settings.favorites = {
			...value,
			// To ensure we always keep the correct playlist name
			...FAVORITES_SETTINGS,
		};

		this.plugin.saveSettings();
	}
}
