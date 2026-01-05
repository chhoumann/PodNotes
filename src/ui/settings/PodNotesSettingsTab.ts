import {
	type App,
	Component,
	MarkdownRenderer,
	Notice,
	PluginSettingTab,
	Setting,
} from "obsidian";
import type PodNotes from "../../main";
import PodcastQueryGrid from "./PodcastQueryGrid.svelte";
import PlaylistManager from "./PlaylistManager.svelte";
import { mount, unmount } from "svelte";
import {
	DownloadPathTemplateEngine,
	FilePathTemplateEngine,
	TimestampTemplateEngine,
} from "../../TemplateEngine";
import { episodeCache, savedFeeds } from "src/store/index";
import type { Episode } from "src/types/Episode";
import { get } from "svelte/store";
import { exportOPML, importOPML } from "src/opml";
import { clearFeedCache } from "src/services/FeedCacheService";

export class PodNotesSettingsTab extends PluginSettingTab {
	plugin: PodNotes;

	private podcastQueryGrid: Record<string, unknown> | null = null;
	private playlistManager: Record<string, unknown> | null = null;

	private settingsTab: PodNotesSettingsTab;

	constructor(app: App, plugin: PodNotes) {
		super(app, plugin);
		this.plugin = plugin;
		this.settingsTab = this;
	}

	override display(): void {
		const { containerEl } = this;

		containerEl.empty();

		const header = containerEl.createEl("h2", { text: "PodNotes" });
		header.style.textAlign = "center";

		const settingsContainer = containerEl.createDiv();
		settingsContainer.classList.add("settings-container");

		new Setting(settingsContainer)
			.setName("Search Podcasts")
			.setHeading()
			.setDesc("Search for podcasts by name or custom feed URL.");

		const queryGridContainer = settingsContainer.createDiv();
		this.podcastQueryGrid = mount(PodcastQueryGrid, {
			target: queryGridContainer,
		});

		new Setting(settingsContainer)
			.setName("Playlists")
			.setHeading()
			.setDesc("Add playlists to gather podcast episodes.");

		const playlistManagerContainer = settingsContainer.createDiv();
		this.playlistManager = mount(PlaylistManager, {
			target: playlistManagerContainer,
		});

		this.addDefaultPlaybackRateSetting(settingsContainer);
		this.addDefaultVolumeSetting(settingsContainer);
		this.addSkipLengthSettings(settingsContainer);
		this.addNoteSettings(settingsContainer);
		this.addDownloadSettings(settingsContainer);
		this.addPerformanceSettings(settingsContainer);
		this.addImportExportSettings(settingsContainer);
		this.addTranscriptSettings(settingsContainer);
	}

	override hide(): void {
		if (this.podcastQueryGrid) {
			void unmount(this.podcastQueryGrid);
			this.podcastQueryGrid = null;
		}

		if (this.playlistManager) {
			void unmount(this.playlistManager);
			this.playlistManager = null;
		}
	}

	private addDefaultPlaybackRateSetting(container: HTMLElement): void {
		new Setting(container)
			.setName("Default Playback Rate")
			.addSlider((slider) =>
				slider
					.setLimits(0.5, 4, 0.1)
					.setValue(this.plugin.settings.defaultPlaybackRate)
					.onChange((value) => {
						this.plugin.settings.defaultPlaybackRate = value;
						this.plugin.saveSettings();
					})
					.setDynamicTooltip(),
			);
	}

	private addDefaultVolumeSetting(container: HTMLElement): void {
		new Setting(container)
			.setName("Default Volume")
			.setDesc("Set the default playback volume.")
			.addSlider((slider) =>
				slider
					.setLimits(0, 1, 0.05)
					.setValue(this.plugin.settings.defaultVolume)
					.onChange((value) => {
						this.plugin.settings.defaultVolume = value;
						this.plugin.saveSettings();
					})
					.setDynamicTooltip(),
			);
	}

	private addSkipLengthSettings(container: HTMLElement): void {
		new Setting(container)
			.setName("Skip backward length (s)")
			.addText((textComponent) => {
				textComponent.inputEl.type = "number";
				textComponent
					.setValue(`${this.plugin.settings.skipBackwardLength}`)
					.onChange((value) => {
						this.plugin.settings.skipBackwardLength = Number.parseInt(value);
						this.plugin.saveSettings();
					})
					.setPlaceholder("seconds");
			});

		new Setting(container)
			.setName("Skip forward length (s)")
			.addText((textComponent) => {
				textComponent.inputEl.type = "number";
				textComponent
					.setValue(`${this.plugin.settings.skipForwardLength}`)
					.onChange((value) => {
						this.plugin.settings.skipForwardLength = Number.parseInt(value);
						this.plugin.saveSettings();
					})
					.setPlaceholder("seconds");
			});
	}

	private addNoteSettings(settingsContainer: HTMLDivElement) {
		const container = settingsContainer.createDiv();

		container.createEl("h4", { text: "Note settings" });

		const timestampSetting = new Setting(container)
			.setName("Capture timestamp format")
			.setHeading()
			.addTextArea((textArea) => {
				textArea.setValue(this.plugin.settings.timestamp.template);
				textArea.setPlaceholder("- {{linktime}} ");
				textArea.onChange((value) => {
					this.plugin.settings.timestamp.template = value;
					this.plugin.saveSettings();
					updateTimestampDemo(value);
				});
				textArea.inputEl.style.width = "100%";
			});

		timestampSetting.settingEl.style.flexDirection = "column";
		timestampSetting.settingEl.style.alignItems = "unset";
		timestampSetting.settingEl.style.gap = "10px";

		const timestampFormatDemoEl = container.createDiv();

		const updateTimestampDemo = (value: string) => {
			if (!this.plugin.api.podcast) return;

			const demoVal = TimestampTemplateEngine(value);
			timestampFormatDemoEl.empty();
			MarkdownRenderer.renderMarkdown(
				demoVal,
				timestampFormatDemoEl,
				"",
				new Component(),
			);
		};

		new Setting(container)
			.setName("Timestamp offset (s)")
			.setDesc(
				"Subtract this many seconds when capturing a timestamp to compensate for reaction time.",
			)
			.addText((textComponent) => {
				textComponent.inputEl.type = "number";
				textComponent
					.setValue(`${this.plugin.settings.timestamp.offset}`)
					.onChange((value) => {
						const parsedValue = Number.parseInt(value, 10);
						this.plugin.settings.timestamp.offset = Number.isNaN(parsedValue)
							? 0
							: Math.max(0, parsedValue);
						this.plugin.saveSettings();
						updateTimestampDemo(this.plugin.settings.timestamp.template);
					})
					.setPlaceholder("e.g. 5");
			});

		updateTimestampDemo(this.plugin.settings.timestamp.template);

		const randomEpisode = getRandomEpisode();

		const noteCreationFilePathSetting = new Setting(container)
			.setName("Note creation file path")
			.setHeading()
			.addText((textComponent) => {
				textComponent.setValue(this.plugin.settings.note.path);
				textComponent.setPlaceholder(
					"inputs/podcasts/{{podcast}} - {{title}}.md",
				);
				textComponent.onChange((value) => {
					this.plugin.settings.note.path = value;
					this.plugin.saveSettings();

					const demoVal = FilePathTemplateEngine(value, randomEpisode);
					noteCreationFilePathDemoEl.empty();
					MarkdownRenderer.renderMarkdown(
						demoVal,
						noteCreationFilePathDemoEl,
						"",
						new Component(),
					);
				});
				textComponent.inputEl.style.width = "100%";
			});

		noteCreationFilePathSetting.settingEl.style.flexDirection = "column";
		noteCreationFilePathSetting.settingEl.style.alignItems = "unset";
		noteCreationFilePathSetting.settingEl.style.gap = "10px";

		const noteCreationFilePathDemoEl = container.createDiv();

		const noteCreationSetting = new Setting(container)
			.setName("Note creation template")
			.setHeading()
			.addTextArea((textArea) => {
				textArea.setValue(this.plugin.settings.note.template);
				textArea.onChange((value) => {
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
						"\n> {{description}}",
					    "\n### Audio File URL" +
						"\n> {{stream}}",
				);
			});

		noteCreationSetting.settingEl.style.flexDirection = "column";
		noteCreationSetting.settingEl.style.alignItems = "unset";
		noteCreationSetting.settingEl.style.gap = "10px";
	}

	private addDownloadSettings(container: HTMLDivElement) {
		container.createEl("h4", { text: "Download settings" });

		const randomEpisode = getRandomEpisode();

		const downloadPathSetting = new Setting(container)
			.setName("Episode download path")
			.setDesc(
				"The path where the episode will be downloaded to. Avoid setting an extension, as it will be added automatically.",
			)
			.setHeading()
			.addText((textComponent) => {
				textComponent.setValue(this.plugin.settings.download.path);
				textComponent.setPlaceholder("inputs/podcasts/{{podcast}} - {{title}}");
				textComponent.onChange((value) => {
					this.plugin.settings.download.path = value;
					this.plugin.saveSettings();

					const demoVal = DownloadPathTemplateEngine(value, randomEpisode);
					downloadFilePathDemoEl.empty();
					MarkdownRenderer.renderMarkdown(
						`${demoVal}.mp3`,
						downloadFilePathDemoEl,
						"",
						new Component(),
					);
				});
				textComponent.inputEl.style.width = "100%";
			});

		downloadPathSetting.settingEl.style.flexDirection = "column";
		downloadPathSetting.settingEl.style.alignItems = "unset";
		downloadPathSetting.settingEl.style.gap = "10px";

		const downloadFilePathDemoEl = container.createDiv();
	}

	private addPerformanceSettings(container: HTMLDivElement) {
		container.createEl("h4", { text: "Performance" });

		new Setting(container)
			.setName("Cache podcast feeds")
			.setDesc("Store recently downloaded feeds locally for faster startup.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.feedCache.enabled)
					.onChange(async (value) => {
						this.plugin.settings.feedCache.enabled = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(container)
			.setName("Cache duration (hours)")
			.setDesc("Choose how long to reuse cached feeds before fetching again.")
			.addSlider((slider) =>
				slider
					.setLimits(1, 24, 1)
					.setValue(this.plugin.settings.feedCache.ttlHours)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.feedCache.ttlHours = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(container)
			.setName("Clear cached feeds")
			.setDesc("Remove stored feed data. PodNotes will refetch feeds as needed.")
			.addButton((button) =>
				button
					.setButtonText("Clear cache")
					.onClick(() => {
						clearFeedCache();
						episodeCache.set({});
						new Notice("Cleared cached podcast feeds.");
					}),
			);
	}

	private addImportExportSettings(containerEl: HTMLElement): void {
		containerEl.createEl("h3", { text: "Import/Export" });

		new Setting(containerEl)
			.setName("Import OPML")
			.setDesc("Import podcasts from an OPML file.")
			.addButton((button) =>
				button.setButtonText("Import").onClick(() => {
					const fileInput = document.createElement("input");
					fileInput.type = "file";
					fileInput.accept = ".opml";
					fileInput.style.display = "none";
					document.body.appendChild(fileInput);
					fileInput.click();

					fileInput.onchange = async (e: Event) => {
						const target = e.target as HTMLInputElement;
						const file = target.files?.[0];

						if (file) {
							const reader = new FileReader();
							reader.onload = async (event) => {
								const contents = event.target?.result as string;
								if (contents) {
									try {
										await importOPML(contents);
									} catch (e) {
										console.error("Error importing OPML:", e);
										new Notice(
											`Error importing OPML: ${e instanceof Error ? e.message : "Unknown error"}`,
											10000,
										);
									}
								}
							};
							reader.readAsText(file);
						} else {
							new Notice("No file selected");
						}
					};
				}),
			);

		let exportFilePath = "PodNotes_Export.opml";

		new Setting(containerEl)
			.setName("Export OPML")
			.setDesc("Export saved podcast feeds to an OPML file.")
			.addText((text) =>
				text
					.setPlaceholder("Export file name")
					.setValue(exportFilePath)
					.onChange((value) => {
						exportFilePath = value;
					}),
			)
			.addButton((button) =>
				button.setButtonText("Export").onClick(() => {
					const feeds = Object.values(get(savedFeeds));
					if (feeds.length === 0) {
						new Notice("No podcasts to export.");
						return;
					}
					exportOPML(
						this.app,
						feeds,
						exportFilePath.endsWith(".opml")
							? exportFilePath
							: `${exportFilePath}.opml`,
					);
				}),
			);
	}

	private addTranscriptSettings(container: HTMLDivElement) {
		container.createEl("h4", { text: "Transcript settings" });

		const randomEpisode = getRandomEpisode();

		new Setting(container)
			.setName("OpenAI API Key")
			.setDesc("Enter your OpenAI API key for transcription functionality.")
			.addText((text) => {
				text
					.setPlaceholder("Enter your OpenAI API key")
					.setValue(this.plugin.settings.openAIApiKey)
					.onChange(async (value) => {
						this.plugin.settings.openAIApiKey = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
			});

		new Setting(container)
			.setName("Transcript file path")
			.setDesc(
				"The path where transcripts will be saved. Use {{}} for dynamic values.",
			)
			.addText((text) => {
				text
					.setPlaceholder("transcripts/{{podcast}}/{{title}}.md")
					.setValue(this.plugin.settings.transcript.path)
					.onChange(async (value) => {
						this.plugin.settings.transcript.path = value;
						await this.plugin.saveSettings();
						updateTranscriptPathDemo(value);
					});
			});

		const transcriptPathDemoEl = container.createDiv();

		const updateTranscriptPathDemo = (value: string) => {
			const demoVal = FilePathTemplateEngine(value, randomEpisode);
			transcriptPathDemoEl.empty();
			transcriptPathDemoEl.createEl("p", { text: `Example: ${demoVal}` });
		};

		updateTranscriptPathDemo(this.plugin.settings.transcript.path);

		const transcriptTemplateSetting = new Setting(container)
			.setName("Transcript template")
			.setDesc("The template for the transcript file content.")
			.setHeading()
			.addTextArea((text) => {
				text
					.setPlaceholder(
						"# {{title}}\n\nPodcast: {{podcast}}\nDate: {{date}}\nURL: {{url}}\n\n## Description\n\n{{description}}\n\n## Transcript\n\n{{transcript}}",
					)
					.setValue(this.plugin.settings.transcript.template)
					.onChange(async (value) => {
						this.plugin.settings.transcript.template = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.style.width = "100%";
				text.inputEl.style.height = "25vh";
			});

		transcriptTemplateSetting.settingEl.style.flexDirection = "column";
		transcriptTemplateSetting.settingEl.style.alignItems = "unset";
		transcriptTemplateSetting.settingEl.style.gap = "10px";
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
