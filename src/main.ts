import FeedParser from 'src/parser/feedParser';
import { currentEpisode, playedEpisodes, savedFeeds } from 'src/store';
import { Notice, Plugin, WorkspaceLeaf } from 'obsidian';
import { API } from 'src/API/API';
import { IAPI } from 'src/API/IAPI';
import { DEFAULT_SETTINGS, VIEW_TYPE } from 'src/constants';
import { PodNotesSettingsTab } from 'src/ui/settings/PodNotesSettingsTab';
import { MainView } from 'src/ui/PodcastView';
import { IPodNotesSettings } from './types/IPodNotesSettings';
import { plugin } from './store';
import { get } from 'svelte/store';
import { IPodNotes } from './types/IPodNotes';
import { EpisodeStatusController } from './EpisodeStatusController';
import { StoreController } from './types/StoreController';
import { PlayedEpisode } from './types/playedEpisode';
import { PodcastFeed } from './types/PodcastFeed';
import { SavedFeedsController } from './SavedFeedsController';

export default class PodNotes extends Plugin implements IPodNotes {
	public api: IAPI;
	public settings: IPodNotesSettings;
	
	private view: MainView;

	private playedEpisodeController: StoreController<{[episodeName: string]: PlayedEpisode}>;
	private savedFeedsController: StoreController<{[podcastName: string]: PodcastFeed}>;

	async onload() {
		plugin.set(this);

		await this.loadSettings();

		playedEpisodes.set(this.settings.playedEpisodes);
		savedFeeds.set(this.settings.savedFeeds);

		this.playedEpisodeController = new EpisodeStatusController(playedEpisodes, this).on();
		this.savedFeedsController = new SavedFeedsController(savedFeeds, this).on();

		this.addCommand({
			id: 'start-playing',
			name: 'Play Podcast',
			checkCallback: (checking) => {
				if (checking) {
					return !this.api.isPlaying && !!this.api.podcast;
				}

				this.api.start();
			},
		});

		this.addCommand({
			id: 'stop-playing',
			name: 'Stop Podcast',
			checkCallback: (checking) => {
				if (checking) {
					return this.api.isPlaying && !!this.api.podcast;
				}

				this.api.stop();
			},
		})

		this.addCommand({
			id: 'hrpn',
			name: 'Reload PodNotes',
			callback: () => {
				const id = this.manifest.id;	
				//@ts-ignore
				this.app.plugins.disablePlugin(id).then(() => this.app.plugins.enablePlugin(id))
			}
		})

		this.addSettingTab(new PodNotesSettingsTab(this.app, this));

		this.registerView(
			VIEW_TYPE,
			(leaf: WorkspaceLeaf) => {
				this.view = new MainView(leaf, this);
				this.api = new API();
				return this.view;
			}
		)

		this.app.workspace.onLayoutReady(this.onLayoutReady.bind(this));

		this.registerObsidianProtocolHandler('podnotes', async ({url, episodeName, time}) => {
			if (!url || !episodeName) {
				new Notice("No good");
				return;
			}

			const decodedName = episodeName.replace(/\+/g, ' ');
			const currentEp = get(currentEpisode);

			if (currentEp?.feedUrl !== url && currentEp?.title !== decodedName) {
				const pcastParser = new FeedParser();
				const episode = await pcastParser.findItemByTitle(decodedName, url);
				currentEpisode.set(episode);
			}

			if (time) {
				this.api.currentTime = parseFloat(time);
			}
		});
	}

	onLayoutReady(): void {
		if (this.app.workspace.getLeavesOfType(VIEW_TYPE).length) {
			return;
		}

		this.app.workspace.getRightLeaf(false).setViewState({
			type: VIEW_TYPE
		});
	}

	onunload() {
		this?.playedEpisodeController.off();
		this?.savedFeedsController.off();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
