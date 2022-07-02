import { App, PluginSettingTab } from 'obsidian';
import PodNotes from '../../../main';
import { PodcastQueryGrid } from './PodcastQueryGrid';

export class PodNotesSettingsTab extends PluginSettingTab {
	plugin: PodNotes;

	constructor(app: App, plugin: PodNotes) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		const header = containerEl.createEl('h2', { text: 'PodNotes' });
		header.style.textAlign = 'center';

		const settingsContainer = containerEl.createDiv();
		settingsContainer.classList.add('settings-container');

		PodcastQueryGrid(settingsContainer);
	}

}
