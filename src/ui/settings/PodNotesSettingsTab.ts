import { App, MarkdownRenderer, PluginSettingTab, Setting } from 'obsidian';
import PodNotes from '../../main';
import PodcastQueryGrid from './PodcastQueryGrid.svelte';
import PlaylistManager from './PlaylistManager.svelte';
import { DownloadPathTemplateEngine, TimestampTemplateEngine } from '../../TemplateEngine';
import { FilePathTemplateEngine } from '../../TemplateEngine';
import { episodeCache } from 'src/store';
import { Episode } from 'src/types/Episode';
import { get } from 'svelte/store';


export class PodNotesSettingsTab extends PluginSettingTab {
	plugin: PodNotes;

	private podcastQueryGrid: PodcastQueryGrid;
	private playlistManager: PlaylistManager;

	private settingsTab: PodNotesSettingsTab;

	constructor(app: App, plugin: PodNotes) {
		super(app, plugin);
		this.plugin = plugin;
		this.settingsTab = this;
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
		this.addNoteSettings(settingsContainer);
		this.addDownloadSettings(settingsContainer);
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

	private addNoteSettings(settingsContainer: HTMLDivElement) {
		const container = settingsContainer.createDiv();

		container.createEl('h4', { text: 'Note settings' });

		const timestampSetting = new Setting(container)
			.setName('Capture timestamp format')
			.setHeading()
			.addTextArea(textArea => {
				textArea.setValue(this.plugin.settings.timestamp.template)
				textArea.setPlaceholder('- {{linktime}} ')
				textArea.onChange(value => {
					this.plugin.settings.timestamp.template = value;
					this.plugin.saveSettings();
					updateTimestampDemo(value);
				});
				textArea.inputEl.style.width = "100%";
			})

		timestampSetting.settingEl.style.flexDirection = 'column';
		timestampSetting.settingEl.style.alignItems = 'unset';
		timestampSetting.settingEl.style.gap = '10px';

		const timestampFormatDemoEl = container.createDiv();

		const updateTimestampDemo = (value: string) => {
			if (!this.plugin.api.podcast) return;

			const demoVal = TimestampTemplateEngine(value);
			timestampFormatDemoEl.empty();
			// @ts-ignore - documentation says component is optional, yet not providing one causes an error
			MarkdownRenderer.renderMarkdown(demoVal, timestampFormatDemoEl, "", null);
		}

		updateTimestampDemo(this.plugin.settings.timestamp.template);
		
		const randomEpisode = getRandomEpisode();

		const noteCreationFilePathSetting = new Setting(container)
			.setName('Note creation file path')
			.setHeading()
			.addText((textComponent) => {
				textComponent.setValue(this.plugin.settings.note.path)
				textComponent.setPlaceholder('inputs/podcasts/{{podcast}} - {{title}}.md')
				textComponent.onChange(value => {
					this.plugin.settings.note.path = value;
					this.plugin.saveSettings();

					const demoVal = FilePathTemplateEngine(value, randomEpisode);
					noteCreationFilePathDemoEl.empty();
					// @ts-ignore - documentation says component is optional, yet not providing one causes an error
					MarkdownRenderer.renderMarkdown(demoVal, noteCreationFilePathDemoEl, "", null);
				});
				textComponent.inputEl.style.width = "100%";
			});

		noteCreationFilePathSetting.settingEl.style.flexDirection = 'column';
		noteCreationFilePathSetting.settingEl.style.alignItems = 'unset';
		noteCreationFilePathSetting.settingEl.style.gap = '10px';

		const noteCreationFilePathDemoEl = container.createDiv();

		const noteCreationSetting = new Setting(container)
			.setName('Note creation template')
			.setHeading()
			.addTextArea(textArea => {
				textArea.setValue(this.plugin.settings.note.template)
				textArea.onChange(value => {
					this.plugin.settings.note.template = value;
					this.plugin.saveSettings();
				});

				textArea.inputEl.style.width = "100%";
				textArea.inputEl.style.height = "25vh";
				textArea.setPlaceholder(
					"## {{title}}" +
					"\n![]({{artwork}})" + 
					"\n### Metadata" +
					"\nPodcast:: {{podcast}}" +
					"\nEpisode:: {{title}}" +
					"\nPublishDate:: {{date:YYYY-MM-DD}}" +
					"\n### Description" +
					"\n> {{description}}"
				);
			});

		noteCreationSetting.settingEl.style.flexDirection = 'column';
		noteCreationSetting.settingEl.style.alignItems = 'unset';
		noteCreationSetting.settingEl.style.gap = '10px';
	}

	private addDownloadSettings(container: HTMLDivElement) {
		container.createEl('h4', { text: 'Download settings' });

		const randomEpisode = getRandomEpisode();

		const downloadPathSetting = new Setting(container)
			.setName('Episode download path')
			.setDesc('The path where the episode will be downloaded to. Avoid setting an extension, as it will be added automatically.')
			.setHeading()
			.addText((textComponent) => {
				textComponent.setValue(this.plugin.settings.download.path)
				textComponent.setPlaceholder('inputs/podcasts/{{podcast}} - {{title}}')
				textComponent.onChange(value => {
					this.plugin.settings.download.path = value;
					this.plugin.saveSettings();

					const demoVal = DownloadPathTemplateEngine(value, randomEpisode);
					downloadFilePathDemoEl.empty();
					// @ts-ignore - documentation says component is optional, yet not providing one causes an error
					MarkdownRenderer.renderMarkdown(`${demoVal}.mp3`, downloadFilePathDemoEl, "", null);
				});
				textComponent.inputEl.style.width = "100%";
			});

		downloadPathSetting.settingEl.style.flexDirection = 'column';
		downloadPathSetting.settingEl.style.alignItems = 'unset';
		downloadPathSetting.settingEl.style.gap = '10px';

		const downloadFilePathDemoEl = container.createDiv();
	}
}

function getRandomEpisode(): Episode {
	const fallbackDemoObj = {
		description: "demo",
		content: "demo",
		podcastName: "demo",
		title: "demo",
		url: "demo",
		artworkUrl: "demo",
		streamUrl: "demo",
		episodeDate: new Date(),
		feedUrl: "demo",
	};

	const feedEpisodes = Object.values(get(episodeCache));
	if (!feedEpisodes.length) return fallbackDemoObj;

	const randomFeed =
		feedEpisodes[Math.floor(Math.random() * feedEpisodes.length)];
	if (!randomFeed.length) return fallbackDemoObj;

	const randomEpisode =
		randomFeed[Math.floor(Math.random() * randomFeed.length)];

	return randomEpisode;
}
