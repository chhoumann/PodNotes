import { Plugin, WorkspaceLeaf } from 'obsidian';
import { API } from 'src/API/API';
import { IAPI } from 'src/API/IAPI';
import { DEFAULT_SETTINGS, VIEW_TYPE } from 'src/constants';
import { Player } from 'src/Player';
import { PodcastView } from 'src/PodcastView';
import { IPodNotesSettings } from './IPodNotesSettings';

export default class PodNotes extends Plugin {
	public api: IAPI;
	public settings: IPodNotesSettings;
	
	private view: PodcastView;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: 'start-playing',
			name: 'Play Podcast',
			checkCallback: () => !Player.Instance.isPlaying && !!this.view.podcast,
			callback: () => {
				this.api.stop();
			}
		});

		this.addCommand({
			id: 'stop-playing',
			name: 'Stop Podcast',
			checkCallback: () => {
				return this.api.isPlaying && !!this.api.podcast;
			},
			callback: () => {
				this.api.stop();
			},
		})

		//this.addSettingTab(new SampleSettingTab(this.app, this));

		this.registerView(
			VIEW_TYPE,
			(leaf: WorkspaceLeaf) => {
				this.view = new PodcastView(leaf)
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
