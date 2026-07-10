import {
	type App,
	Component,
	MarkdownRenderer,
	Modal,
	Notice,
	PluginSettingTab,
	SecretComponent,
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
import type { CredentialKind, CredentialValues } from "src/types/Credentials";
import { observePersistedStoreChanges } from "src/store/persistence";

type SecretReferenceKey = "openAISecretId" | "deepgramSecretId";
type SettingsControl =
	| HTMLButtonElement
	| HTMLInputElement
	| HTMLSelectElement
	| HTMLTextAreaElement;

interface SecretReferenceSaveResult {
	persistedId: string;
	saved: boolean;
	isLatest: boolean;
}

type ImportMutationResult = "failed" | "applied" | "complete";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function settingsValuesEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (left instanceof Date || right instanceof Date) {
		return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
	}
	if (Array.isArray(left) || Array.isArray(right)) {
		return (
			Array.isArray(left) &&
			Array.isArray(right) &&
			left.length === right.length &&
			left.every((value, index) => settingsValuesEqual(value, right[index]))
		);
	}
	if (!isPlainRecord(left) || !isPlainRecord(right)) return false;

	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	return (
		leftKeys.length === rightKeys.length &&
		leftKeys.every(
			(key) =>
				Object.prototype.hasOwnProperty.call(right, key) &&
				settingsValuesEqual(left[key], right[key]),
		)
	);
}

/**
 * Three-way rollback for a failed import. Only values changed by the import and
 * still equal to its failed candidate are restored. Store subscriptions and
 * other runtime writers that changed a value while the write was pending win.
 */
function restoreFailedImport(
	previous: IPodNotesSettings,
	candidate: IPodNotesSettings,
	current: IPodNotesSettings,
): IPodNotesSettings {
	const restored = structuredClone(current);
	restoreFailedImportChanges(
		previous as unknown as Record<string, unknown>,
		candidate as unknown as Record<string, unknown>,
		current as unknown as Record<string, unknown>,
		restored as unknown as Record<string, unknown>,
	);
	return restored;
}

function restoreFailedImportChanges(
	previous: Record<string, unknown>,
	candidate: Record<string, unknown>,
	current: Record<string, unknown>,
	restored: Record<string, unknown>,
): void {
	for (const key of new Set([...Object.keys(previous), ...Object.keys(candidate)])) {
		const previousHasKey = Object.prototype.hasOwnProperty.call(previous, key);
		const candidateHasKey = Object.prototype.hasOwnProperty.call(candidate, key);
		const currentHasKey = Object.prototype.hasOwnProperty.call(current, key);

		if (
			previousHasKey === candidateHasKey &&
			(!previousHasKey || settingsValuesEqual(previous[key], candidate[key]))
		) {
			continue;
		}

		if (
			currentHasKey === candidateHasKey &&
			(!currentHasKey || settingsValuesEqual(current[key], candidate[key]))
		) {
			if (previousHasKey) restored[key] = structuredClone(previous[key]);
			else delete restored[key];
			continue;
		}

		if (
			previousHasKey &&
			candidateHasKey &&
			currentHasKey &&
			isPlainRecord(previous[key]) &&
			isPlainRecord(candidate[key]) &&
			isPlainRecord(current[key]) &&
			isPlainRecord(restored[key])
		) {
			restoreFailedImportChanges(previous[key], candidate[key], current[key], restored[key]);
		}
	}
}

const CREDENTIAL_KIND_BY_REFERENCE: Record<SecretReferenceKey, CredentialKind> = {
	openAISecretId: "openai",
	deepgramSecretId: "deepgram",
};

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
	private settingsMutationTail: Promise<void> = Promise.resolve();
	private credentialSaveGenerations: Record<SecretReferenceKey, number> = {
		openAISecretId: 0,
		deepgramSecretId: 0,
	};
	private settingsInteractionLockCount = 0;
	private settingsControlDisabledStates = new Map<SettingsControl, boolean>();

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
				"When enabled, a separate plaintext secrets payload is added for the OpenAI and Deepgram keys available on this device. The file is stored in your vault, so it may sync to other devices and be read by other plugins.",
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
			const secrets = includeSecret
				? this.plugin.credentials.exportValues(this.plugin.settings, {
						requireConfigured: true,
					})
				: {};
			const envelope = serializeSettings(
				this.plugin.settings,
				{ secrets: includeSecret ? secrets : undefined },
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

			const exportedSecrets = describeSecrets(secrets);
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
		sections.push(...describeSecrets(result.secrets));
		const detail = sections.length ? ` This also replaces your ${sections.join(", ")}.` : "";
		const secretDetail =
			Object.keys(result.secrets).length > 0
				? " Existing Obsidian secrets are never overwritten; conflicts are saved under a new PodNotes name."
				: "";

		new ConfirmModal(
			this.app,
			"Import PodNotes settings?",
			`This overwrites your current PodNotes preferences and templates with the imported values.${detail}${secretDetail} Your playback progress and downloads are kept.`,
			"Import",
			() => {
				void this.applyImportedSettings(result.settings, result.secrets);
			},
		).open();
	}

	private async applyImportedSettings(
		imported: Partial<IPodNotesSettings>,
		secrets: CredentialValues = {},
	): Promise<void> {
		const unlockSettingsInteractions = this.lockSettingsInteractions();
		try {
			const result = await this.enqueueSettingsMutation(() =>
				this.persistImportedSettings(imported, secrets),
			);
			if (result === "failed") return;

			await this.waitForSettingsMutationLaneToDrain();
			this.display();
			if (result === "complete") new Notice("Imported PodNotes settings.");
		} finally {
			await this.waitForSettingsMutationLaneToDrain();
			unlockSettingsInteractions();
		}
	}

	private async persistImportedSettings(
		imported: Partial<IPodNotesSettings>,
		secrets: CredentialValues,
	): Promise<ImportMutationResult> {
		const previousSettings = this.plugin.settings;
		const previous = structuredClone(previousSettings);
		let secretReferences: Partial<IPodNotesSettings> = {};
		try {
			secretReferences = this.plugin.credentials.storeValues(secrets);
		} catch (error) {
			new Notice(
				"Could not finish importing API keys into Obsidian SecretStorage. Existing settings were kept, and retrying will safely reuse any PodNotes secrets already created.",
				10000,
			);
			console.error("PodNotes: failed to import credentials into SecretStorage", error);
			return "failed";
		}

		const merged = mergeImportedSettings(previous, { ...imported, ...secretReferences });
		const failedCandidate = structuredClone(merged);
		const openAIReferenceChanged = merged.openAISecretId !== previous.openAISecretId;
		if (openAIReferenceChanged) this.plugin.invalidateTranscriptionCredentialCache();
		const concurrentStoreChanges = observePersistedStoreChanges();
		this.plugin.settings = merged;
		try {
			// Persist before mutating live stores so a disk failure can restore the
			// previous in-memory settings without leaving the UI half-imported.
			await this.plugin.saveSettingsStrict();
		} catch (error) {
			let restored: IPodNotesSettings;
			try {
				restored = restoreFailedImport(previous, failedCandidate, this.plugin.settings);
				concurrentStoreChanges.replayInto(restored);
			} finally {
				concurrentStoreChanges.dispose();
			}
			this.plugin.settings =
				settingsValuesEqual(restored, previous) &&
				settingsValuesEqual(previousSettings, previous)
					? previousSettings
					: restored;
			if (openAIReferenceChanged) this.plugin.invalidateTranscriptionCredentialCache();
			try {
				// A store event may have queued a newer merged snapshot while the first
				// write was pending. Queue the rollback after it and wait for durability
				// before claiming that the previous settings were kept.
				await this.plugin.saveSettingsStrict();
				new Notice(
					"Could not import PodNotes settings. The failed import was rolled back without overwriting newer changes.",
					10000,
				);
			} catch (rollbackError) {
				new Notice(
					"Could not import PodNotes settings or persist its rollback. The safest recovered settings remain active for this session.",
					10000,
				);
				console.error(
					"PodNotes: failed to persist settings-import rollback",
					rollbackError,
				);
			}
			console.error("PodNotes: failed to persist imported settings", error);
			return "failed";
		}
		concurrentStoreChanges.dispose();

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

		try {
			// Store setters can canonicalize or deduplicate their slices. Await one
			// final strict snapshot so the success notice means that live state is
			// durable too.
			await this.plugin.saveSettingsStrict();
		} catch (error) {
			new Notice(
				"Imported PodNotes settings, but could not finish saving normalized live state. Change any setting to retry.",
				10000,
			);
			console.error("PodNotes: failed to persist normalized imported settings", error);
			return "applied";
		}
		// Re-emit the plugin store so an open player/grid recomputes Queue tile/list
		// visibility (and any other $plugin-derived UI) after an import, mirroring the
		// autoQueue toggle. Today the queue.set above already triggers that recompute;
		// this keeps the import path correct independent of that incidental emission
		// (issue #108).
		plugin.set(this.plugin);
		return "complete";
	}

	private enqueueSettingsMutation<T>(mutation: () => Promise<T>): Promise<T> {
		const operation = this.settingsMutationTail.then(mutation);
		this.settingsMutationTail = operation.then(
			() => undefined,
			() => undefined,
		);
		return operation;
	}

	private lockSettingsInteractions(): () => void {
		this.settingsInteractionLockCount++;
		if (this.settingsInteractionLockCount === 1) {
			for (const control of this.containerEl.querySelectorAll<SettingsControl>(
				"button, input, select, textarea",
			)) {
				this.settingsControlDisabledStates.set(control, control.disabled);
				control.disabled = true;
			}
		}

		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.settingsInteractionLockCount--;
			if (this.settingsInteractionLockCount > 0) return;

			for (const [control, wasDisabled] of this.settingsControlDisabledStates) {
				control.disabled = wasDisabled;
			}
			this.settingsControlDisabledStates.clear();
		};
	}

	private async waitForSettingsMutationLaneToDrain(): Promise<void> {
		while (true) {
			const tail = this.settingsMutationTail;
			await tail;
			if (tail === this.settingsMutationTail) return;
		}
	}

	private async saveSecretReference(
		key: SecretReferenceKey,
		selectedId: string,
	): Promise<SecretReferenceSaveResult> {
		const generation = ++this.credentialSaveGenerations[key];
		const operation = this.enqueueSettingsMutation(() =>
			this.persistSecretReference(key, selectedId),
		);
		const result = await operation;
		return {
			...result,
			isLatest: generation === this.credentialSaveGenerations[key],
		};
	}

	private async persistSecretReference(
		key: SecretReferenceKey,
		selectedId: string,
	): Promise<Omit<SecretReferenceSaveResult, "isLatest">> {
		const previous = this.plugin.settings[key];
		let persistedId: string;
		try {
			persistedId = selectedId
				? this.plugin.credentials.adoptReference(
						CREDENTIAL_KIND_BY_REFERENCE[key],
						selectedId,
					)
				: "";
		} catch (error) {
			new Notice(
				"Could not use the selected API key. It may no longer be available in Obsidian SecretStorage.",
				0,
			);
			console.error("PodNotes: failed to adopt credential reference", error);
			return { persistedId: previous, saved: false };
		}

		if (persistedId === previous) return { persistedId, saved: true };
		if (key === "openAISecretId") this.plugin.invalidateTranscriptionCredentialCache();
		this.plugin.settings[key] = persistedId;

		try {
			await this.plugin.saveSettingsStrict();
			return { persistedId, saved: true };
		} catch (error) {
			this.plugin.settings[key] = previous;
			if (key === "openAISecretId") this.plugin.invalidateTranscriptionCredentialCache();
			try {
				await this.plugin.saveSettingsStrict();
				new Notice(
					"Could not save the API key selection. The previous selection was kept.",
					0,
				);
			} catch (rollbackError) {
				new Notice(
					"Could not save the API key selection or its rollback. The previous selection remains active for this session.",
					0,
				);
				console.error(
					"PodNotes: failed to persist credential-reference rollback",
					rollbackError,
				);
			}
			console.error("PodNotes: failed to persist credential reference", error);
			return { persistedId: previous, saved: false };
		}
	}

	private async handleSecretSelection(
		key: SecretReferenceKey,
		selectedId: string,
		secret: Pick<SecretComponent, "setValue">,
		onLatestSettled: () => void,
	): Promise<void> {
		const result = await this.saveSecretReference(key, selectedId);
		if (!result.isLatest) return;

		// Always show the canonical persisted ID. Foreign/shared selections are
		// copied into provider-scoped PodNotes IDs before they reach data.json.
		secret.setValue(result.persistedId);
		onLatestSettled();
	}

	private addTranscriptSettings(container: HTMLDivElement) {
		new Setting(container).setName("Transcript settings").setHeading();

		const randomEpisode = getRandomEpisode();

		const openAISetting = new Setting(container).setName("OpenAI API key");
		const updateOpenAIDescription = () => {
			openAISetting.setDesc(
				this.plugin.credentials.status(this.plugin.settings, "openai") === "missing"
					? "The selected secret is not available on this device. Select an existing secret or create one."
					: "Select an existing Obsidian secret or create one for transcription.",
			);
		};
		updateOpenAIDescription();
		openAISetting.addComponent((element) => {
			const secret = new SecretComponent(this.app, element).setValue(
				this.plugin.settings.openAISecretId,
			);
			secret.onChange(async (value) => {
				await this.handleSecretSelection(
					"openAISecretId",
					value,
					secret,
					updateOpenAIDescription,
				);
			});
			return secret;
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

	/** Opt-in speaker diarization controls (issue #168). */
	private addDiarizationSettings(container: HTMLElement): void {
		const diarizationContainer = container.createDiv();
		const diarization = this.plugin.settings.transcript.diarization;
		let updateVisibility = () => {};

		new Setting(diarizationContainer)
			.setName("Speaker diarization")
			.setDesc(
				"Label transcript segments by speaker. Routes the episode audio to a diarization-capable provider instead of plain Whisper.",
			)
			.addToggle((toggle) =>
				toggle.setValue(diarization.enabled).onChange(async (value) => {
					this.plugin.settings.transcript.diarization.enabled = value;
					await this.plugin.saveSettings();
					updateVisibility();
				}),
			);

		const providerSetting = new Setting(diarizationContainer)
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
						updateVisibility();
					}),
			);

		const deepgramSetting = new Setting(diarizationContainer).setName("Deepgram API key");
		const updateDeepgramDescription = () => {
			deepgramSetting.setDesc(
				this.plugin.credentials.status(this.plugin.settings, "deepgram") === "missing"
					? "The selected secret is not available on this device. Select an existing secret or create one."
					: "Select an Obsidian secret for Deepgram diarization, or create one at deepgram.com.",
			);
		};
		updateDeepgramDescription();
		deepgramSetting.addComponent((element) => {
			const secret = new SecretComponent(this.app, element).setValue(
				this.plugin.settings.deepgramSecretId,
			);
			secret.onChange(async (value) => {
				await this.handleSecretSelection(
					"deepgramSecretId",
					value,
					secret,
					updateDeepgramDescription,
				);
			});
			return secret;
		});

		const speakerSetting = new Setting(diarizationContainer)
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

		updateVisibility = () => {
			providerSetting.settingEl.toggle(diarization.enabled);
			deepgramSetting.settingEl.toggle(
				diarization.enabled && diarization.provider === "deepgram",
			);
			speakerSetting.settingEl.toggle(diarization.enabled);
		};
		updateVisibility();
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
