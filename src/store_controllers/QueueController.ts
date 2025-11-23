import type { Unsubscriber, Writable } from "svelte/store";
import { get } from "svelte/store";
import { QUEUE_SETTINGS } from "../constants";
import { currentEpisode } from "../store";
import type { IPodNotes } from "../types/IPodNotes";
import type { Playlist } from "../types/Playlist";
import { StoreController } from "../types/StoreController";

export class QueueController extends StoreController<Playlist> {
	private plugin: IPodNotes;
	private unsubscribeCurrentEpisode: Unsubscriber | null = null;

	constructor(store: Writable<Playlist>, plugin: IPodNotes) {
		super(store);
		this.plugin = plugin;
	}

	protected override onChange(value: Playlist) {
		this.plugin.settings.queue = {
			...value,
			// To ensure we always keep the correct playlist name
			...QUEUE_SETTINGS,
		};

		this.plugin.saveSettings();
	}

	public override on(): StoreController<Playlist> {
		this.removeCurrentEpisodeFromQueue();
		return super.on();
	}

	public override off(): StoreController<Playlist> {
		this.unsubscribeCurrentEpisode?.();
		return super.off();
	}

	private removeCurrentEpisodeFromQueue() {
		this.unsubscribeCurrentEpisode = currentEpisode.subscribe((episode) => {
			if (!episode) return;

			const queue = get(this.store);
			const episodeIsInQueue = queue.episodes.find(
				(e) => e.title === episode.title,
			);

			this.store.update((playlist) => {
				if (!episodeIsInQueue) return playlist;

				playlist.episodes = playlist.episodes.filter(
					(e) => e.title !== episode.title,
				);
				return playlist;
			});
		});
	}
}
