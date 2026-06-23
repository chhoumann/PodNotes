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
	subscribeQueueToCurrentEpisode,
} from "src/store";
import { bindStoresToSettings } from "src/store/persistence";
import { registerCommands } from "src/commands";
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
	migrateFeedNoteSettings,
	migrateNoteSettings,
	migrateSkipLength,
	migrateTranscriptSettings,
} from "src/settingsMigrations";
import { PodNotesSettingsTab } from "src/ui/settings/PodNotesSettingsTab";
import { MainView } from "src/ui/PodcastView";
import type { IPodNotesSettings } from "./types/IPodNotesSettings";
import { plugin } from "./store";
import type { IPodNotes } from "./types/IPodNotes";
import { TimestampTemplateEngine } from "./TemplateEngine";
import { prepareTimestampForInsertion } from "./utility/prepareTimestampInsertion";
import {
	createPodcastNoteFileIfNotExists,
	getPodcastNote,
} from "./createPodcastNote";
import type PartialAppExtension from "./global";
import podNotesURIHandler from "./URIHandler";
import getContextMenuHandler from "./getContextMenuHandler";
import type { IconType } from "./types/IconType";
import { TranscriptionService } from "./services/TranscriptionService";
import { type Unsubscriber } from "svelte/store";
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

	// Store subscriptions tied to the plugin lifetime: settings persistence and
	// queue automation. Disposed together in onunload.
	private storeUnsubscribers: Unsubscriber[] = [];
	private transcriptionService?: TranscriptionService;
	private volumeUnsubscribe?: Unsubscriber;
	private localFilesMirrorUnsubscribe?: Unsubscriber;

	private maxLayoutReadyAttempts = 10;
	private layoutReadyAttempts = 0;
	// window.setTimeout returns a number in the browser/Electron renderer.
	private layoutReadyRetry: number | null = null;
	private isUnloaded = false;
	private podcastViewMountEnabled = true;
	private isReady = false;
	private pendingSave: IPodNotesSettings | null = null;
	private saveScheduled = false;
	private saveChain: Promise<void> = Promise.resolve();
	private mediaSessionActions: MediaSessionActionName[] = [];

	override async onload() {
		this.isUnloaded = false;
		this.podcastViewMountEnabled = !this.isMobileRuntime();
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

		// Mirror every store-backed slice of state into settings, and wire the queue
		// automation that drops the now-playing episode from the up-next queue. Both
		// are store subscriptions tied to the plugin lifetime; onunload disposes them.
		this.storeUnsubscribers.push(
			bindStoresToSettings(this),
			subscribeQueueToCurrentEpisode(),
		);

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

		// All user-facing commands live in src/commands.ts; this keeps onload
		// focused on lifecycle wiring (stores, view, ribbon, protocol, media session).
		registerCommands(this);

		this.addSettingTab(new PodNotesSettingsTab(this.app, this));

		this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => {
			const view = new MainView(leaf, this);
			this.views.add(view);
			return view;
		});

		// PodNotes is a single-instance view, and onunload deliberately does NOT
		// detach its leaves (detaching there would reset a leaf the user moved back
		// to its default location on the next load). The trade-off is a hot reload
		// (toggling the plugin) can briefly leave both the restored leaf and the
		// freshly auto-opened one, so collapse any duplicates back to a single leaf
		// whenever the layout changes. This converges (it only acts when >1 exists)
		// and never fires on a cold start, where only the restored leaf exists, so
		// its position is preserved.
		this.registerEvent(
			this.app.workspace.on("layout-change", () =>
				this.dedupePlayerLeaves(),
			),
		);

		// Persistent, discoverable entry point in the left ribbon. The right
		// sidebar header can overflow and hide the view's tab icon (the original
		// report in #55), but the ribbon is always reachable, so users can always
		// reopen PodNotes.
		this.addRibbonIcon("podcast" as IconType, "Show PodNotes", () => {
			void this.activateView();
		});

		this.app.workspace.onLayoutReady(this.onLayoutReady.bind(this));

		this.registerObsidianProtocolHandler("podnotes", (action) =>
			podNotesURIHandler(action, this.api, () => this.activateView()),
		);

		this.registerEvent(getContextMenuHandler(this.app));
		this.registerMediaSessionHandlers();

		this.isReady = true;
	}

	onLayoutReady(): void {
		if (this.isUnloaded) {
			return;
		}

		if (this.isMobileRuntime()) {
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
				this.layoutReadyRetry = window.setTimeout(() => {
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

	// Collapse the single-instance player view back to one leaf, keeping the
	// first (earliest) so a cold-restart-restored leaf is preserved while a
	// hot-reload's duplicate auto-open is dropped. Runs on layout-change; a no-op
	// unless more than one leaf exists, so it converges and can't loop.
	private dedupePlayerLeaves(): void {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
		for (const extra of leaves.slice(1)) {
			extra.detach();
		}
	}

	private isMobileRuntime(): boolean {
		return Platform.isMobileApp || this.app.isMobile === true;
	}

	// Public so the command registrations in src/commands.ts can reach them; both
	// are still only invoked from command callbacks (and, for captureTimestamp,
	// the media-session handler below).
	getTranscriptionService(): TranscriptionService {
		if (!this.transcriptionService) {
			this.transcriptionService = new TranscriptionService(this);
		}

		return this.transcriptionService;
	}

	captureTimestamp(editor: Editor | null | undefined): boolean {
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

		// This path runs from the media-session (headphone) handler, where there is
		// no editor to surface a failure, so swallowing an error left a button
		// press looking like it did nothing. Report it instead (NT-13).
		try {
			const capture = TimestampTemplateEngine(this.settings.timestamp.template);
			const textToAppend = capture.endsWith("\n") ? capture : `${capture}\n`;
			const file =
				getPodcastNote(this.api.podcast) ??
				(await createPodcastNoteFileIfNotExists(this.api.podcast));
			const content = await this.app.vault.read(file);
			const separator =
				content.length > 0 && !content.endsWith("\n") ? "\n" : "";

			await this.app.vault.modify(
				file,
				`${content}${separator}${textToAppend}`,
			);
			return true;
		} catch (error) {
			console.error(
				"PodNotes: failed to capture timestamp into episode note",
				error,
			);
			new Notice("Failed to capture timestamp into episode note");
			return false;
		}
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
		const mediaSession = window.navigator?.mediaSession;
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
		const mediaSession = window.navigator?.mediaSession;
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
		for (const unsubscribe of this.storeUnsubscribers) unsubscribe();
		this.storeUnsubscribers = [];
		this.volumeUnsubscribe?.();
		this.localFilesMirrorUnsubscribe?.();
		this.views.clear();

		// Intentionally do NOT detach the view's leaves here. Obsidian persists and
		// restores plugin leaves across reloads; detaching in onunload would reset a
		// leaf the user moved (e.g. to the main area) back to its default location on
		// the next load. Obsidian cleans up the leaves of an unloaded view itself.
	}

	private clearLayoutReadyRetry(): void {
		if (!this.layoutReadyRetry) return;

		window.clearTimeout(this.layoutReadyRetry);
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
		// Repair persisted skip lengths so a cleared field (NaN -> null in JSON)
		// can't feed the skip arithmetic and corrupt the playback position (PB-02).
		this.settings.skipBackwardLength = migrateSkipLength(
			this.settings.skipBackwardLength,
			DEFAULT_SETTINGS.skipBackwardLength,
		);
		this.settings.skipForwardLength = migrateSkipLength(
			this.settings.skipForwardLength,
			DEFAULT_SETTINGS.skipForwardLength,
		);
		// Self-heal a corrupt persisted default playback rate so the loaded store
		// and the settings slider both read a clamped value (ST-02).
		this.settings.defaultPlaybackRate = normalizePlaybackRate(
			this.settings.defaultPlaybackRate,
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
		// Backfill a partial/legacy feedNote so a missing template can't crash
		// createFeedNote's `template.replace(...)` (ST-08).
		this.settings.feedNote = migrateFeedNoteSettings(loadedData?.feedNote);
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
