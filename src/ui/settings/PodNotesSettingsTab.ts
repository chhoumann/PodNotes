import {
	type App,
	type ButtonComponent,
	Component,
	type ExtraButtonComponent,
	MarkdownRenderer,
	Modal,
	Notice,
	PluginSettingTab,
	SecretComponent,
	Setting,
	type SettingDefinitionGroup,
	type SettingDefinitionRender,
	type TextAreaComponent,
	type TextComponent,
} from "obsidian";
import type App2 from "src/global";
import type PodNotes from "../../main";
import { CAPTURE_CHOICE_ID, CAPTURE_PACKAGE, findQuickAdd } from "src/quickAdd";
import { pickFile } from "../pickFile";
import {
	DownloadPathTemplateEngine,
	FeedFilePathTemplateEngine,
	FilePathTemplateEngine,
	TimestampTemplateEngine,
} from "../../TemplateEngine";
import {
	episodeListLimit,
	favorites,
	hidePlayedEpisodes,
	playedEpisodes,
	playlists,
	plugin,
	queue,
	sanitizeEpisodeListLimit,
	savedFeeds,
} from "src/store/index";
import { DEFAULT_SETTINGS, MAX_EPISODE_LIST_LIMIT } from "src/constants";
import type { Episode } from "src/types/Episode";
import type { PodcastFeed } from "src/types/PodcastFeed";
import { NEXT_TRACK_ACTIONS, PREVIOUS_TRACK_ACTIONS } from "src/types/Headset";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import { get } from "svelte/store";
import { exportOPML, importOPML } from "src/opml";
import { isOption } from "src/persistence/codecUtils";
import { decodePodNotesData, PODNOTES_DATA_SCHEMA_VERSION } from "src/persistence/podNotesData";
import { privateFeedAddresses, protectPrivateFeeds } from "src/services/privateFeeds";
import {
	describeSecrets,
	mergeImportedSettings,
	parseImport,
	serializeSettings,
} from "src/settingsTransfer";
import type { CredentialKind, CredentialValues } from "src/types/Credentials";
import { observePersistedStoreChanges } from "src/store/persistence";
import { PLAYBACK_RATES } from "src/utility/playbackRate";

type SecretReferenceKey = "openAISecretId" | "deepgramSecretId";
type SettingsControl =
	| HTMLButtonElement
	| HTMLInputElement
	| HTMLSelectElement
	| HTMLTextAreaElement;
type Diarization = IPodNotesSettings["transcript"]["diarization"];

interface SecretReferenceSaveResult {
	persistedId: string;
	saved: boolean;
	isLatest: boolean;
}

type ImportMutationResult = "failed" | "applied" | "complete";

interface TextField {
	read(): string;
	write(value: string): void;
	placeholder?: string;
	kind?: "number" | "area" | "template";
	min?: number;
	max?: number;
	preview?(value: string, setting: Setting): void;
}

const DIARIZATION_PROVIDERS = {
	openai: "OpenAI (gpt-4o-transcribe-diarize)",
	deepgram: "Deepgram",
};

const TYPING_SAVE_DELAY_MS = 500;

/** Search finds rows, not section headings. */
const HEADSET_ALIASES = ["headset", "lock screen", "media keys"];

let settingNames = 0;

const NAMED_BY_ROW = "pn-named-by-row";

/**
 * Obsidian names no row's field after the row, and shows an aria-label as a tooltip, so
 * each field is labelled by the row's name. A toggle takes focus on its label, not its
 * checkbox. An API key's button reads Link... or Change, and a QuickAdd choice button
 * Choose... or the choice's name, so they keep those words before the row's name.
 */
const group = (heading: string, items: SettingDefinitionRender[]): SettingDefinitionGroup => ({
	type: "group",
	heading,
	items: items.map((item) => ({
		...item,
		render: (setting, settingGroup) => {
			const end = item.render(setting, settingGroup);
			const { nameEl, controlEl } = setting;
			nameEl.id = `podnotes-setting-${++settingNames}`;
			for (const field of controlEl.querySelectorAll(
				"input, select, textarea, .checkbox-container",
			))
				field.setAttribute("aria-labelledby", nameEl.id);
			for (const [index, button] of controlEl
				.querySelectorAll(`.setting-secret-value + button, .${NAMED_BY_ROW}`)
				.entries()) {
				button.id = `${nameEl.id}-${index}`;
				button.setAttribute("aria-labelledby", `${button.id} ${nameEl.id}`);
			}
			return end;
		},
	})),
});

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
			if (previousHasKey) {
				Object.defineProperty(restored, key, {
					value: structuredClone(previous[key]),
					enumerable: true,
					writable: true,
					configurable: true,
				});
			} else delete restored[key];
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

function stackSettingVertically(setting: Setting): void {
	setting.settingEl.setCssStyles({
		flexDirection: "column",
		alignItems: "unset",
		gap: "10px",
	});
}

export class PodNotesSettingsTab extends PluginSettingTab {
	plugin: PodNotes;

	private settingsMutationTail: Promise<void> = Promise.resolve();
	private credentialSaveGenerations: Record<SecretReferenceKey, number> = {
		openAISecretId: 0,
		deepgramSecretId: 0,
	};
	private settingsInteractionLockCount = 0;
	private settingsControlDisabledStates = new Map<SettingsControl, boolean>();
	private readonly drafts = new Set<() => void>();
	private readonly follows = new Set<() => void>();
	private includeApiKeys = false;

	constructor(app: App, plugin: PodNotes) {
		super(app, plugin);
		this.plugin = plugin;
	}

	override getSettingDefinitions(): SettingDefinitionGroup[] {
		const diarization = () => this.plugin.settings.transcript.diarization;
		const pathPreview =
			(engine: (template: string, episode: Episode) => string, suffix = "") =>
			(value: string, setting: Setting) =>
				setting.setDesc(engine(value, this.demoEpisode()) + suffix);

		return [
			group("Playback", [
				this.textRow("Skip back (s)", this.seconds("skipBackwardLength")),
				this.textRow("Skip forward (s)", this.seconds("skipForwardLength")),
				this.speedRow(),
				{
					name: "Queue episodes I switch away from",
					desc: "When an episode ends, the next queued one plays.",
					render: (setting) => {
						let stop = () => {};
						setting.addToggle((toggle) => {
							stop = this.follow(setting, ({ autoQueue }) =>
								toggle.setValue(autoQueue),
							);
							toggle.onChange((on) => this.plugin.setAutoQueue(on));
						});
						return stop;
					},
				},
			]),
			group("Headset and lock screen", [
				{
					...this.dropdownRow(
						"Previous track",
						PREVIOUS_TRACK_ACTIONS,
						() => this.plugin.settings.headsetPreviousTrack,
						(action) => {
							this.plugin.settings.headsetPreviousTrack = action;
						},
					),
					aliases: HEADSET_ALIASES,
				},
				{
					...this.dropdownRow(
						"Next track",
						NEXT_TRACK_ACTIONS,
						() => this.plugin.settings.headsetNextTrack,
						(action) => {
							this.plugin.settings.headsetNextTrack = action;
						},
					),
					aliases: HEADSET_ALIASES,
				},
			]),
			group("Notes", [
				this.textRow("Timestamp template", {
					...this.text((settings) => settings.timestamp, "template"),
					kind: "area",
					preview: (value, setting) => this.previewTimestamp(value, setting),
				}),
				this.textRow(
					"Timestamp offset (s)",
					{
						kind: "number",
						read: () => `${this.plugin.settings.timestamp.offset}`,
						write: (value) => {
							this.plugin.settings.timestamp.offset = Math.max(
								0,
								Number.parseInt(value, 10) || 0,
							);
						},
					},
					"Captures this many seconds earlier.",
				),
				this.quickAddRow(),
				this.textRow("Episode note path", {
					...this.text((settings) => settings.note, "path"),
					preview: pathPreview(FilePathTemplateEngine),
				}),
				this.textRow("Episode note template", {
					...this.text((settings) => settings.note, "template"),
					kind: "template",
				}),
				this.textRow("Podcast note path", {
					...this.text((settings) => settings.feedNote, "path"),
					preview: (value, setting) =>
						setting.setDesc(FeedFilePathTemplateEngine(value, this.demoFeed())),
				}),
				this.textRow("Podcast note template", {
					...this.text((settings) => settings.feedNote, "template"),
					kind: "template",
				}),
			]),
			group("Transcripts", [
				this.secretRow("OpenAI API key", "openAISecretId"),
				this.textRow("Transcript path", {
					...this.text((settings) => settings.transcript, "path"),
					preview: pathPreview(FilePathTemplateEngine),
				}),
				this.textRow("Transcript template", {
					...this.text((settings) => settings.transcript, "template"),
					kind: "template",
				}),
				{
					name: "Speaker diarization",
					desc: "Label transcript turns by speaker.",
					render: (setting) =>
						void setting.addToggle((toggle) =>
							toggle.setValue(diarization().enabled).onChange((on) => {
								diarization().enabled = on;
								this.changed();
							}),
						),
				},
				this.whenDiarizing(
					this.dropdownRow(
						"Diarization provider",
						DIARIZATION_PROVIDERS,
						() => diarization().provider,
						(provider) => {
							diarization().provider = provider;
						},
						"Deepgram needs its own API key and keeps speaker labels consistent across long episodes.",
					),
					({ enabled }) => enabled,
				),
				this.whenDiarizing(
					this.secretRow("Deepgram API key", "deepgramSecretId"),
					({ enabled, provider }) => enabled && provider === "deepgram",
				),
				this.whenDiarizing(
					this.textRow(
						"Speaker label format",
						this.text((settings) => settings.transcript.diarization, "speakerTemplate"),
						"{{speaker}} is the speaker's label.",
					),
					({ enabled }) => enabled,
				),
			]),
			group("Downloads", [
				this.textRow("Download path", {
					...this.text((settings) => settings.download, "path"),
					preview: (value, setting) => {
						pathPreview(DownloadPathTemplateEngine, ".mp3")(value, setting);
						setting.setErrorMessage(
							/\{\{title(:[^}]*)?\}\}/i.test(value)
								? null
								: "Without {{title}}, episodes share a file name and a second download to it fails. Add it, for example PodNotes/{{podcast}}/{{title}}.",
						);
					},
				}),
			]),
			group("Library", [
				this.importRow("Import OPML", () =>
					pickFile(".opml", importOPML, {
						tooLargeMessage: "That file is too large to be an OPML file.",
					}),
				),
				this.exportRow("Export OPML", "PodNotes_Export.opml", (fileName) => {
					const feeds = Object.values(get(savedFeeds));
					if (feeds.length === 0) new Notice("No podcasts to export.");
					else void exportOPML(this.app, feeds, fileName);
				}),
				this.textRow("Latest episodes per podcast", {
					kind: "number",
					min: 1,
					max: MAX_EPISODE_LIST_LIMIT,
					read: () =>
						`${sanitizeEpisodeListLimit(this.plugin.settings.episodeListLimit)}`,
					write: (value) => {
						if (value.trim() === "" || !Number.isFinite(Number(value))) return;
						const limit = sanitizeEpisodeListLimit(value);
						this.plugin.settings.episodeListLimit = limit;
						episodeListLimit.set(limit);
					},
				}),
			]),
			group("Import and export", [
				this.importRow("Import settings", () =>
					pickFile(".json", (contents) => this.handleSettingsImport(contents)),
				),
				{
					name: "Include API keys",
					desc: "Adds this device's OpenAI and Deepgram keys to the file as plain text. The file is in your vault, so it may sync to other devices and other plugins can read it.",
					render: (setting) => {
						this.includeApiKeys = false;
						setting.addToggle((toggle) =>
							toggle.setValue(false).onChange((on) => {
								this.includeApiKeys = on;
							}),
						);
					},
				},
				this.exportRow(
					"Export settings",
					"PodNotes_Settings.json",
					(fileName) => void this.handleSettingsExport(fileName, this.includeApiKeys),
				),
			]),
		];
	}

	override hide(): void {
		this.completeDrafts();
		for (const stop of this.follows) stop();
		super.hide();
	}

	private changed(): void {
		plugin.set(this.plugin);
		void this.plugin.saveSettings();
	}

	private completeDrafts(): void {
		for (const complete of this.drafts) complete();
	}

	private bindDraft(
		input: HTMLInputElement | HTMLTextAreaElement,
		apply: (value: string) => boolean,
		show: () => void,
	): () => void {
		let { win, doc } = input;
		// The main window's timer: a popout's stops when it closes.
		let pendingSave: number | undefined;
		const save = () => {
			window.clearTimeout(pendingSave);
			pendingSave = undefined;
			this.changed();
		};
		const hidden = () => doc.visibilityState === "hidden" && complete();
		const complete = () => {
			if (this.drafts.delete(complete)) {
				win.removeEventListener("pagehide", complete);
				doc.removeEventListener("visibilitychange", hidden);
				if (pendingSave !== undefined) save();
			}
			show();
		};
		input.addEventListener("input", () => {
			if (apply(input.value) || pendingSave !== undefined) {
				window.clearTimeout(pendingSave);
				pendingSave = window.setTimeout(save, TYPING_SAVE_DELAY_MS);
			}
			if (this.drafts.has(complete)) return;
			({ win, doc } = input);
			this.drafts.add(complete);
			win.addEventListener("pagehide", complete);
			doc.addEventListener("visibilitychange", hidden);
		});
		input.addEventListener("change", complete);
		input.addEventListener("blur", complete);
		return complete;
	}

	private follow(setting: Setting, show: (settings: IPodNotesSettings) => void): () => void {
		const { win } = setting.settingEl;
		const unsubscribe = plugin.subscribe(() => show(this.plugin.settings));
		const stop = () => {
			if (!this.follows.delete(stop)) return;
			win.removeEventListener("pagehide", stop);
			unsubscribe();
		};
		this.follows.add(stop);
		win.addEventListener("pagehide", stop);
		return stop;
	}

	private text<K extends string>(
		section: (settings: IPodNotesSettings) => Record<K, string>,
		key: K,
	): TextField {
		return {
			read: () => section(this.plugin.settings)[key],
			write: (value) => {
				section(this.plugin.settings)[key] = value;
			},
			placeholder: section(DEFAULT_SETTINGS)[key],
		};
	}

	private seconds(key: "skipBackwardLength" | "skipForwardLength"): TextField {
		return {
			kind: "number",
			read: () => `${this.plugin.settings[key]}`,
			write: (value) => {
				const seconds = Number.parseInt(value, 10);
				if (seconds > 0) this.plugin.settings[key] = seconds;
			},
		};
	}

	private textRow(name: string, field: TextField, desc?: string): SettingDefinitionRender {
		const active = this.containerEl.querySelector<HTMLInputElement | HTMLTextAreaElement>(
			"input:focus,textarea:focus",
		);
		let draft =
			active?.name === name
				? {
						value: active.value,
						start: active.selectionStart,
						end: active.selectionEnd,
						direction: active.selectionDirection,
					}
				: undefined;
		return {
			name,
			desc,
			render: (setting) => {
				let complete = () => {};
				let stopPreview = () => {};
				const bind = (control: TextComponent | TextAreaComponent) => {
					control.inputEl.name = name;
					control
						.setValue(draft?.value ?? field.read())
						.setPlaceholder(field.placeholder ?? "")
						.onChange((value) => field.preview?.(value, setting));
					if (draft?.start != null)
						control.inputEl.setSelectionRange(
							draft.start,
							draft.end,
							draft.direction ?? undefined,
						);
					draft = undefined;
					complete = this.bindDraft(
						control.inputEl,
						(value) => {
							const before = field.read();
							field.write(value);
							return field.read() !== before;
						},
						() => {
							control.setValue(field.read());
							field.preview?.(field.read(), setting);
						},
					);
					const preview = field.preview;
					if (preview) {
						stopPreview = this.follow(setting, () =>
							preview(control.inputEl.value, setting),
						);
					}
				};
				if (field.kind === "area" || field.kind === "template") {
					stackSettingVertically(setting);
					setting.addTextArea((area) => {
						area.inputEl.setCssStyles({
							width: "100%",
							height: field.kind === "template" ? "25vh" : "",
						});
						bind(area);
					});
				} else {
					if (!field.kind) stackSettingVertically(setting);
					setting.addText((text) => {
						if (field.kind === "number") {
							text.inputEl.type = "number";
							text.inputEl.min = field.min?.toString() ?? "";
							text.inputEl.max = field.max?.toString() ?? "";
						} else text.inputEl.setCssStyles({ width: "100%" });
						bind(text);
						// Desktop fires no change on Enter.
						text.inputEl.addEventListener("keydown", (event) => {
							if (event.key === "Enter" && !event.isComposing) complete();
						});
					});
				}
				return () => {
					complete();
					stopPreview();
				};
			},
		};
	}

	private dropdownRow<T extends string>(
		name: string,
		options: Readonly<Record<T, string>>,
		read: () => T,
		write: (value: T) => void,
		desc?: string,
	): SettingDefinitionRender {
		return {
			name,
			desc,
			render: (setting) =>
				void setting.addDropdown((dropdown) =>
					dropdown
						.addOptions(options)
						.setValue(read())
						.onChange((value) => {
							if (!isOption(options, value)) return;
							write(value);
							this.changed();
						}),
				),
		};
	}

	private speedRow(): SettingDefinitionRender {
		return {
			name: "Default speed",
			render: (setting) =>
				void setting.addDropdown((dropdown) => {
					const saved = this.plugin.settings.defaultPlaybackRate;
					const rates = PLAYBACK_RATES.includes(saved)
						? PLAYBACK_RATES
						: [...PLAYBACK_RATES, saved].sort((a, b) => a - b);
					for (const rate of rates) dropdown.addOption(`${rate}`, `${rate}×`);
					dropdown.setValue(`${saved}`).onChange((value) => {
						this.plugin.settings.defaultPlaybackRate = Number(value);
						this.changed();
					});
				}),
		};
	}

	private whenDiarizing(
		row: SettingDefinitionRender,
		applies: (diarization: Diarization) => boolean,
	): SettingDefinitionRender {
		return {
			...row,
			render: (setting, settingGroup) => {
				const end = row.render(setting, settingGroup);
				const stop = this.follow(setting, ({ transcript }) => {
					const off = !applies(transcript.diarization);
					setting.setDisabled(off || this.settingsInteractionLockCount > 0);
					// Obsidian dims only disabled action rows.
					setting.settingEl.setCssStyles({ opacity: off ? "0.5" : "" });
				});
				return () => {
					stop();
					if (typeof end === "function") end();
				};
			},
		};
	}

	private secretRow(name: string, key: SecretReferenceKey): SettingDefinitionRender {
		return {
			name,
			render: (setting) => {
				const describe = () =>
					setting.setDesc(
						this.plugin.credentials.status(
							this.plugin.settings,
							CREDENTIAL_KIND_BY_REFERENCE[key],
						) === "missing"
							? "The selected secret is not available on this device. Select an existing secret or create one."
							: "",
					);
				describe();
				setting.addComponent((element) => {
					const secret = new SecretComponent(this.app, element).setValue(
						this.plugin.settings[key],
					);
					secret.onChange((value) =>
						this.handleSecretSelection(key, value, secret, describe),
					);
					return secret;
				});
			},
		};
	}

	/** QuickAdd owns the choices, their names and the picker; the row stores a choice's id. */
	private quickAddRow(): SettingDefinitionRender {
		return {
			name: "QuickAdd choice",
			render: (setting) => {
				const select = (id?: string) => {
					this.plugin.settings.timestamp.quickAddChoiceId = id;
					this.changed();
				};
				let choose!: ButtonComponent;
				let create!: ButtonComponent;
				let clear!: ExtraButtonComponent;
				setting
					.addButton((button) => {
						choose = button.onClick(async () => {
							const quickAdd = findQuickAdd(this.app);
							if ("fix" in quickAdd) {
								(this.app as App2).setting.openTabById("community-plugins");
								return;
							}
							const picked = await quickAdd.api.pickChoice().catch(() => null);
							if (picked) select(picked.id);
						});
					})
					.addButton((button) => {
						create = button
							.setButtonText("Create")
							.setClass(NAMED_BY_ROW)
							.onClick(async () => {
								const quickAdd = findQuickAdd(this.app);
								if ("fix" in quickAdd) return;
								await quickAdd.api
									.importPackage(CAPTURE_PACKAGE)
									.catch((error) =>
										console.error(
											"PodNotes: QuickAdd could not import the choice",
											error,
										),
									);
								if (quickAdd.api.getChoice({ id: CAPTURE_CHOICE_ID }))
									select(CAPTURE_CHOICE_ID);
								else new Notice("Could not create the QuickAdd choice");
							});
					})
					.addExtraButton((button) => {
						clear = button
							.setIcon("x")
							.setTooltip("Clear")
							.onClick(() => select());
					});
				return this.follow(setting, ({ timestamp: { quickAddChoiceId: id } }) => {
					const quickAdd = findQuickAdd(this.app);
					choose.setButtonText(
						"fix" in quickAdd
							? `${quickAdd.fix} QuickAdd`
							: id
								? (quickAdd.api.getChoice({ id })?.name ?? "Missing choice")
								: "Choose...",
					);
					choose.buttonEl.classList.toggle(NAMED_BY_ROW, "api" in quickAdd);
					create.buttonEl.toggle("api" in quickAdd && !id);
					clear.extraSettingsEl.toggle(Boolean(id));
				});
			},
		};
	}

	private importRow(name: string, pick: () => void): SettingDefinitionRender {
		return {
			name,
			render: (setting) =>
				void setting.addButton((button) => button.setButtonText("Import").onClick(pick)),
		};
	}

	private exportRow(
		name: string,
		defaultName: string,
		run: (fileName: string) => void,
	): SettingDefinitionRender {
		const extension = defaultName.slice(defaultName.lastIndexOf("."));
		return {
			name,
			render: (setting) => {
				let fileName = defaultName;
				setting
					.addText((text) =>
						text
							.setPlaceholder(defaultName)
							.setValue(fileName)
							.onChange((value) => {
								fileName = value;
							}),
					)
					.addButton((button) =>
						button.setButtonText("Export").onClick(() => {
							const chosen = fileName.trim() || defaultName;
							run(chosen.endsWith(extension) ? chosen : `${chosen}${extension}`);
						}),
					);
			},
		};
	}

	private previewTimestamp(template: string, setting: Setting): void {
		if (!this.plugin.api.podcast) {
			setting.setDesc("Play an episode to preview the timestamp.");
			return;
		}
		setting.descEl.empty();
		void MarkdownRenderer.render(
			this.app,
			TimestampTemplateEngine(template),
			setting.descEl,
			"",
			new Component(),
		);
	}

	private demoEpisode(): Episode {
		for (const { episodes } of get(this.plugin.feeds).values()) {
			if (episodes[0]) return episodes[0];
		}
		return {
			title: "demo",
			podcastName: "demo",
			description: "demo",
			content: "demo",
			url: "demo",
			artworkUrl: "demo",
			streamUrl: "demo",
			episodeDate: new Date(),
			feedUrl: "demo",
		};
	}

	private demoFeed(): PodcastFeed {
		return (
			Object.values(get(savedFeeds))[0] ?? {
				title: "Demo Podcast",
				url: "https://example.com/feed.xml",
				artworkUrl: "https://example.com/artwork.jpg",
				description: "A demo podcast feed.",
				link: "https://example.com",
				author: "Demo Author",
			}
		);
	}

	private async handleSettingsExport(fileName: string, includeSecret: boolean): Promise<void> {
		this.completeDrafts();
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
				privateFeedAddresses(this.plugin.settings.savedFeeds, this.plugin.feedUrls),
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
			new Notice(
				`Unable to export settings:\n\n${error instanceof Error ? error.message : "Unknown error"}`,
			);
			console.error("PodNotes: failed to export settings", error);
		}
	}

	private handleSettingsImport(contents: string): void {
		const result = parseImport(contents);
		if (!result.ok) {
			new Notice(`Could not import settings: ${result.error}`, 10000);
			return;
		}

		const { settings } = this.plugin;
		const sections = Object.entries({
			savedFeeds: settings.savedFeeds,
			playlists: settings.playlists,
			queue: settings.queue.episodes,
			favorites: settings.favorites.episodes,
		})
			.filter(([key, current]) => key in result.settings && Object.keys(current).length > 0)
			.map(([key]) => (key === "savedFeeds" ? "podcast feeds" : key));
		sections.push(...describeSecrets(result.secrets));
		const detail = sections.length ? ` Also replaced: ${sections.join(", ")}.` : "";
		const secretDetail =
			Object.keys(result.secrets).length > 0
				? " Existing Obsidian secrets are never overwritten; conflicts are saved under a new PodNotes name."
				: "";

		new ConfirmModal(
			this.app,
			"Import PodNotes settings?",
			`This overwrites your current PodNotes preferences and templates with the imported values.${detail}${secretDetail} Your playback progress, downloads, and local files are kept.`,
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
		this.completeDrafts();
		const unlockSettingsInteractions = this.lockSettingsInteractions();
		try {
			const result = await this.enqueueSettingsMutation(() =>
				this.persistImportedSettings(imported, secrets),
			);
			if (result === "failed") return;

			await this.waitForSettingsMutationLaneToDrain();
			this.update();
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
		let merged: IPodNotesSettings;
		try {
			const secretReferences = this.plugin.credentials.storeValues(secrets);
			// A raw data.json import can carry credential-bearing feed URLs; intern
			// them BEFORE the strict persist below so the secret never reaches disk.
			const protection = protectPrivateFeeds(
				mergeImportedSettings(previous, { ...imported, ...secretReferences }),
				this.plugin.feedUrls,
			);
			merged = protection.settings;
		} catch (error) {
			new Notice(
				"Could not finish importing secrets into Obsidian SecretStorage. Existing settings were kept, and retrying is safe.",
				10000,
			);
			console.error("PodNotes: failed to import secrets into SecretStorage", error);
			return "failed";
		}
		const progress = merged.playedEpisodes;
		const failedCandidate = structuredClone(merged);
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
					: decodePodNotesData({
							...restored,
							schemaVersion: PODNOTES_DATA_SCHEMA_VERSION,
						}).settings;
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

		savedFeeds.set(merged.savedFeeds);
		playlists.set(merged.playlists);
		favorites.set(merged.favorites);
		queue.set(merged.queue);
		// The player may have saved a position since the merge: keep it, add the rest.
		playedEpisodes.update((live) => ({ ...progress, ...live }));
		hidePlayedEpisodes.set(merged.hidePlayedEpisodes);
		episodeListLimit.set(merged.episodeListLimit);
		this.plugin.player.setVolume(merged.defaultVolume);

		try {
			// Store setters can canonicalize or deduplicate their slices. Await one
			// final strict snapshot so the success notice means that live state is
			// durable too.
			await this.plugin.saveSettingsStrict();
		} catch (error) {
			new Notice(
				"Imported PodNotes settings, but could not save them yet. PodNotes saves them once it can.",
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
			plugin.set(this.plugin);
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
		selectedId: string | null,
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
		selectedId: string | null,
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
		this.plugin.settings[key] = persistedId;

		try {
			await this.plugin.saveSettingsStrict();
			return { persistedId, saved: true };
		} catch (error) {
			this.plugin.settings[key] = previous;
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
		selectedId: string | null,
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
					.setDestructive()
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
