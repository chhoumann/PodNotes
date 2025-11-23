import type { Writable } from "svelte/store";
import type { IPodNotes } from "../types/IPodNotes";
import type { Playlist } from "../types/Playlist";
import { StoreController } from "../types/StoreController";

export class PlaylistController extends StoreController<{[playlistName: string]: Playlist}> {
	private plugin: IPodNotes;

	constructor(store: Writable<{[playlistName: string]: Playlist}>, plugin: IPodNotes) {
		super(store)
		this.plugin = plugin;
	}

	protected onChange(value: {[playlistName: string]: Playlist}) {
		this.plugin.settings.playlists = value;

		this.plugin.saveSettings();
	}

}
