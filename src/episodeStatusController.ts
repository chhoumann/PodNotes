import { Unsubscriber } from "svelte/store";
import { playedEpisodes } from "./store";
import { IPodNotes } from "./types/IPodNotes";
import { PlayedEpisode } from "./types/playedEpisode";

export class EpisodeStatusController {
    private plugin: IPodNotes;
    private unsubscribe: Unsubscriber;

    constructor(plugin: IPodNotes) {
        this.plugin = plugin;
    }

    public on(): EpisodeStatusController {
        this.unsubscribe = playedEpisodes.subscribe(this.onStoreUpdate.bind(this));
        return this;
    }

    public off(): EpisodeStatusController {
        this.unsubscribe();
        return this;
    }

    private onStoreUpdate(store: {[episodeName: string]: PlayedEpisode}) {
        this.plugin.settings.playedEpisodes = store;

        this.plugin.saveSettings();
    }
}