import type DownloadedEpisode from "src/types/DownloadedEpisode";
import type { IPodNotes } from "src/types/IPodNotes";
import { StoreController } from "src/types/StoreController";
import type { Writable } from "svelte/store";

export default class DownloadedEpisodesController extends StoreController<{[podcastName: string]: DownloadedEpisode[]}> {
	private plugin: IPodNotes;

	constructor(store: Writable<{[podcastName: string]: DownloadedEpisode[]}>, plugin: IPodNotes) {
		super(store);
		this.plugin = plugin;
	}

	protected onChange(value: {[podcastName: string]: DownloadedEpisode[]}) {
		this.plugin.settings.downloadedEpisodes = value;

		this.plugin.saveSettings();
	}
}
