import { debounce, ItemView, Scope } from "obsidian";
import type { ViewStateResult, WorkspaceLeaf } from "obsidian";
import type { IPodNotes } from "../../types/IPodNotes";
import { VIEW_TYPE } from "../../constants";
import type { ShellServices } from "./context";
import { pageKey, parsePage } from "./pages";
import PodcastView from "./PodcastView.svelte";
import { mount, unmount } from "svelte";
import { derived, get, writable } from "svelte/store";
import { findExactPodcastNote, getPodcastNote } from "src/createPodcastNote";
import { createLibraryActions } from "src/services/library";
import {
	downloadedEpisodes,
	episodeListLimit,
	favorites,
	hidePlayedEpisodes,
	localFiles,
	playedEpisodes,
	playlists,
	plugin as pluginStore,
	queue,
	savedFeeds,
} from "src/store";
import type { Episode } from "src/types/Episode";
import { PodcastSearch } from "./podcastSearch";

export class MainView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private plugin: IPodNotes,
	) {
		super(leaf);
	}

	private podcastView: Record<string, unknown> | null = null;
	private stopSavingPage = () => {};

	override getViewType(): string {
		return VIEW_TYPE;
	}

	override getDisplayText(): string {
		return "Podcast Player";
	}

	override getIcon(): string {
		return "play-circle";
	}

	/** The page is the view's workspace state. Whether the full player is open is not saved. */
	override getState(): Record<string, unknown> {
		return { page: this.plugin.navigation.current.page };
	}

	override async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const page = parsePage((state as { page?: unknown } | null)?.page);
		if (page) this.plugin.navigation.replace(page);
		await super.setState(state, result);
	}

	protected override async onOpen(): Promise<void> {
		let saved = pageKey(this.plugin.navigation.current.page);
		this.stopSavingPage = this.plugin.navigation.subscribe(({ page }) => {
			if (pageKey(page) === saved) return;
			saved = pageKey(page);
			this.app.workspace.requestSaveLayout();
		});

		if (!this.plugin.shouldMountPodcastView()) {
			return;
		}

		this.mountPodcastView();
	}

	mountPodcastView(): void {
		if (this.podcastView) {
			return;
		}

		this.podcastView = mount(PodcastView, {
			target: this.contentEl,
			props: { services: this.services() },
		});
	}

	private services(): ShellServices {
		const { plugin, app } = this;
		const noteLookup = () => (episode: Episode) => findExactPodcastNote(episode) !== null;
		const rowHasNote = writable(noteLookup());
		const notesChanged = () => rowHasNote.set(noteLookup());
		// A view restored at startup lists its rows while the vault is still indexing.
		app.workspace.onLayoutReady(notesChanged);
		// Obsidian reports every file as created while it loads the vault, and a sync can
		// bring a thousand at once, so the rows look their notes up once per burst.
		const notesChangedSoon = debounce(notesChanged, 200, true);
		this.register(() => notesChangedSoon.cancel());
		const vaultChanged = () => {
			if (app.workspace.layoutReady) notesChangedSoon();
		};
		this.registerEvent(app.vault.on("create", vaultChanged));
		this.registerEvent(app.vault.on("delete", vaultChanged));
		this.registerEvent(app.vault.on("rename", vaultChanged));
		const settings = derived(pluginStore, ($plugin) => $plugin.settings);
		let notePath = get(settings).note.path;
		this.register(
			settings.subscribe(({ note }) => {
				if (note.path === notePath) return;
				notePath = note.path;
				notesChangedSoon();
			}),
		);
		const scope = new Scope(app.scope);
		this.scope = scope;
		return {
			app,
			api: plugin.api,
			player: plugin.player,
			feeds: plugin.feeds,
			navigation: plugin.navigation,
			scope,
			library: {
				savedFeeds,
				queue,
				favorites,
				playlists,
				localFiles,
				playedEpisodes,
				downloadedEpisodes,
				episodeListLimit,
				hidePlayedEpisodes,
			},
			actions: createLibraryActions({
				app,
				feeds: plugin.feeds,
				feedUrls: plugin.feedUrls,
				online: plugin.online,
			}),
			search: new PodcastSearch(plugin.feeds, plugin.online),
			online: plugin.online,
			settings,
			captureTimestamp: () => plugin.capture.timestamp(),
			openSettings: () => plugin.openSettingsTab(),
			saveTranscriptNote: () =>
				void plugin.getTranscriptionService().transcribeCurrentEpisode({ paid: false }),
			transcribeFromAudio: () =>
				plugin.getTranscriptionService().transcribeCurrentEpisodeFromAudio(),
			setAutoQueue: (enabled) => plugin.setAutoQueue(enabled),
			hasNote: (episode) => getPodcastNote(episode) !== null,
			rowHasNote,
		};
	}

	protected override async onClose(): Promise<void> {
		this.stopSavingPage();
		if (this.podcastView) {
			await unmount(this.podcastView);
			this.podcastView = null;
		}

		this.contentEl.empty();
		this.plugin.unregisterPodcastView(this);
	}
}
