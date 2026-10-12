import { ItemView } from "obsidian";
import type { ViewStateResult, WorkspaceLeaf } from "obsidian";
import type { IPodNotes } from "../../types/IPodNotes";
import { VIEW_TYPE } from "../../constants";
import type { ShellServices } from "./context";
import { pageKey, parsePage } from "./pages";
import PodcastView from "./PodcastView.svelte";
import { mount, unmount } from "svelte";
import { derived } from "svelte/store";
import { plugin as pluginStore } from "src/store";

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

	/** The page is the view's workspace state; the full player always starts collapsed. */
	override getState(): Record<string, unknown> {
		return { page: this.plugin.navigation.current.page };
	}

	override async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const page = parsePage((state as { page?: unknown } | null)?.page);
		if (page) this.plugin.navigation.restore(page);
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
		const { plugin } = this;
		return {
			app: this.app,
			api: plugin.api,
			player: plugin.player,
			feeds: plugin.feeds,
			navigation: plugin.navigation,
			settings: derived(pluginStore, ($plugin) => $plugin.settings),
			captureTimestamp: () => plugin.captureTimestampToEditorOrNote(),
			openSettings: () => plugin.openSettingsTab(),
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
