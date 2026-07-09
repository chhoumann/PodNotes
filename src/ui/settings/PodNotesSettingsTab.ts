import {
	type App,
	Component,
	MarkdownRenderer,
	Modal,
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
	FeedFilePathTemplateEngine,
	FilePathTemplateEngine,
	TimestampTemplateEngine,
} from "../../TemplateEngine";
import {
	episodeCache,
	episodeListLimit,
	favorites,
	hidePlayedEpisodes,
	localFiles,
	playbackRate,
	playlists,
	plugin,
	queue,
	sanitizeEpisodeListLimit,
	savedFeeds,
	volume,
} from "src/store/index";
import { DEFAULT_EPISODE_LIST_LIMIT, MAX_EPISODE_LIST_LIMIT } from "src/constants";
import type { Episode } from "src/types/Episode";
import type { PodcastFeed } from "src/types/PodcastFeed";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import { get } from "svelte/store";
import { exportOPML, importOPML } from "src/opml";
import { clearFeedCache } from "src/services/FeedCacheService";
import {
	describeSecrets,
	mergeImportedSettings,
	parseImport,
	serializeSettings,
} from "src/settingsTransfer";
import { normalizePlaybackRate } from "src/utility/playbackRate";
import { DEFAULT_SPEAKER_TEMPLATE, type DiarizationProviderId } from "src/services/diarization";

/**
 * Stack a Setting's control beneath its name, full width — the layout the
 * template/path text areas need. Obsidian's Setting has no built-in vertical
 * variant and the plugin ships no stylesheet (styles are injected per Svelte
 * component), so this sets the few inline styles in one place instead of the
 * seven hand-rolled copies this replaced.
 */
function stackSettingVertically(setting: Setting): void {
	setting.settingEl.setCssStyles({
		flexDirection: "column",
		alignItems: "unset",
		gap: "10px",
	});
}

/**
 * Render `markdown` into `el` as a small live preview, replacing any prior
 * content. Shared by the path/template demo fields that echo what the configured
 * template resolves to.
 */
function renderMarkdownPreview(markdown: string, el: HTMLElement): void {
	el.empty();
	void MarkdownRenderer.renderMarkdown(markdown, el, "", new Component());
}

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

		new Setting(containerEl).setName("PodNotes").setHeading();

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

		this.addQueueSettings(settingsContainer);
		this.addEpisodeListSettings(settingsContainer);
		this.addDefaultPlaybackRateSetting(settingsContainer);
		this.addDefaultVolumeSetting(settingsContainer);
		this.addSkipLengthSettings(settingsContainer);
		this.addNoteSettings(settingsContainer);
		this.addFeedNoteSettings(settingsContainer);
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

	private addQueueSettings(container: HTMLElement): void {
		new Setting(container)
			.setName("Keep a queue of episodes you switch away from")
			.setDesc(
				"When on, the episode you switch away from is kept at the top of the queue and playback automatically continues with the next queued episode when one ends. Turn this off to stop the queue from filling and advancing on its own — you can still add episodes to the queue manually.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoQueue).onChange(async (value) => {
					this.plugin.settings.autoQueue = value;
					await this.plugin.saveSettings();
					// Re-emit the plugin store so an open player/grid recomputes
					// the Queue tile/list visibility immediately (issue #108).
					plugin.set(this.plugin);
				}),
			);
	}

	private addEpisodeListSettings(container: HTMLElement): void {
		new Setting(container)
			.setName("Latest episodes per podcast")
			.setDesc(
				`How many of each podcast's most recent episodes appear in the Latest Episodes list, and how far back its search reaches. Raise this to find older episodes (1-${MAX_EPISODE_LIST_LIMIT}; default ${DEFAULT_EPISODE_LIST_LIMIT}).`,
			)
			.addText((textComponent) => {
				textComponent.inputEl.type = "number";
				textComponent.inputEl.min = "1";
				textComponent.inputEl.max = `${MAX_EPISODE_LIST_LIMIT}`;
				textComponent
					.setValue(`${sanitizeEpisodeListLimit(this.plugin.settings.episodeListLimit)}`)
					.setPlaceholder(`${DEFAULT_EPISODE_LIST_LIMIT}`)
					.onChange(async (value) => {
						// Don't commit while the field is empty or mid-edit (e.g. cleared,
						// or a lone "-"): sanitizing "" would silently overwrite the saved
						// limit with the default. Wait for a parseable number, and skip
						// redundant saves so typing doesn't churn data.json each keystroke.
						const trimmed = value.trim();
						if (trimmed === "" || !Number.isFinite(Number(trimmed))) return;
						const sanitized = sanitizeEpisodeListLimit(trimmed);
						if (sanitized === this.plugin.settings.episodeListLimit) return;
						this.plugin.settings.episodeListLimit = sanitized;
						episodeListLimit.set(sanitized);
						await this.plugin.saveSettings();
					});
				// Reflect the clamped/sanitized value back once the user finishes
				// editing, so an out-of-range or empty entry doesn't linger in the box.
				textComponent.inputEl.addEventListener("blur", () => {
					textComponent.setValue(
						`${sanitizeEpisodeListLimit(this.plugin.settings.episodeListLimit)}`,
					);
				});
			});
	}

	private addDefaultPlaybackRateSetting(container: HTMLElement): void {
		new Setting(container).setName("Default Playback Rate").addSlider((slider) =>
			slider
				.setLimits(0.5, 4, 0.1)
				.setValue(this.plugin.settings.defaultPlaybackRate)
				.onChange((value) => {
					this.plugin.settings.defaultPlaybackRate = value;
					void this.plugin.saveSettings();
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
						void this.plugin.saveSettings();
					})
					.setDynamicTooltip(),
			);
	}

	private addSkipLengthSettings(container: HTMLElement): void {
		new Setting(container).setName("Skip backward length (s)").addText((textComponent) => {
			textComponent.inputEl.type = "number";
			textComponent
				.setValue(`${this.plugin.settings.skipBackwardLength}`)
				.onChange((value) => {
					// Ignore empty/invalid input instead of persisting NaN, which
					// would corrupt the playback position when skipping (PB-02/ST-01).
					const parsed = Number.parseInt(value, 10);
					if (!Number.isFinite(parsed) || parsed <= 0) return;
					this.plugin.settings.skipBackwardLength = parsed;
					void this.plugin.saveSettings();
				})
				.setPlaceholder("seconds");
		});

		new Setting(container).setName("Skip forward length (s)").addText((textComponent) => {
			textComponent.inputEl.type = "number";
			textComponent
				.setValue(`${this.plugin.settings.skipForwardLength}`)
				.onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					if (!Number.isFinite(parsed) || parsed <= 0) return;
					this.plugin.settings.skipForwardLength = parsed;
					void this.plugin.saveSettings();
				})
				.setPlaceholder("seconds");
		});
	}

	private addNoteSettings(settingsContainer: HTMLDivElement) {
		const container = settingsContainer.createDiv();

		new Setting(container).setName("Note settings").setHeading();

		const timestampSetting = new Setting(container)
			.setName("Capture timestamp format")
			.setHeading()
			.addTextArea((textArea) => {
				textArea.setValue(this.plugin.settings.timestamp.template);
				textArea.setPlaceholder("- {{linktime}} ");
				textArea.onChange((value) => {
					this.plugin.settings.timestamp.template = value;
					void this.plugin.saveSettings();
					updateTimestampDemo(value);
				});
				textArea.inputEl.setCssStyles({ width: "100%" });
			});

		stackSettingVertically(timestampSetting);

		const timestampFormatDemoEl = container.createDiv();

		const updateTimestampDemo = (value: string) => {
			// Without a loaded episode there is no time to render; show a hint
			// instead of leaving the preview blank so the control isn't mistaken
			// for broken (TS-04).
			if (!this.plugin.api.podcast) {
				timestampFormatDemoEl.setText("Play an episode to preview the timestamp format.");
				return;
			}

			const demoVal = TimestampTemplateEngine(value);
			renderMarkdownPreview(demoVal, timestampFormatDemoEl);
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
						void this.plugin.saveSettings();
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
				textComponent.setPlaceholder("inputs/podcasts/{{podcast}} - {{title}}.md");
				textComponent.onChange((value) => {
					this.plugin.settings.note.path = value;
					void this.plugin.saveSettings();

					const demoVal = FilePathTemplateEngine(value, randomEpisode);
					renderMarkdownPreview(demoVal, noteCreationFilePathDemoEl);
				});
				textComponent.inputEl.setCssStyles({ width: "100%" });
			});

		stackSettingVertically(noteCreationFilePathSetting);

		const noteCreationFilePathDemoEl = container.createDiv();

		const noteCreationSetting = new Setting(container)
			.setName("Note creation template")
			.setHeading()
			.addTextArea((textArea) => {
				textArea.setValue(this.plugin.settings.note.template);
				textArea.onChange((value) => {
					this.plugin.settings.note.template = value;
					void this.plugin.saveSettings();
				});

				textArea.inputEl.setCssStyles({ width: "100%", height: "25vh" });
				// A Bases-friendly hint mirroring the shipped default: structured
				// frontmatter properties Bases can query, with the raw title in the
				// body where YAML rules don't apply.
				textArea.setPlaceholder(
					"---" +
						"\ntype: podcastEpisode" +
						'\npodcast: "{{podcastlink}}"' +
						'\nurl: "{{url}}"' +
						"\ndate: {{date:YYYY-MM-DD}}" +
						"\ntags:" +
						"\n  - podcastEpisode" +
						"\n---" +
						"\n# {{title}}" +
						"\n\n![]({{artwork}})" +
						"\n\n{{description}}",
				);
			});

		stackSettingVertically(noteCreationSetting);
	}

	private addFeedNoteSettings(settingsContainer: HTMLDivElement) {
		const container = settingsContainer.createDiv();

		new Setting(container).setName("Podcast feed note settings").setHeading();

		const desc = container.createEl("p", {
			text:
				"Create a note for a whole podcast (the feed), not a single episode. " +
				'Run the "Create podcast feed note" command to pick a saved podcast. ' +
				"Available tags: {{title}}, {{podcast}}, {{url}} (website), " +
				"{{feedurl}} (RSS), {{artwork}}, {{author}}, {{description}}, {{date}}.",
		});
		desc.setCssStyles({
			fontSize: "var(--font-ui-smaller)",
			color: "var(--text-muted)",
		});

		const randomFeed = getRandomFeed();

		const feedNotePathSetting = new Setting(container)
			.setName("Feed note file path")
			.setHeading()
			.addText((textComponent) => {
				textComponent.setValue(this.plugin.settings.feedNote.path);
				textComponent.setPlaceholder("PodNotes/Podcasts/{{podcast}}.md");
				textComponent.onChange((value) => {
					this.plugin.settings.feedNote.path = value;
					void this.plugin.saveSettings();
					renderFeedPathDemo(value);
				});
				textComponent.inputEl.setCssStyles({ width: "100%" });
			});

		stackSettingVertically(feedNotePathSetting);

		const feedNotePathDemoEl = container.createDiv();

		const renderFeedPathDemo = (value: string) => {
			const demoVal = FeedFilePathTemplateEngine(value, randomFeed);
			renderMarkdownPreview(demoVal, feedNotePathDemoEl);
		};

		renderFeedPathDemo(this.plugin.settings.feedNote.path);

		const feedNoteTemplateSetting = new Setting(container)
			.setName("Feed note template")
			.setHeading()
			.addTextArea((textArea) => {
				textArea.setValue(this.plugin.settings.feedNote.template);
				textArea.onChange((value) => {
					this.plugin.settings.feedNote.template = value;
					void this.plugin.saveSettings();
				});
				textArea.inputEl.setCssStyles({ width: "100%", height: "25vh" });
			});

		stackSettingVertically(feedNoteTemplateSetting);
	}

	private addDownloadSettings(container: HTMLDivElement) {
		new Setting(container).setName("Download settings").setHeading();

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
					void this.plugin.saveSettings();
					refreshDownloadPathHints(value);
				});
				textComponent.inputEl.setCssStyles({ width: "100%" });
			});

		stackSettingVertically(downloadPathSetting);

		const downloadFilePathDemoEl = container.createDiv();
		const downloadFilePathWarningEl = container.createDiv();
		downloadFilePathWarningEl.setCssStyles({ color: "var(--text-error)" });

		// A download path without a per-episode token ({{title}}) resolves every
		// episode to the same file, so downloads overwrite each other or fail; an
		// empty path resolves to ".mp3" at the vault root (#183). Warn inline.
		const refreshDownloadPathHints = (value: string) => {
			const demoVal = DownloadPathTemplateEngine(value, randomEpisode);
			renderMarkdownPreview(`${demoVal}.mp3`, downloadFilePathDemoEl);

			// Match only the forms DownloadPathTemplateEngine actually resolves —
			// {{title}} or {{title:...}}. A looser test (e.g. \s* after {{, or \b)
			// would wrongly stay silent for "{{ title }}" / "{{title-ish}}", which the
			// engine leaves literal so every episode still collides.
			downloadFilePathWarningEl.toggle(!/\{\{title(:[^}]*)?\}\}/i.test(value));
			downloadFilePathWarningEl.setText(
				"⚠ This path has no {{title}}, so multiple episodes can resolve to the same file — downloads will overwrite each other or fail. Add {{title}}, e.g. PodNotes/{{podcast}}/{{title}}.",
			);
		};

		refreshDownloadPathHints(this.plugin.settings.download.path);
	}

	private addPerformanceSettings(container: HTMLDivElement) {
		new Setting(container).setName("Performance").setHeading();

		new Setting(container)
			.setName("Cache podcast feeds")
			.setDesc("Store recently downloaded feeds locally for faster startup.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.feedCache.enabled).onChange(async (value) => {
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
				button.setButtonText("Clear cache").onClick(() => {
					clearFeedCache();
					episodeCache.set({});
					new Notice("Cleared cached podcast feeds.");
				}),
			);
	}

	private addImportExportSettings(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Import/Export").setHeading();

		new Setting(containerEl)
			.setName("Import OPML")
			.setDesc("Import podcasts from an OPML file.")
			.addButton((button) =>
				button.setButtonText("Import").onClick(() => {
					this.pickFile(
						".opml",
						async (contents) => {
							try {
								await importOPML(contents);
							} catch (e) {
								console.error("Error importing OPML:", e);
								new Notice(
									`Error importing OPML: ${e instanceof Error ? e.message : "Unknown error"}`,
									10000,
								);
							}
						},
						{ tooLargeMessage: "That file is too large to be an OPML file." },
					);
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
					void exportOPML(
						this.app,
						feeds,
						exportFilePath.endsWith(".opml")
							? exportFilePath
							: `${exportFilePath}.opml`,
					);
				}),
			);

		this.addSettingsTransferControls(containerEl);
	}

	private addSettingsTransferControls(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Settings & templates").setHeading();

		new Setting(containerEl)
			.setName("Import settings")
			.setDesc(
				"Import PodNotes preferences, templates, feeds, and playlists from a settings file. Playback progress and downloads are not affected.",
			)
			.addButton((button) =>
				button.setButtonText("Import").onClick(() => {
					this.pickFile(".json", (contents) => this.handleSettingsImport(contents));
				}),
			);

		let exportFileName = "PodNotes_Settings.json";
		let includeSecret = false;

		new Setting(containerEl)
			.setName("Include API keys")
			.setDesc(
				"When enabled, the export file contains your OpenAI and Deepgram API keys in plaintext (whichever you have set). The file is stored in your vault, so it may sync to other devices and be read by other plugins.",
			)
			.addToggle((toggle) =>
				toggle.setValue(includeSecret).onChange((value) => {
					includeSecret = value;
				}),
			);

		new Setting(containerEl)
			.setName("Export settings")
			.setDesc("Export PodNotes preferences, templates, feeds, and playlists.")
			.addText((text) =>
				text
					.setPlaceholder("Export file name")
					.setValue(exportFileName)
					.onChange((value) => {
						exportFileName = value;
					}),
			)
			.addButton((button) =>
				button.setButtonText("Export").onClick(() => {
					const name = exportFileName.trim() || "PodNotes_Settings.json";
					const fileName = name.endsWith(".json") ? name : `${name}.json`;
					void this.handleSettingsExport(fileName, includeSecret);
				}),
			);
	}

	private pickFile(
		accept: string,
		onContents: (contents: string) => void | Promise<void>,
		options: { maxBytes?: number; tooLargeMessage?: string } = {},
	): void {
		// Both pickers read small text files, so cap the size before reading the
		// whole thing into memory. The cap and its message are per-caller so OPML
		// import doesn't inherit the settings-file copy.
		const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
		const tooLargeMessage =
			options.tooLargeMessage ?? "That file is too large to be a PodNotes settings file.";

		const fileInput = activeDocument.createElement("input");
		fileInput.type = "file";
		fileInput.accept = accept;
		fileInput.setCssStyles({ display: "none" });
		activeDocument.body.appendChild(fileInput);

		// The native picker firing "cancel" (no selection) never triggers
		// "change", so clean up the orphaned input then too.
		fileInput.oncancel = () => fileInput.remove();

		fileInput.onchange = (e: Event) => {
			const target = e.target as HTMLInputElement;
			const file = target.files?.[0];
			fileInput.remove();

			if (!file) {
				new Notice("No file selected.");
				return;
			}

			if (file.size > maxBytes) {
				new Notice(tooLargeMessage);
				return;
			}

			const reader = new FileReader();
			reader.onload = (event) => {
				const contents = event.target?.result;
				if (typeof contents === "string") {
					void onContents(contents);
				} else {
					new Notice("Could not read the selected file.");
				}
			};
			reader.onerror = () => new Notice("Could not read the selected file.");
			reader.readAsText(file);
		};

		fileInput.click();
	}

	private async handleSettingsExport(fileName: string, includeSecret: boolean): Promise<void> {
		try {
			const envelope = serializeSettings(
				this.plugin.settings,
				{ includeSecret },
				this.plugin.manifest.version,
				new Date().toISOString(),
			);
			const contents = JSON.stringify(envelope, null, 2);

			// Create-only, mirroring the OPML export: never clobber an existing
			// vault file (which could be an unrelated note) without the user
			// choosing a fresh name.
			if (this.app.vault.getAbstractFileByPath(fileName)) {
				new Notice(`A file named "${fileName}" already exists. Choose a different name.`);
				return;
			}
			await this.app.vault.create(fileName, contents);

			const exportedSecrets = includeSecret ? describeSecrets(this.plugin.settings) : [];
			new Notice(
				exportedSecrets.length
					? `Exported PodNotes settings to "${fileName}" (includes your ${exportedSecrets.join(" and ")}).`
					: `Exported PodNotes settings to "${fileName}".`,
			);
		} catch (error) {
			if (error instanceof Error && error.message.includes("Folder does not exist")) {
				new Notice("Unable to create export file: folder does not exist.");
			} else {
				new Notice(
					`Unable to export settings:\n\n${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
			console.error("PodNotes: failed to export settings", error);
		}
	}

	private handleSettingsImport(contents: string): void {
		const result = parseImport(contents);
		if (!result.ok) {
			new Notice(`Could not import settings: ${result.error}`, 10000);
			return;
		}

		// Warn about a collection only when the user CURRENTLY has data there AND
		// the import carries that collection (so it will be replaced wholesale —
		// including by an explicitly empty collection, which silently wiped feeds
		// with no warning before). Keying off the imported data's contents alone
		// missed exactly that data-loss case (SA-09).
		const willReplace = (
			key: keyof IPodNotesSettings,
			current: Record<string, unknown> | undefined,
		): boolean =>
			Object.prototype.hasOwnProperty.call(result.settings, key) &&
			Object.keys(current ?? {}).length > 0;

		const sections: string[] = [];
		if (willReplace("savedFeeds", this.plugin.settings.savedFeeds)) {
			sections.push("podcast feeds");
		}
		if (willReplace("playlists", this.plugin.settings.playlists)) {
			sections.push("playlists");
		}
		sections.push(...describeSecrets(result.settings));
		const detail = sections.length ? ` This also replaces your ${sections.join(", ")}.` : "";

		new ConfirmModal(
			this.app,
			"Import PodNotes settings?",
			`This overwrites your current PodNotes preferences and templates with the imported values.${detail} Your playback progress and downloads are kept.`,
			"Import",
			() => {
				void this.applyImportedSettings(result.settings);
			},
		).open();
	}

	private async applyImportedSettings(imported: Partial<IPodNotesSettings>): Promise<void> {
		const merged = mergeImportedSettings(this.plugin.settings, imported);
		this.plugin.settings = merged;

		// Re-hydrate the live stores so the running UI and the persistence
		// bindings reflect the import. Keys without a store (templates, paths,
		// skip lengths, feed cache) are applied via `merged` above.
		savedFeeds.set(merged.savedFeeds);
		playlists.set(merged.playlists);
		favorites.set(merged.favorites);
		queue.set(merged.queue);
		localFiles.set(merged.localFiles);
		hidePlayedEpisodes.set(merged.hidePlayedEpisodes);
		const sanitizedLimit = sanitizeEpisodeListLimit(merged.episodeListLimit);
		merged.episodeListLimit = sanitizedLimit;
		episodeListLimit.set(sanitizedLimit);
		const importedVolume = Number.isFinite(merged.defaultVolume) ? merged.defaultVolume : 1;
		volume.set(Math.min(1, Math.max(0, importedVolume)));
		playbackRate.set(normalizePlaybackRate(merged.defaultPlaybackRate));

		await this.plugin.saveSettings();
		// Re-emit the plugin store so an open player/grid recomputes Queue tile/list
		// visibility (and any other $plugin-derived UI) after an import, mirroring the
		// autoQueue toggle. Today the queue.set above already triggers that recompute;
		// this keeps the import path correct independent of that incidental emission
		// (issue #108).
		plugin.set(this.plugin);
		this.display();
		new Notice("Imported PodNotes settings.");
	}

	private addTranscriptSettings(container: HTMLDivElement) {
		new Setting(container).setName("Transcript settings").setHeading();

		const randomEpisode = getRandomEpisode();

		new Setting(container)
			.setName("OpenAI API Key")
			.setDesc("Enter your OpenAI API key for transcription functionality.")
			.addText((text) => {
				text.setPlaceholder("Enter your OpenAI API key")
					.setValue(this.plugin.settings.openAIApiKey)
					.onChange(async (value) => {
						this.plugin.settings.openAIApiKey = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
			});

		new Setting(container)
			.setName("Transcript file path")
			.setDesc("The path where transcripts will be saved. Use {{}} for dynamic values.")
			.addText((text) => {
				text.setPlaceholder("transcripts/{{podcast}}/{{title}}.md")
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
				text.setPlaceholder(
					"# {{title}}\n\nPodcast: {{podcast}}\nDate: {{date}}\nURL: {{url}}\n\n## Description\n\n{{description}}\n\n## Transcript\n\n{{transcript}}",
				)
					.setValue(this.plugin.settings.transcript.template)
					.onChange(async (value) => {
						this.plugin.settings.transcript.template = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.setCssStyles({ width: "100%", height: "25vh" });
			});

		stackSettingVertically(transcriptTemplateSetting);

		this.addDiarizationSettings(container);
	}

	/**
	 * Opt-in speaker diarization controls (issue #168). Rendered into its own
	 * container so the provider-dependent fields (Deepgram key) can be shown or
	 * hidden in place when the toggle/provider changes, without re-rendering the
	 * whole settings tab.
	 */
	private addDiarizationSettings(container: HTMLElement): void {
		const diarizationContainer = container.createDiv();

		const renderDiarizationSettings = () => {
			diarizationContainer.empty();
			const diarization = this.plugin.settings.transcript.diarization;

			new Setting(diarizationContainer)
				.setName("Speaker diarization")
				.setDesc(
					"Label transcript segments by speaker. Routes the episode audio to a diarization-capable provider instead of plain Whisper.",
				)
				.addToggle((toggle) =>
					toggle.setValue(diarization.enabled).onChange(async (value) => {
						this.plugin.settings.transcript.diarization.enabled = value;
						await this.plugin.saveSettings();
						renderDiarizationSettings();
					}),
				);

			if (!diarization.enabled) return;

			new Setting(diarizationContainer)
				.setName("Diarization provider")
				.setDesc(
					"OpenAI reuses your OpenAI API key above (long episodes are chunked, so speaker labels can reset across chunks). Deepgram needs its own key and keeps speaker labels consistent across the whole episode.",
				)
				.addDropdown((dropdown) =>
					dropdown
						.addOption("openai", "OpenAI (gpt-4o-transcribe-diarize)")
						.addOption("deepgram", "Deepgram")
						.setValue(diarization.provider)
						.onChange(async (value) => {
							this.plugin.settings.transcript.diarization.provider =
								value as DiarizationProviderId;
							await this.plugin.saveSettings();
							renderDiarizationSettings();
						}),
				);

			if (diarization.provider === "deepgram") {
				new Setting(diarizationContainer)
					.setName("Deepgram API key")
					.setDesc("Used only for Deepgram diarization. Create one at deepgram.com.")
					.addText((text) => {
						text.setPlaceholder("Enter your Deepgram API key")
							.setValue(this.plugin.settings.diarizationApiKey)
							.onChange(async (value) => {
								this.plugin.settings.diarizationApiKey = value;
								await this.plugin.saveSettings();
							});
						text.inputEl.type = "password";
					});
			}

			new Setting(diarizationContainer)
				.setName("Speaker label format")
				.setDesc(
					"Prefix added before each speaker's turn. Use {{speaker}} for the speaker label (OpenAI labels speakers A, B, …; Deepgram labels them 1, 2, …).",
				)
				.addText((text) =>
					text
						.setPlaceholder(DEFAULT_SPEAKER_TEMPLATE)
						.setValue(diarization.speakerTemplate)
						.onChange(async (value) => {
							this.plugin.settings.transcript.diarization.speakerTemplate = value;
							await this.plugin.saveSettings();
						}),
				);
		};

		renderDiarizationSettings();
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

	const randomFeed = feedEpisodes[Math.floor(Math.random() * feedEpisodes.length)];
	if (!randomFeed.length) return fallbackDemoObj;

	const randomEpisode = randomFeed[Math.floor(Math.random() * randomFeed.length)];

	return randomEpisode;
}

function getRandomFeed(): PodcastFeed {
	const fallbackDemoFeed: PodcastFeed = {
		title: "Demo Podcast",
		url: "https://example.com/feed.xml",
		artworkUrl: "https://example.com/artwork.jpg",
		description: "A demo podcast feed.",
		link: "https://example.com",
		author: "Demo Author",
	};

	const feeds = Object.values(get(savedFeeds));
	if (!feeds.length) return fallbackDemoFeed;

	return feeds[Math.floor(Math.random() * feeds.length)];
}

class ConfirmModal extends Modal {
	private title: string;
	private body: string;
	private confirmText: string;
	private onConfirm: () => void;

	constructor(app: App, title: string, body: string, confirmText: string, onConfirm: () => void) {
		super(app);
		this.title = title;
		this.body = body;
		this.confirmText = confirmText;
		this.onConfirm = onConfirm;
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: this.title });
		contentEl.createEl("p", { text: this.body });

		new Setting(contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText(this.confirmText)
					.setWarning()
					.onClick(() => {
						this.close();
						this.onConfirm();
					}),
			);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
