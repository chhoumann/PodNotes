import {
	downloadedEpisodes,
	episodeListLimit,
	favorites,
	localFiles,
	playedEpisodes,
	playlists,
	queue,
	savedFeeds,
	hidePlayedEpisodes,
	plugin,
} from "src/store";
import { bindStoresToSettings } from "src/store/persistence";
import { registerCommands } from "src/commands";
import { normalizePath, Notice, Platform, Plugin, type Editor, type WorkspaceLeaf } from "obsidian";
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
import getVaultRenameHandler from "./getVaultRenameHandler";
import { TranscriptionService } from "./services/TranscriptionService";
import type { Unsubscriber } from "svelte/store";
import { PlayerController } from "./player/PlayerController";
import { bindMediaSession } from "./player/mediaSession";
import {
	decodePodNotesData,
	encodePodNotesData,
	PODNOTES_DATA_SCHEMA_VERSION,
	newLibraryId,
	PodNotesDataError,
	toDocument,
	type PersistedPodNotesDataV2,
} from "./persistence/podNotesData";
import { jsonValuesEqual, restoreDropped } from "./persistence/merge";
import {
	type Clock,
	type DataFileAccess,
	DataFileWriter,
	WriteRefusedError,
} from "./persistence/writer";
import { CredentialRepository } from "./services/CredentialRepository";
import { FeedUrlRepository } from "./services/FeedUrlRepository";
import { protectPrivateFeeds, resolveFeedUrl } from "./services/privateFeeds";
import { FeedRepository, loadFeed } from "./services/FeedRepository";

type WriteRefusal =
	| "unreadable-data-file"
	| "older-data-file"
	| "window-unloading"
	| "obsidian-closing";

const WRITE_REFUSALS: Record<WriteRefusal, string> = {
	"unreadable-data-file": "PodNotes does not save over a data.json it could not read.",
	"older-data-file": "PodNotes does not save over a data.json from an older version.",
	"window-unloading": "PodNotes does not start a save while the window unloads.",
	"obsidian-closing": "PodNotes does not start a save while Obsidian closes.",
};

// Saves run on the main window's timers: a popout's timers stop when it closes.
const MAIN_WINDOW_CLOCK: Clock = {
	setTimeout: (callback, ms) => window.setTimeout(callback, ms),
	clearTimeout: (id) => window.clearTimeout(id),
	now: () => window.performance.now(),
};

/** Whether data.json's text holds this data. */
function holdsData(text: string, data: unknown): boolean {
	try {
		return jsonValuesEqual(JSON.parse(text), JSON.parse(JSON.stringify(data)));
	} catch {
		return false;
	}
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
	public feedUrls!: FeedUrlRepository;
	public player!: PlayerController;
	public feeds!: FeedRepository;

	private views = new Set<MainView>();

	// Store subscriptions tied to the plugin lifetime. Disposed together in onunload.
	private storeUnsubscribers: Unsubscriber[] = [];
	private transcriptionService?: TranscriptionService;
	private localFilesMirrorUnsubscribe?: Unsubscriber;
	private closeRenames?: () => void;

	private maxLayoutReadyAttempts = 10;
	private layoutReadyAttempts = 0;
	// window.setTimeout returns a number in the browser/Electron renderer.
	private layoutReadyRetry: number | null = null;
	private isUnloaded = false;
	private podcastViewMountEnabled = true;
	private isReady = false;
	// Why data.json must not be written, or null while writes are allowed. Set when the
	// file exists but could not be read (a sync client's half-written copy, or one a
	// reload cut off), when an older version's copy replaced it, and when the window
	// starts unloading or Obsidian quits: a write started then is cut off after it
	// truncates the file, which leaves data.json empty.
	private writeRefusal: WriteRefusal | null = null;
	// The data.json write in progress, settled either way, or null. Writes never overlap.
	private writeInFlight: Promise<void> | null = null;
	// Every save after load, and every change synced in from elsewhere, goes through it.
	private writer: DataFileWriter<PersistedPodNotesDataV2> | null = null;
	private refusalNotice: Notice | null = null;
	private persistenceUnknownFields: Record<string, unknown> = {};

	override async onload() {
		this.isUnloaded = false;
		this.podcastViewMountEnabled = !this.isMobileRuntime();
		this.registerDomEvent(window, "pagehide", () => {
			this.writeRefusal = "window-unloading";
		});
		// Obsidian closes the window once its quit tasks settle, so start no write after
		// quit and let a write in flight finish first. A reload fires no quit; pagehide
		// covers it. A rejected quit task would stall the close until Obsidian forces it.
		this.registerEvent(
			this.app.workspace.on("quit", (tasks) => {
				this.writeRefusal = "obsidian-closing";
				if (this.writeInFlight) tasks.addPromise(this.writeInFlight);
			}),
		);
		plugin.set(this);
		this.credentials = new CredentialRepository(this.app.secretStorage);
		this.feedUrls = new FeedUrlRepository(this.app.secretStorage);
		this.feeds = new FeedRepository({
			load: loadFeed,
			resolveUrl: (feed) => resolveFeedUrl(feed, this.feedUrls),
			storage: this.app,
			cache: () => this.settings.feedCache,
			now: Date.now,
		});

		await this.loadSettings();
		this.writer = this.createWriter(MAIN_WINDOW_CLOCK);

		this.setCollectionStores();
		// The media lives in the main window, so playback outlasts the view and popouts.
		const mainDocument = window.document;
		this.player = new PlayerController(mainDocument, this);
		this.player.restore(this.settings.currentEpisode);
		// A phone can kill the app once it is in the background, with no event first.
		// The main window's document: the app, not a popout, goes to the background.
		this.registerDomEvent(mainDocument, "visibilitychange", () => {
			if (mainDocument.visibilityState !== "hidden") return;
			this.player.save();
			void this.flushSaves();
		});

		// Mirror every store-backed slice of state into settings, and keep the feed
		// repository's subscriptions current. The subscriptions are tied to the plugin
		// lifetime; onunload disposes them.
		this.storeUnsubscribers.push(
			bindStoresToSettings(this),
			savedFeeds.subscribe((feeds) => this.feeds.setSubscriptions(feeds)),
		);

		// Keep the Local Files playlist in sync with downloaded episodes (issue #176).
		// downloadedEpisodes is the authoritative offline set, so mirror it into the
		// localFiles playlist that the Podcast grid renders. Svelte's immediate-fire
		// backfills already-downloaded episodes on load; later changes keep it current.
		this.localFilesMirrorUnsubscribe = downloadedEpisodes.subscribe((downloaded) =>
			localFiles.syncWithDownloaded(downloaded),
		);

		this.api = new API();

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
		this.addRibbonIcon("podcast", "Show PodNotes", () => {
			void this.activateView();
		});

		this.app.workspace.onLayoutReady(this.onLayoutReady.bind(this));

		this.registerObsidianProtocolHandler("podnotes", (action) =>
			podNotesURIHandler(action, () => this.activateView()),
		);

		this.registerEvent(getContextMenuHandler(this.app));
		const renames = getVaultRenameHandler(this);
		this.registerEvent(renames.eventRef);
		this.closeRenames = renames.close;
		this.storeUnsubscribers.push(
			bindMediaSession(this.player, {
				mediaSession: window.navigator.mediaSession,
				MediaMetadata: window.MediaMetadata,
				captureTimestamp: () => void this.captureTimestampFromMediaSession(),
				skipBackward: () => this.api.skipBackward(),
				skipForward: () => this.api.skipForward(),
			}),
		);
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

	override onunload() {
		// While the player and the store bindings still save what a rename changes.
		this.closeRenames?.();
		this.isUnloaded = true;
		// The refusal ends with this instance; the next one reads the file itself.
		this.refusalNotice?.hide();
		// Before the store bindings are disposed, so the position it saves reaches the writer.
		this.player?.dispose();
		void this.writer?.unload();
		this.clearLayoutReadyRetry();
		for (const unsubscribe of this.storeUnsubscribers) unsubscribe();
		this.storeUnsubscribers = [];
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
			const data: unknown = await this.loadData();
			// loadData resolves nullish both for a missing file and for one it could
			// not read or parse.
			if (data == null && !(await this.dataFileHoldsNothing())) {
				this.settings = decodePodNotesData(undefined).settings;
				this.persistenceUnknownFields = { libraryId: newLibraryId() };
				this.refuseSaves(
					"unreadable-data-file",
					`PodNotes could not read ${this.dataFilePath()}, so it left the file unchanged and started with default settings. Nothing is saved until the file can be read again, or until you delete it and restart Obsidian.`,
				);
				console.error(
					`PodNotes could not read ${this.dataFilePath()} and will not save over it`,
				);
				return;
			}

			const decoded = decodePodNotesData(data);
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
					await this.writeDataFile(encodePodNotesData(settings, decoded.unknownFields));
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

			// Private feed URLs: move credential-bearing subscription URLs out of
			// data.json into SecretStorage, scrub the same URLs out of persisted
			// episode snapshots (queue/favorites/playlists/downloads/history stamp
			// url/feedUrl at fetch time), then reap feed-url secrets no saved feed
			// references anymore (e.g. after a settings import replaced savedFeeds).
			// Best-effort: a failure keeps that feed's URL where it was, is
			// reported, and never breaks loading.
			this.feedUrls ??= new FeedUrlRepository(this.app.secretStorage);
			const feedMigration = protectPrivateFeeds(settings, this.feedUrls);
			if (feedMigration.settings !== settings) {
				settings = feedMigration.settings;
				await this.writeDataFile(encodePodNotesData(settings, decoded.unknownFields));
				if (feedMigration.failed.length === 0) {
					new Notice("Moved private feed URLs out of data.json.");
				}
			}
			if (feedMigration.failed.length > 0) {
				new Notice(
					`PodNotes could not protect the private feed ${feedMigration.failed.length === 1 ? "URL" : "URLs"} for ${feedMigration.failed.join(", ")}; ${feedMigration.failed.length === 1 ? "it stays" : "they stay"} in data.json for now. Restart PodNotes to retry.`,
					0,
				);
			}
			this.feedUrls.sweepOrphans(settings.savedFeeds);

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
		if (!this.isReady) return Promise.resolve();
		if (!this.writeRefusal) this.writer?.request();
		else if (this.writeRefusal === "unreadable-data-file") this.writer?.retryPending();
		return Promise.resolve();
	}

	/** Awaitable save for migrations/imports that must not report success on failure. */
	saveSettingsStrict(): Promise<void> {
		if (!this.isReady || !this.writer) return Promise.resolve();
		if (this.writeRefusal) return Promise.reject(new Error(WRITE_REFUSALS[this.writeRefusal]));
		return this.writer.save();
	}

	/** Store changes made in `update` are playback progress: they save at most every 10 s. */
	checkpoint(update: () => void): void {
		if (this.writer) this.writer.checkpoint(update);
		else update();
	}

	/** Write what is not saved yet now. Never rejects. */
	flushSaves(): Promise<void> {
		// A refused write would only fail again.
		if (this.writeRefusal) return Promise.resolve();
		return this.writer?.flush() ?? Promise.resolve();
	}

	override async onExternalSettingsChange(): Promise<void> {
		if (!this.writer) return;
		await this.writer.onExternalChange();
	}

	/** The file can be taken as it is again: saves resume. */
	private liftUnreadableRefusal(): void {
		if (this.writeRefusal !== "unreadable-data-file") return;
		this.writeRefusal = null;
		this.refusalNotice?.hide();
		this.refusalNotice = null;
	}

	/** No save until `refusal` lifts, if it does, with a Notice saying why. */
	private refuseSaves(
		refusal: "unreadable-data-file" | "older-data-file",
		message: string,
	): void {
		// Closing refusals never lift; this one would.
		if (
			this.isUnloaded ||
			this.writeRefusal === "window-unloading" ||
			this.writeRefusal === "obsidian-closing"
		) {
			return;
		}
		if (this.writeRefusal === refusal) return;
		this.writeRefusal = refusal;
		this.refusalNotice?.hide();
		this.refusalNotice = new Notice(message, 0);
	}

	private createWriter(clock: Clock): DataFileWriter<PersistedPodNotesDataV2> {
		return new DataFileWriter(
			this.dataFileAccess(),
			clock,
			this.writeRefusal ? null : this.localDocument(),
			() => new Notice("PodNotes could not save your changes."),
		);
	}

	private localDocument(): PersistedPodNotesDataV2 {
		return toDocument(this.settings, this.persistenceUnknownFields);
	}

	private dataFileAccess(): DataFileAccess<PersistedPodNotesDataV2> {
		return {
			read: async (base) => {
				const data: unknown = await this.loadData();
				const path = this.dataFilePath();
				if (data == null) {
					if (await this.dataFileHoldsNothing()) {
						this.liftUnreadableRefusal();
						return null;
					}
					this.refuseSaves(
						"unreadable-data-file",
						`PodNotes could not read ${path}, so it leaves the file unchanged and saves nothing until the file can be read again.`,
					);
					throw new Error(`PodNotes could not read ${path}`);
				}
				const decoded = decodePodNotesData(data);
				// Only startup moves an older file's API keys into SecretStorage; a save now
				// would drop them.
				if (decoded.sourceVersion !== PODNOTES_DATA_SCHEMA_VERSION) {
					this.refuseSaves(
						"older-data-file",
						`${path} was replaced by a copy from an older version of PodNotes, likely synced from another device. PodNotes saves nothing until you restart Obsidian, which updates the file and keeps its API keys.`,
					);
					throw new Error(WRITE_REFUSALS["older-data-file"]);
				}
				// With nothing loaded, an entry the codec drops has nothing to be kept from.
				if (!base && decoded.changed) {
					throw new Error(`PodNotes could not read ${path} without repairing it`);
				}
				this.liftUnreadableRefusal();
				// A private feed synced here raw is protected before it can be merged and written.
				const doc: Record<string, unknown> = toDocument(
					protectPrivateFeeds(decoded.settings, this.feedUrls).settings,
					decoded.unknownFields,
				);
				// An entry the codec dropped while repairing a value (an invalid episode, a
				// collection reset) is not a deletion on the other device. Keep it.
				const raw = data as Record<string, unknown>;
				for (const [key, value] of Object.entries(base ?? {})) {
					if (!jsonValuesEqual(raw[key], doc[key])) {
						doc[key] = restoreDropped(value, doc[key], raw[key], [key]);
					}
				}
				return doc as PersistedPodNotesDataV2;
			},
			write: (doc) => this.writeDataFile(doc),
			local: () => this.localDocument(),
			publish: (doc) => this.publishDocument(doc),
		};
	}

	/** The stores of the persisted collections, from settings. The player's state is not one. */
	private setCollectionStores(): void {
		// Before downloads: their mirror rebuilds Local Files from this store's playlist.
		localFiles.set(this.settings.localFiles);
		playedEpisodes.set(this.settings.playedEpisodes);
		savedFeeds.set(this.settings.savedFeeds);
		playlists.set(this.settings.playlists);
		queue.set(this.settings.queue);
		favorites.set(this.settings.favorites);
		downloadedEpisodes.set(this.settings.downloadedEpisodes);
		hidePlayedEpisodes.set(this.settings.hidePlayedEpisodes);
		episodeListLimit.set(this.settings.episodeListLimit);
	}

	private publishDocument(doc: PersistedPodNotesDataV2): void {
		const decoded = decodePodNotesData(doc);
		// In place, so code that holds plugin.settings across a save (an import) sees the
		// merge.
		const settings = this.settings as unknown as Record<string, unknown>;
		for (const key of Object.keys(settings)) delete settings[key];
		Object.assign(settings, decoded.settings);
		this.persistenceUnknownFields = decoded.unknownFields;
		this.setCollectionStores();
		// A sync can land after startup, before anything loads. The restored episode
		// follows it, and loaded media stays as it is.
		this.player?.restore(this.settings.currentEpisode);
	}

	// Every data.json write goes through here, so no path can write while writes are refused.
	/**
	 * No data.json, or an empty one, as a write cut off on a full disk leaves: nothing
	 * to lose. False when the file cannot be checked.
	 */
	private async dataFileHoldsNothing(): Promise<boolean> {
		const path = this.dataFilePath();
		const { adapter } = this.app.vault;
		try {
			return !(await adapter.exists(path)) || (await adapter.read(path)) === "";
		} catch {
			return false;
		}
	}

	private async writeDataFile(data: unknown): Promise<void> {
		if (this.writeRefusal) throw new WriteRefusedError(WRITE_REFUSALS[this.writeRefusal]);
		const write = this.saveData(data);
		this.writeInFlight = write.catch(() => undefined);
		try {
			await write;
		} finally {
			this.writeInFlight = null;
		}
		// saveData resolves even when the write failed (Obsidian's writeJson swallows the
		// error), so read the file back.
		const text = await this.app.vault.adapter.read(this.dataFilePath()).catch(() => null);
		if (text === null || !holdsData(text, data)) {
			throw new Error(`PodNotes could not write ${this.dataFilePath()}.`);
		}
	}

	private dataFilePath(): string {
		return normalizePath(`${this.manifest.dir}/data.json`);
	}
}
