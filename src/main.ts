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
	playbackRate,
	plugin,
	volume,
	subscribeQueueToCurrentEpisode,
} from "src/store";
import { bindStoresToSettings } from "src/store/persistence";
import { registerCommands } from "src/commands";
import { Notice, Platform, Plugin, type Editor, type WorkspaceLeaf } from "obsidian";
import { API } from "src/API/API";
import type { IAPI } from "src/API/IAPI";
import { VIEW_TYPE } from "src/constants";
import { PodNotesSettingsTab } from "src/ui/settings/PodNotesSettingsTab";
import { MainView } from "src/ui/PodcastView";
import type { IPodNotesSettings } from "./types/IPodNotesSettings";
import type { IPodNotes } from "./types/IPodNotes";
import { TimestampTemplateEngine } from "./TemplateEngine";
import { prepareTimestampForInsertion } from "./utility/prepareTimestampInsertion";
import { createPodcastNoteFileIfNotExists, getPodcastNote } from "./createPodcastNote";
import type PartialAppExtension from "./global";
import podNotesURIHandler from "./URIHandler";
import getContextMenuHandler from "./getContextMenuHandler";
import type { IconType } from "./types/IconType";
import { TranscriptionService } from "./services/TranscriptionService";
import { type Unsubscriber } from "svelte/store";
import { normalizePlaybackRate } from "./utility/playbackRate";
import {
	decodePodNotesData,
	encodePodNotesData,
	PODNOTES_DATA_SCHEMA_VERSION,
	PodNotesDataError,
} from "./persistence/podNotesData";
import { CredentialRepository } from "./services/CredentialRepository";

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

interface SaveWaiter {
	resolve: () => void;
	reject: (error: unknown) => void;
}

class PodNotesSchemaMigrationError extends Error {
	constructor(
		public readonly originalCause: unknown,
		public readonly includedCredentials: boolean,
	) {
		super(originalCause instanceof Error ? originalCause.message : String(originalCause));
		this.name = "PodNotesSchemaMigrationError";
	}
}

export default class PodNotes extends Plugin implements IPodNotes {
	public api!: IAPI;
	public override settings!: IPodNotesSettings;
	public override app!: PartialAppExtension;
	public credentials!: CredentialRepository;

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
	private pendingSaveWaiters: SaveWaiter[] = [];
	private saveScheduled = false;
	private saveChain: Promise<void> = Promise.resolve();
	private persistenceUnknownFields: Record<string, unknown> = {};
	private mediaSessionActions: MediaSessionActionName[] = [];

	override async onload() {
		this.isUnloaded = false;
		this.podcastViewMountEnabled = !this.isMobileRuntime();
		plugin.set(this);
		this.credentials = new CredentialRepository(this.app.secretStorage);

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
		volume.set(Math.min(1, Math.max(0, this.settings.defaultVolume ?? 1)));
		playbackRate.set(normalizePlaybackRate(this.settings.defaultPlaybackRate));

		// Mirror every store-backed slice of state into settings, and wire the queue
		// automation that drops the now-playing episode from the up-next queue. Both
		// are store subscriptions tied to the plugin lifetime; onunload disposes them.
		this.storeUnsubscribers.push(bindStoresToSettings(this), subscribeQueueToCurrentEpisode());

		// Keep the Local Files playlist in sync with downloaded episodes (issue #176).
		// downloadedEpisodes is the authoritative offline set, so mirror it into the
		// localFiles playlist that the Podcast grid renders. Svelte's immediate-fire
		// backfills already-downloaded episodes on load; later changes keep it current.
		this.localFilesMirrorUnsubscribe = downloadedEpisodes.subscribe((downloaded) =>
			localFiles.syncWithDownloaded(downloaded),
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
		this.registerEvent(this.app.workspace.on("layout-change", () => this.dedupePlayerLeaves()));

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
				console.error("Failed to initialize PodNotes layout after maximum attempts");
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

	invalidateTranscriptionCredentialCache(): void {
		this.transcriptionService?.clearCredentialCache();
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
			const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";

			await this.app.vault.modify(file, `${content}${separator}${textToAppend}`);
			return true;
		} catch (error) {
			console.error("PodNotes: failed to capture timestamp into episode note", error);
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

	private registerMediaSessionAction(action: MediaSessionActionName, handler: () => void): void {
		const mediaSession = window.navigator?.mediaSession;
		if (!mediaSession?.setActionHandler) {
			return;
		}

		try {
			mediaSession.setActionHandler(action, handler);
			this.mediaSessionActions.push(action);
		} catch (error) {
			console.warn(`PodNotes: Media Session action "${action}" is not supported`, error);
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
		this.transcriptionService?.dispose();
		this.transcriptionService = undefined;
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
		try {
			const decoded = decodePodNotesData(await this.loadData());
			let settings = decoded.settings;
			this.credentials ??= new CredentialRepository(this.app.secretStorage);

			if (
				decoded.sourceVersion < PODNOTES_DATA_SCHEMA_VERSION ||
				decoded.retiredPlaintextPresent
			) {
				// SecretStorage writes are synchronous. Store every legacy value and
				// verify it first, then write the v2 snapshot directly because the normal
				// save queue intentionally stays dormant until onload finishes. A v2 file
				// carrying retired fields is scrubbed without importing their values. If
				// any step fails, the old data.json is left untouched and loading stops.
				try {
					const references =
						decoded.sourceVersion < PODNOTES_DATA_SCHEMA_VERSION
							? this.credentials.storeValues(decoded.legacySecrets)
							: {};
					settings = { ...settings, ...references };
					await this.saveData(encodePodNotesData(settings, decoded.unknownFields));
				} catch (error) {
					throw new PodNotesSchemaMigrationError(
						error,
						Boolean(decoded.legacySecrets.openAI || decoded.legacySecrets.deepgram),
					);
				}
				const migratedProviders = [
					decoded.legacySecrets.openAI ? "OpenAI" : null,
					decoded.legacySecrets.deepgram ? "Deepgram" : null,
				].filter((provider): provider is string => provider !== null);
				if (migratedProviders.length > 0) {
					new Notice(
						`Moved your ${migratedProviders.join(" and ")} API ${migratedProviders.length === 1 ? "key" : "keys"} into Obsidian SecretStorage.`,
					);
				}
			}

			this.settings = settings;
			this.persistenceUnknownFields = decoded.unknownFields;

			if (decoded.warnings.length > 0) {
				console.warn("PodNotes repaired invalid persisted values:", decoded.warnings);
			}
		} catch (error) {
			if (error instanceof PodNotesDataError) {
				new Notice(error.message, 0);
				console.error("PodNotes refused to load unsafe persisted data", error);
			} else if (error instanceof PodNotesSchemaMigrationError) {
				new Notice(
					error.includedCredentials
						? "PodNotes could not securely migrate its API keys. Your existing data was kept unchanged. Restart PodNotes to retry."
						: "PodNotes could not upgrade its settings data. Your existing data was kept unchanged. Restart PodNotes to retry.",
					0,
				);
				console.error("PodNotes failed to migrate persisted settings", error.originalCause);
			}
			throw error;
		}
	}

	saveSettings(): Promise<void> {
		return this.requestSettingsSave().catch(() => undefined);
	}

	/** Awaitable save for migrations/imports that must not report success on failure. */
	saveSettingsStrict(): Promise<void> {
		return this.requestSettingsSave();
	}

	private requestSettingsSave(): Promise<void> {
		if (!this.isReady) return Promise.resolve();

		try {
			this.pendingSave = this.cloneSettings();
		} catch (error) {
			console.error("PodNotes: failed to snapshot settings", error);
			const failure = Promise.reject<void>(error);
			void failure.catch(() => undefined);
			return failure;
		}

		const completion = new Promise<void>((resolve, reject) => {
			this.pendingSaveWaiters.push({ resolve, reject });
		});
		// Attach a handler so even a mistakenly ignored strict save cannot become an
		// unhandled rejection. Awaiting the original promise still receives failure.
		void completion.catch(() => undefined);

		if (!this.saveScheduled) {
			this.saveScheduled = true;
			this.saveChain = this.runSaveLoop();
		}

		return completion;
	}

	private async runSaveLoop(): Promise<void> {
		try {
			while (this.pendingSave) {
				const snapshot = this.pendingSave;
				const waiters = this.pendingSaveWaiters;
				this.pendingSave = null;
				this.pendingSaveWaiters = [];

				try {
					await this.saveData(
						encodePodNotesData(snapshot, this.persistenceUnknownFields),
					);
					for (const waiter of waiters) waiter.resolve();
				} catch (error) {
					console.error("PodNotes: failed to save settings", error);
					for (const waiter of waiters) waiter.reject(error);
				}
			}
		} finally {
			// No await occurs between the loop's empty check and this assignment, so a
			// request cannot land in a gap where it sees a scheduled loop that has
			// already decided to exit.
			this.saveScheduled = false;
		}
	}

	private cloneSettings(): IPodNotesSettings {
		// structuredClone is available in Obsidian's Electron runtime; fallback for safety.
		if (typeof structuredClone === "function") {
			return structuredClone(this.settings);
		}

		return JSON.parse(JSON.stringify(this.settings)) as IPodNotesSettings;
	}
}
