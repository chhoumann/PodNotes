import { get, Unsubscriber, Writable } from "svelte/store";
import { QUEUE_SETTINGS } from "./constants";
import { currentEpisode } from "./store";
import { IPodNotes } from "./types/IPodNotes";
import { Playlist } from "./types/Playlist";
import { StoreController } from "./types/StoreController";

export class QueueController extends StoreController<Playlist> {
	private plugin: IPodNotes;
	private unsubscribeCurrentEpisode: Unsubscriber;

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

	public on(): StoreController<Playlist> {
		this.putCurrentEpisodeInQueue();
		return super.on();
	}

	public off(): StoreController<Playlist> {
		this.unsubscribeCurrentEpisode();
		return super.off();
	}

	private putCurrentEpisodeInQueue() {
		this.unsubscribeCurrentEpisode = currentEpisode.subscribe(episode => {
			if (!episode) return;
			
			const queue = get(this.store);
			const episodeIsInQueue = queue.episodes.find(e => e.title === episode.title);

			this.store.update(playlist => {
				// Move episode to front of queue
				if (episodeIsInQueue) {
					playlist.episodes = playlist.episodes.filter(e => e.title !== episode.title);
				}

				const newEpisodes = [episode, ...playlist.episodes];
				playlist.episodes = newEpisodes;

				return playlist;
			});
		});
	}
}
