import {
	currentEpisode,
	downloadedEpisodes,
	episodeListLimit,
	favorites,
	localFiles,
	playedEpisodes,
	playlists,
	queue,
	savedFeeds,
	hidePlayedEpisodes,
	sanitizeEpisodeListLimit,
	playbackRate,
	volume,
} from "src/store";
import {
	Notice,
	Platform,
	Plugin,
	type Editor,
	type WorkspaceLeaf,
} from "obsidian";
import { API } from "src/API/API";
import type { IAPI } from "src/API/IAPI";
import { DEFAULT_SETTINGS, VIEW_TYPE } from "src/constants";
import {
	migrateDownloadPath,
	migrateNoteSettings,
	migrateTranscriptSettings,
} from "src/settingsMigrations";
import { requiredTranscriptionKeyPresent } from "src/services/diarization";
import { PodNotesSettingsTab } from "src/ui/settings/PodNotesSettingsTab";
import { MainView } from "src/ui/PodcastView";
import { QueueReorderModal } from "src/ui/QueueReorderModal";
import type { IPodNotesSettings } from "./types/IPodNotesSettings";
import { plugin } from "./store";
import type { IPodNotes } from "./types/IPodNotes";
import { EpisodeStatusController } from "./store_controllers/EpisodeStatusController";
import type { StoreController } from "./types/StoreController";
import type { PlayedEpisode } from "./types/PlayedEpisode";
import type { PodcastFeed } from "./types/PodcastFeed";
import { SavedFeedsController } from "./store_controllers/SavedFeedsController";
import type { Playlist } from "./types/Playlist";
import { PlaylistController } from "./store_controllers/PlaylistController";
import { QueueController } from "./store_controllers/QueueController";
import { FavoritesController } from "./store_controllers/FavoritesController";
import type { Episode } from "./types/Episode";
import CurrentEpisodeController from "./store_controllers/CurrentEpisodeController";
import { HidePlayedEpisodesController } from "./store_controllers/HidePlayedEpisodesController";
import { TimestampTemplateEngine } from "./TemplateEngine";
import { prepareTimestampForInsertion } from "./utility/prepareTimestampInsertion";
import {
	createRecentPodcastSegment,
	getSegmentCaptureTemplate,
} from "./utility/podcastSegment";
import createPodcastNote, {
	createPodcastNoteFileIfNotExists,
	getPodcastNote,
} from "./createPodcastNote";
import createFeedNote from "./createFeedNote";
import { FeedSuggestModal, orderFeedsByCurrent } from "./ui/FeedSuggestModal";
import downloadEpisodeWithNotice from "./downloadEpisode";
import type DownloadedEpisode from "./types/DownloadedEpisode";
import DownloadedEpisodesController from "./store_controllers/DownloadedEpisodesController";
import { LocalFilesController } from "./store_controllers/LocalFilesController";
import type PartialAppExtension from "./global";
import podNotesURIHandler from "./URIHandler";
import getContextMenuHandler from "./getContextMenuHandler";
import getUniversalPodcastLink from "./getUniversalPodcastLink";
import type { IconType } from "./types/IconType";
import { TranscriptionService } from "./services/TranscriptionService";
import { get, type Unsubscriber } from "svelte/store";
import { normalizePlaybackRate } from "./utility/playbackRate";

type MediaSessionActionName =
	| "previoustrack"
	| "play"
	| "pause"
	| "stop"
	| "nexttrack"
	| "seekbackward"
	| "seekforward"
	| "seekto"
	| "skipad";

export default class PodNotes extends Plugin implements IPodNotes {
	public api!: IAPI;
	public settings!: IPodNotesSettings;
	public override app!: PartialAppExtension;

	private views = new Set<MainView>();

	private playedEpisodeController?: StoreController<{
		[episodeName: string]: PlayedEpisode;
	}>;
	private savedFeedsController?: StoreController<{
		[podcastName: string]: PodcastFeed;
	}>;
	private playlistController?: StoreController<{
		[playlistName: string]: Playlist;
	}>;
	private queueController?: StoreController<Playlist>;
	private favoritesController?: StoreController<Playlist>;
	private localFilesController?: StoreController<Playlist>;
	private currentEpisodeController?: StoreController<Episode>;
	private downloadedEpisodesController?: StoreController<{
		[podcastName: string]: DownloadedEpisode[];
	}>;
	private hidePlayedEpisodesController?: StoreController<boolean>;
	private transcriptionService?: TranscriptionService;
	private volumeUnsubscribe?: Unsubscriber;
	private localFilesMirrorUnsubscribe?: Unsubscriber;

	private maxLayoutReadyAttempts = 10;
	private layoutReadyAttempts = 0;
	private layoutReadyRetry: ReturnType<typeof setTimeout> | null = null;
	private isUnloaded = false;
	private podcastViewMountEnabled = !Platform.isMobileApp;
	private isReady = false;
	private pendingSave: IPodNotesSettings | null = null;
	private saveScheduled = false;
	private saveChain: Promise<void> = Promise.resolve();
	private mediaSessionActions: MediaSessionActionName[] = [];

	override async onload() {
		this.isUnloaded = false;
		this.podcastViewMountEnabled = !Platform.isMobileApp;
		plugin.set(this);

		await this.loadSettings();

		playedEpisodes.set(this.settings.playedEpisodes);
		savedFeeds.set(this.settings.savedFeeds);
		playlists.set(this.settings.playlists);
		queue.set(this.settings.queue);
		favorites.set(this.settings.favorites);
		localFiles.set(this.settings.localFiles);
		downloadedEpisodes.set(this.settings.downloadedEpisodes);
		if (this.settings.currentEpisode) {
			currentEpisode.set(this.settings.currentEpisode);
		}
		hidePlayedEpisodes.set(this.settings.hidePlayedEpisodes);
		// loadSettings() already sanitized this, so the store stays in sync with
		// the (repaired) persisted value.
		episodeListLimit.set(this.settings.episodeListLimit);
		volume.set(
			Math.min(1, Math.max(0, this.settings.defaultVolume ?? 1)),
		);
		playbackRate.set(
			normalizePlaybackRate(this.settings.defaultPlaybackRate),
		);

		this.playedEpisodeController = new EpisodeStatusController(
			playedEpisodes,
			this,
		).on();
		this.savedFeedsController = new SavedFeedsController(savedFeeds, this).on();
		this.playlistController = new PlaylistController(playlists, this).on();
		this.queueController = new QueueController(queue, this).on();
		this.favoritesController = new FavoritesController(favorites, this).on();
		this.localFilesController = new LocalFilesController(localFiles, this).on();
		this.downloadedEpisodesController = new DownloadedEpisodesController(
			downloadedEpisodes,
			this,
		).on();
		this.currentEpisodeController = new CurrentEpisodeController(
			currentEpisode,
			this,
		).on();
		this.hidePlayedEpisodesController = new HidePlayedEpisodesController(
			hidePlayedEpisodes,
			this,
		).on();

		// Keep the Local Files playlist in sync with downloaded episodes (issue #176).
		// downloadedEpisodes is the authoritative offline set, so mirror it into the
		// localFiles playlist that the Podcast grid renders. Svelte's immediate-fire
		// backfills already-downloaded episodes on load; later changes keep it current.
		this.localFilesMirrorUnsubscribe = downloadedEpisodes.subscribe(
			(downloaded) => localFiles.syncWithDownloaded(downloaded),
		);

		this.api = new API();
		this.volumeUnsubscribe = volume.subscribe((value) => {
			const clamped = Math.min(1, Math.max(0, value));

			if (clamped !== value) {
				volume.set(clamped);
				return;
			}

			if (clamped === this.settings.defaultVolume) {
				return;
			}

			this.settings.defaultVolume = clamped;
			void this.saveSettings();
		});

		this.addCommand({
			id: "podnotes-show-leaf",
			name: "Show PodNotes",
			icon: "podcast" as IconType,
			// Always available, and always reveals the view. The previous
			// checkCallback hid this command whenever a leaf already existed, so
			// once the view was open-but-hidden (collapsed sidebar, sidebar
			// overflow, dragged out of sight) there was no way to bring it back
			// (#55). activateView reuses the existing leaf and reveals it.
			callback: () => {
				void this.activateView();
			},
		});

		this.addCommand({
			id: "start-playing",
			name: "Play Podcast",
			icon: "play-circle" as IconType,
			checkCallback: (checking) => {
				if (checking) {
					return !this.api.isPlaying && !!this.api.podcast;
				}

				this.api.start();
			},
		});

		this.addCommand({
			id: "stop-playing",
			name: "Stop Podcast",
			icon: "stop-circle" as IconType,
			checkCallback: (checking) => {
				if (checking) {
					return this.api.isPlaying && !!this.api.podcast;
				}

				this.api.stop();
			},
		});

		this.addCommand({
			id: "skip-backward",
			name: "Skip Backward",
			icon: "skip-back" as IconType,
			checkCallback: (checking) => {
				if (checking) {
					return this.api.isPlaying && !!this.api.podcast;
				}

				this.api.skipBackward();
			},
		});

		this.addCommand({
			id: "skip-forward",
			name: "Skip Forward",
			icon: "skip-forward" as IconType,
			checkCallback: (checking) => {
				if (checking) {
					return this.api.isPlaying && !!this.api.podcast;
				}

				this.api.skipForward();
			},
		});

		this.addCommand({
			id: "download-playing-episode",
			name: "Download Playing Episode",
			icon: "download" as IconType,
			checkCallback: (checking) => {
				if (checking) {
					return !!this.api.podcast;
				}

				const episode = this.api.podcast;
				downloadEpisodeWithNotice(episode, this.settings.download.path);
			},
		});

		this.addCommand({
			id: "reorder-queue",
			name: "Reorder Queue",
			icon: "list-ordered" as IconType,
			checkCallback: (checking) => {
				if (checking) {
					return get(queue).episodes.length > 1;
				}

				new QueueReorderModal(this.app).open();
			},
		});

		this.addCommand({
			id: "hrpn",
			name: "Reload PodNotes",
			callback: () => {
				const id = this.manifest.id;

				this.app.plugins
					.disablePlugin(id)
					.then(() => this.app.plugins.enablePlugin(id));
			},
		});

		const canCaptureTimestamp = () =>
			!!this.api.podcast && !!this.settings.timestamp.template;
		const insertCapture = (editor: Editor, capture: string) => {
			// Insert with replaceSelection (not getCursor + replaceRange +
			// setCursor): it drops the text at the live cursor and lets the
			// editor place the caret after it, which is reliable inside Live
			// Preview table cells where hand-computed positions land in the
			// wrong cell. Inside a table the capture is escaped so pipes and
			// newlines don't break the row. See issue #165.
			const cursor = editor.getCursor("from");
			const textToInsert = prepareTimestampForInsertion(capture, {
				getLine: (line) => editor.getLine(line),
				lineCount: editor.lineCount(),
				cursorLine: cursor.line,
			});

			editor.replaceSelection(textToInsert);
		};
		const captureRecentSegment = (editor: Editor, lengthSeconds: number) => {
			const segment = createRecentPodcastSegment(
				this.api.currentTime,
				lengthSeconds,
				this.settings.timestamp.offset ?? 0,
			);

			if (!segment) {
				new Notice("Play more of the episode before capturing a segment");
				return;
			}

			const capture = TimestampTemplateEngine(
				getSegmentCaptureTemplate(this.settings.timestamp.template),
				{ segment },
			);
			insertCapture(editor, capture);
		};

		this.addCommand({
			id: "capture-timestamp",
			name: "Capture Timestamp",
			icon: "clock" as IconType,
			editorCallback: (editor) => {
				this.captureTimestamp(editor);
			},
		});

		this.addCommand({
			id: "capture-segment-10s",
			name: "Capture Last 10 Seconds",
			icon: "scissors" as IconType,
			editorCheckCallback: (checking, editor) => {
				if (checking) {
					return canCaptureTimestamp();
				}

				captureRecentSegment(editor, 10);
			},
		});

		this.addCommand({
			id: "capture-segment-20s",
			name: "Capture Last 20 Seconds",
			icon: "scissors" as IconType,
			editorCheckCallback: (checking, editor) => {
				if (checking) {
					return canCaptureTimestamp();
				}

				captureRecentSegment(editor, 20);
			},
		});

		this.addCommand({
			id: "create-podcast-note",
			// Despite the id, this creates a note for the CURRENT EPISODE. The
			// visible name was corrected to disambiguate it from the feed-level
			// "Create podcast feed note" command below (issue #163). The id is kept
			// for backward compatibility (hotkeys/API).
			name: "Create episode note",
			icon: "file-plus" as IconType,
			checkCallback: (checking) => {
				if (checking) {
					return (
						!!this.api.podcast &&
						!!this.settings.note.path &&
						!!this.settings.note.template
					);
				}

				createPodcastNote(this.api.podcast);
			},
		});

		this.addCommand({
			id: "create-podcast-feed-note",
			name: "Create podcast feed note",
			icon: "file-plus" as IconType,
			checkCallback: (checking) => {
				const feeds = Object.values(get(savedFeeds));
				const canCreate =
					feeds.length > 0 &&
					!!this.settings.feedNote.path &&
					!!this.settings.feedNote.template;

				if (checking) {
					return canCreate;
				}

				if (!canCreate) return;

				// Pre-select the playing episode's feed when there is one, so the
				// picker opens on the most likely choice without requiring playback.
				const orderedFeeds = orderFeedsByCurrent(
					feeds,
					this.api.podcast?.podcastName,
				);

				new FeedSuggestModal(this.app, orderedFeeds, (feed) => {
					void createFeedNote(feed);
				}).open();
			},
		});

		this.addCommand({
			id: "get-share-link-episode",
			name: "Copy universal episode link to clipboard",
			icon: "share" as IconType,
			checkCallback: (checking) => {
				if (checking) {
					return !!this.api.podcast;
				}

				getUniversalPodcastLink(this.api);
			},
		});

		this.addCommand({
			id: "podnotes-toggle-playback",
			name: "Toggle playback",
			icon: "play" as IconType,
			checkCallback: (checking) => {
				if (checking) {
					return !!this.api.podcast;
				}

				this.api.togglePlayback();
			},
		});

		this.addCommand({
			id: "increase-playback-rate",
			name: "Increase playback rate",
			icon: "gauge" as IconType,
			checkCallback: (checking) => {
				if (checking) {
					return !!this.api.podcast;
				}

				this.api.increasePlaybackRate();
			},
		});

		this.addCommand({
			id: "decrease-playback-rate",
			name: "Decrease playback rate",
			icon: "gauge" as IconType,
			checkCallback: (checking) => {
				if (checking) {
					return !!this.api.podcast;
				}

				this.api.decreasePlaybackRate();
			},
		});

		this.addCommand({
			id: "reset-playback-rate",
			name: "Reset playback rate",
			icon: "rotate-ccw" as IconType,
			checkCallback: (checking) => {
				if (checking) {
					return !!this.api.podcast;
				}

				this.api.resetPlaybackRate();
			},
		});

		this.addCommand({
			id: "podnotes-transcribe",
			name: "Transcribe current episode",
			checkCallback: (checking) => {
				const canTranscribe =
					!!this.api.podcast &&
					requiredTranscriptionKeyPresent(this.settings);

				if (checking) {
					return canTranscribe;
				}

				if (canTranscribe) {
					void this.getTranscriptionService().transcribeCurrentEpisode();
				}
			},
		});

		this.addSettingTab(new PodNotesSettingsTab(this.app, this));

		this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => {
			const view = new MainView(leaf, this);
			this.views.add(view);
			return view;
		});

		// Persistent, discoverable entry point in the left ribbon. The right
		// sidebar header can overflow and hide the view's tab icon (the original
		// report in #55), but the ribbon is always reachable, so users can always
		// reopen PodNotes.
		this.addRibbonIcon("podcast" as IconType, "Show PodNotes", () => {
			void this.activateView();
		});

		this.app.workspace.onLayoutReady(this.onLayoutReady.bind(this));

		this.registerObsidianProtocolHandler("podnotes", (action) => {
			this.enablePodcastViewMount();
			return podNotesURIHandler(action, this.api);
		});

		this.registerEvent(getContextMenuHandler(this.app));
		this.registerMediaSessionHandlers();

		this.isReady = true;
	}

	onLayoutReady(): void {
		if (this.isUnloaded) {
			return;
		}

		if (Platform.isMobileApp) {
			// Mobile startup is sensitive to creating plugin-owned side panes; keep
			// PodNotes dormant until the user opens it with the command or ribbon.
			this.clearLayoutReadyRetry();
			this.layoutReadyAttempts = 0;
			return;
		}

		if (!this.app.workspace || !this.app.workspace.layoutReady) {
			// Workspace is not ready, schedule a retry
			this.layoutReadyAttempts++;
			if (this.layoutReadyAttempts >= this.maxLayoutReadyAttempts) {
				console.error(
					"Failed to initialize PodNotes layout after maximum attempts",
				);
			} else if (!this.layoutReadyRetry) {
				this.layoutReadyRetry = setTimeout(() => {
					this.layoutReadyRetry = null;
					this.onLayoutReady();
				}, 100);
			}
			return;
		}

		this.clearLayoutReadyRetry();
		this.layoutReadyAttempts = 0;

		if (this.app.workspace.getLeavesOfType(VIEW_TYPE).length) {
			return;
		}

		const leaf = this.app.workspace.getRightLeaf(false);

		if (leaf) {
			void leaf
				.setViewState({
					type: VIEW_TYPE,
				})
				.catch((error) => {
					console.error("PodNotes: failed to initialize startup view", error);
				});
		}
	}

	// Reveal the PodNotes view, creating its leaf when needed. Reusing an
	// existing leaf (instead of gating on its absence) plus revealLeaf is what
	// makes "Show PodNotes" and the ribbon icon reliably surface the view even
	// when it is already open but hidden in a collapsed/overflowing sidebar (#55).
	async activateView(): Promise<void> {
		this.enablePodcastViewMount();

		const { workspace } = this.app;

		const existing = workspace.getLeavesOfType(VIEW_TYPE);
		let leaf: WorkspaceLeaf | null = existing[0] ?? null;

		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: VIEW_TYPE, active: true });
		}

		if (leaf) {
			await workspace.revealLeaf(leaf);
		}
	}

	shouldMountPodcastView(): boolean {
		return this.podcastViewMountEnabled;
	}

	enablePodcastViewMount(): void {
		this.podcastViewMountEnabled = true;
		for (const view of this.views) {
			view.mountPodcastView();
		}
	}

	unregisterPodcastView(view: MainView): void {
		this.views.delete(view);
	}

	private getTranscriptionService(): TranscriptionService {
		if (!this.transcriptionService) {
			this.transcriptionService = new TranscriptionService(this);
		}

		return this.transcriptionService;
	}

	private captureTimestamp(editor: Editor | null | undefined): boolean {
		if (!editor || !this.api.podcast || !this.settings.timestamp.template) {
			return false;
		}

		const capture = TimestampTemplateEngine(this.settings.timestamp.template);

		// Insert with replaceSelection (not getCursor + replaceRange + setCursor):
		// it drops the text at the live cursor and lets the editor place the caret
		// after it, which is reliable inside Live Preview table cells where
		// hand-computed positions land in the wrong cell. Inside a table the capture
		// is escaped so pipes and newlines don't break the row. See issue #165.
		const cursor = editor.getCursor("from");
		const textToInsert = prepareTimestampForInsertion(capture, {
			getLine: (line) => editor.getLine(line),
			lineCount: editor.lineCount(),
			cursorLine: cursor.line,
		});

		editor.replaceSelection(textToInsert);
		return true;
	}

	private captureTimestampInActiveEditor(): boolean {
		return this.captureTimestamp(this.app.workspace.activeEditor?.editor);
	}

	private async appendTimestampToEpisodeNote(): Promise<boolean> {
		if (
			!this.api.podcast ||
			!this.settings.timestamp.template ||
			!this.settings.note.path ||
			!this.settings.note.template
		) {
			return false;
		}

		const capture = TimestampTemplateEngine(this.settings.timestamp.template);
		const textToAppend = capture.endsWith("\n") ? capture : `${capture}\n`;
		const file =
			getPodcastNote(this.api.podcast) ??
			(await createPodcastNoteFileIfNotExists(this.api.podcast));
		const content = await this.app.vault.read(file);
		const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";

		await this.app.vault.modify(file, `${content}${separator}${textToAppend}`);
		return true;
	}

	private async captureTimestampFromMediaSession(): Promise<boolean> {
		if (this.captureTimestampInActiveEditor()) {
			return true;
		}

		return await this.appendTimestampToEpisodeNote();
	}

	private registerMediaSessionHandlers(): void {
		this.registerMediaSessionAction("previoustrack", () => {
			void this.captureTimestampFromMediaSession();
		});
	}

	private registerMediaSessionAction(
		action: MediaSessionActionName,
		handler: () => void,
	): void {
		const mediaSession = globalThis.navigator?.mediaSession;
		if (!mediaSession?.setActionHandler) {
			return;
		}

		try {
			mediaSession.setActionHandler(action, handler);
			this.mediaSessionActions.push(action);
		} catch (error) {
			console.warn(
				`PodNotes: Media Session action "${action}" is not supported`,
				error,
			);
		}
	}

	private clearMediaSessionHandlers(): void {
		const mediaSession = globalThis.navigator?.mediaSession;
		if (!mediaSession?.setActionHandler) {
			return;
		}

		for (const action of this.mediaSessionActions) {
			try {
				mediaSession.setActionHandler(action, null);
			} catch {
				// Ignore unsupported cleanup paths; registration already guarded them.
			}
		}

		this.mediaSessionActions = [];
	}

	override onunload() {
		this.isUnloaded = true;
		this.clearLayoutReadyRetry();
		this.clearMediaSessionHandlers();
		this.playedEpisodeController?.off();
		this.savedFeedsController?.off();
		this.playlistController?.off();
		this.queueController?.off();
		this.favoritesController?.off();
		this.localFilesController?.off();
		this.downloadedEpisodesController?.off();
		this.currentEpisodeController?.off();
		this.hidePlayedEpisodesController?.off();
		this.volumeUnsubscribe?.();
		this.localFilesMirrorUnsubscribe?.();
		this.views.clear();

		// Detach all leaves of this view type to prevent duplicates on reload
		this.app.workspace.detachLeavesOfType(VIEW_TYPE);
	}

	private clearLayoutReadyRetry(): void {
		if (!this.layoutReadyRetry) return;

		clearTimeout(this.layoutReadyRetry);
		this.layoutReadyRetry = null;
	}

	async loadSettings() {
		const loadedData = await this.loadData();

		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
		this.settings.timestamp = {
			...DEFAULT_SETTINGS.timestamp,
			...(loadedData?.timestamp ?? {}),
		};
		// Build a fresh download object so we never mutate the shared
		// DEFAULT_SETTINGS.download, then migrate the legacy empty default (#183).
		this.settings.download = {
			...DEFAULT_SETTINGS.download,
			...(loadedData?.download ?? {}),
		};
		this.settings.download.path = migrateDownloadPath(
			this.settings.download.path,
		);
		// Normalise the persisted limit so a malformed value (e.g. 0 from an older
		// data.json) is repaired in the settings object too, not just clamped for
		// runtime behaviour, and so a later saveSettings() can't re-persist it (#114).
		this.settings.episodeListLimit = sanitizeEpisodeListLimit(
			this.settings.episodeListLimit,
		);
		// Upgrade the legacy empty episode-note default to the Bases-friendly
		// default, preserving any path/template the user configured (#160). Returns
		// a fresh object, so DEFAULT_SETTINGS.note is never mutated.
		this.settings.note = migrateNoteSettings(loadedData?.note);
		// Backfill the diarization defaults onto the stored transcript object so an
		// existing user (who has only { path, template } persisted) gets a valid
		// transcript.diarization instead of undefined (#168).
		this.settings.transcript = migrateTranscriptSettings(
			loadedData?.transcript,
		);
	}

	async saveSettings() {
		if (!this.isReady) return;

		this.pendingSave = this.cloneSettings();

		if (this.saveScheduled) {
			return this.saveChain;
		}

		this.saveScheduled = true;

		this.saveChain = this.saveChain
			.then(async () => {
				while (this.pendingSave) {
					const snapshot = this.pendingSave;
					this.pendingSave = null;
					await this.saveData(snapshot);
				}
			})
			.catch((error) => {
				console.error("PodNotes: failed to save settings", error);
			})
			.finally(() => {
				this.saveScheduled = false;

				// If a save was requested while we were saving, run again.
				if (this.pendingSave) {
					void this.saveSettings();
				}
			});

		return this.saveChain;
	}

	private cloneSettings(): IPodNotesSettings {
		// structuredClone is available in Obsidian's Electron runtime; fallback for safety.
		if (typeof structuredClone === "function") {
			return structuredClone(this.settings);
		}

		return JSON.parse(JSON.stringify(this.settings)) as IPodNotesSettings;
	}
}
