import { App, PluginSettingTab, Setting } from 'obsidian';
import PodNotes from '../../main';
import PodcastQueryGrid from './PodcastQueryGrid.svelte';
import PlaylistManager from './PlaylistManager.svelte';

export class PodNotesSettingsTab extends PluginSettingTab {
	plugin: PodNotes;
	
	private podcastQueryGrid: PodcastQueryGrid;
	private playlistManager: PlaylistManager;

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

		new Setting(settingsContainer)
			.setName('Search Podcasts')
			.setHeading()
			.setDesc('Search for podcasts by name or custom feed URL.');
		
		const queryGridContainer = settingsContainer.createDiv();
		this.podcastQueryGrid = new PodcastQueryGrid({
			target: queryGridContainer
		});

		new Setting(settingsContainer)
			.setName('Playlists')
			.setHeading()
			.setDesc(`Add playlists to gather podcast episodes.`);

		const playlistManagerContainer = settingsContainer.createDiv();
		this.playlistManager = new PlaylistManager({
			target: playlistManagerContainer
		});
		
		this.addDefaultPlaybackRateSetting(settingsContainer);
		this.addSkipLengthSettings(settingsContainer);
	}

	hide(): void {
		this.podcastQueryGrid?.$destroy();
		this.playlistManager?.$destroy();
	}

	private addDefaultPlaybackRateSetting(container: HTMLElement): void {
		new Setting(container)
			.setName('Default Playback Rate')
			.addSlider((slider) => slider
				.setLimits(0.5, 4, 0.1)
				.setValue(this.plugin.settings.defaultPlaybackRate)
				.onChange(value => {
					this.plugin.settings.defaultPlaybackRate = value;
					this.plugin.saveSettings();
				})
				.setDynamicTooltip()
			);
	}

	private addSkipLengthSettings(container: HTMLElement): void {
		new Setting(container)
			.setName('Skip backward length (s)')
			.addText((textComponent) => {
				textComponent.inputEl.type = 'number';
				textComponent
					.setValue(`${this.plugin.settings.skipBackwardLength}`)
					.onChange(value => {
						this.plugin.settings.skipBackwardLength = parseInt(value);
						this.plugin.saveSettings();
					})
					.setPlaceholder('seconds');
			});

		new Setting(container)
			.setName('Skip forward length (s)')
			.addText((textComponent) => {
				textComponent.inputEl.type = 'number';
				textComponent
					.setValue(`${this.plugin.settings.skipForwardLength}`)
					.onChange(value => {
						this.plugin.settings.skipForwardLength = parseInt(value);
						this.plugin.saveSettings();
					})
					.setPlaceholder('seconds');
			});
	}
}
