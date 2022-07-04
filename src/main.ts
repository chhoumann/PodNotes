import { Plugin, WorkspaceLeaf } from 'obsidian';
import { API } from 'src/API/API';
import { IAPI } from 'src/API/IAPI';
import { DEFAULT_SETTINGS, VIEW_TYPE } from 'src/constants';
import { Player } from 'src/Player';
import { PodNotesSettingsTab } from 'src/ui/settings/PodNotesSettingsTab';
import { PodcastView } from 'src/ui/PodcastView';
import { IPodNotesSettings } from './types/IPodNotesSettings';

export interface IPodNotes {
	settings: IPodNotesSettings;
	api: IAPI;
	saveSettings(): Promise<void>;
}

export default class PodNotes extends Plugin implements IPodNotes {
	public api: IAPI;
	public settings: IPodNotesSettings;
	
	private view: PodcastView;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: 'start-playing',
			name: 'Play Podcast',
			checkCallback: (checking) => {
				if (checking) {
					return !Player.Instance.isPlaying && !!this.view.podcast;
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
			id: 'clear-podcast',
			name: 'Clear Podcast',
			checkCallback: (checking) => {
				if (checking) {
					return !!this.api.podcast;
				}

				this.api.clearPodcast();
				this.api.stop();
			}
		})

		this.addCommand({
			id: 'hrpn',
			name: 'Reload PodNotes',
			callback: () => {
				const id = 'podnotes';
				//@ts-ignore
				this.app.plugins.disablePlugin(id).then(() => this.app.plugins.enablePlugin(id))
			}
		})

		this.addSettingTab(new PodNotesSettingsTab(this.app, this));

		this.registerView(
			VIEW_TYPE,
			(leaf: WorkspaceLeaf) => {
				this.view = new PodcastView(leaf, this);
				this.api = new API(this.view);
				return this.view;
			}
		)

		this.app.workspace.onLayoutReady(this.onLayoutReady.bind(this));
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
	
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
