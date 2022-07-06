import { Plugin, WorkspaceLeaf } from 'obsidian';
import { API } from 'src/API/API';
import { IAPI } from 'src/API/IAPI';
import { DEFAULT_SETTINGS, VIEW_TYPE } from 'src/constants';
import { PodNotesSettingsTab } from 'src/ui/settings/PodNotesSettingsTab';
import { PodcastView } from 'src/ui/PodcastView';
import { IPodNotesSettings } from './types/IPodNotesSettings';
import { plugin } from './store';

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
		plugin.set(this);
		await this.loadSettings();

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
				const id = this.manifest.id;	
				//@ts-ignore
				this.app.plugins.disablePlugin(id).then(() => this.app.plugins.enablePlugin(id))
			}
		})

		this.addSettingTab(new PodNotesSettingsTab(this.app, this));

		this.registerView(
			VIEW_TYPE,
			(leaf: WorkspaceLeaf) => {
				this.view = new PodcastView(leaf, this);
				this.api = new API();
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
