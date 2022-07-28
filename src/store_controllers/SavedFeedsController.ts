import { Writable } from "svelte/store";
import { IPodNotes } from "../types/IPodNotes";
import { PodcastFeed } from "../types/PodcastFeed";
import { StoreController } from "../types/StoreController";

type TSavedFeedsStoreValue = { [podcastName: string]: PodcastFeed };

export class SavedFeedsController extends StoreController<TSavedFeedsStoreValue> {
    private plugin: IPodNotes;

    constructor(store: Writable<TSavedFeedsStoreValue>, plugin: IPodNotes) {
        super(store)
        this.plugin = plugin;
    }

    protected onChange(value: TSavedFeedsStoreValue) {
        this.plugin.settings.savedFeeds = value;

        this.plugin.saveSettings();
    }
}
