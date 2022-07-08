import { App, PluginSettingTab, Setting } from 'obsidian';
import PodNotes from '../../main';
import PodcastQueryGrid from './PodcastQueryGrid.svelte';

export class PodNotesSettingsTab extends PluginSettingTab {
	plugin: PodNotes;
	
	private podcastQueryGrid: PodcastQueryGrid;

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

		const queryGridContainer = settingsContainer.createDiv();
		this.podcastQueryGrid = new PodcastQueryGrid({
			target: queryGridContainer
		});
			
		const defaultPlaybackRateSetting = new Setting(this.containerEl);
		defaultPlaybackRateSetting.setName('Default Playback Rate');
		defaultPlaybackRateSetting.addSlider((slider) => slider
			.setLimits(0.5, 4, 0.1)
			.setValue(this.plugin.settings.defaultPlaybackRate)
			.onChange(value => {
				this.plugin.settings.defaultPlaybackRate = value;
				this.plugin.saveSettings();
			})
			.setDynamicTooltip()
		);
	}

	hide(): void {
		this.podcastQueryGrid?.$destroy();
	}
}
