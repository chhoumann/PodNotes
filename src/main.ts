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
import { normalizePath, Notice, Platform, Plugin, type WorkspaceLeaf } from "obsidian";
import { API } from "src/API/API";
import type { IAPI } from "src/API/IAPI";
import { VIEW_TYPE } from "src/constants";
import { PodNotesSettingsTab } from "src/ui/settings/PodNotesSettingsTab";
import { MainView } from "src/ui/PodcastView";
import { Navigation } from "src/ui/PodcastView/Navigation";
import { dismissUndoNotices } from "src/ui/undoNotice";
import { removePreviousStyles } from "src/ui/removePreviousStyles";
import type { IPodNotesSettings } from "./types/IPodNotesSettings";
import type { IPodNotes } from "./types/IPodNotes";
import type PartialAppExtension from "./global";
import podNotesURIHandler from "./URIHandler";
import getContextMenuHandler from "./getContextMenuHandler";
import getVaultRenameHandler from "./getVaultRenameHandler";
import { TranscriptionService } from "./services/TranscriptionService";
import { CaptureService } from "./services/CaptureService";
import { get, type Readable, type Unsubscriber } from "svelte/store";
import { PlayerController } from "./player/PlayerController";
import { bindMediaSession } from "./player/mediaSession";
import {
	decodePodNotesData,
	type DecodedPodNotesData,
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
	type ReadOutcome,
	type Refusal,
	type WriteOutcome,
	WriteRefusedError,
} from "./persistence/writer";
import { CredentialRepository } from "./services/CredentialRepository";
import { FeedUrlRepository } from "./services/FeedUrlRepository";
import { privateFeedAddresses, protectPrivateFeeds, resolveFeedUrl } from "./services/privateFeeds";
import { redactPrivateFeedAddresses } from "./utility/privateFeedUrl";
import { FeedRepository, loadFeed } from "./services/FeedRepository";
import { fetchChapters } from "./utility/fetchChapters";
import { onlineStatus } from "./services/online";

type Closing = "window-unloading" | "obsidian-closing";

const CLOSING_REFUSALS: Record<Closing, string> = {
	"window-unloading": "PodNotes does not start a save while the window unloads.",
	"obsidian-closing": "PodNotes does not start a save while Obsidian closes.",
};

// Saves run on the main window's timers: a popout's timers stop when it closes.
const MAIN_WINDOW_CLOCK: Clock = {
	setTimeout: (callback, ms) => window.setTimeout(callback, ms),
	clearTimeout: (id) => window.clearTimeout(id),
	now: () => window.performance.now(),
};

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
	public capture!: CaptureService;
	public navigation!: Navigation;
	public online!: Readable<boolean>;

	private views = new Set<MainView>();

	// Store subscriptions tied to the plugin lifetime. Disposed together in onunload.
	private storeUnsubscribers: Unsubscriber[] = [];
	private transcriptionService?: TranscriptionService;
	private localFilesMirrorUnsubscribe?: Unsubscriber;
	private closeRenames?: () => void;

	private isUnloaded = false;
	private freshInstall = false;
	private podcastViewMountEnabled = true;
	private isReady = false;
	// Set once the window starts unloading or Obsidian quits: a write started then is
	// cut off after it truncates the file, which leaves data.json empty.
	private closing: Closing | null = null;
	private startupRefusal: Refusal | null = null;
	// The data.json write in progress, settled either way, or null. Writes never overlap.
	private writeInFlight: Promise<void> | null = null;
	// Every save after load, and every change synced in from elsewhere, goes through it.
	private writer: DataFileWriter<PersistedPodNotesDataV2> | null = null;
	private refusalNotice: Notice | null = null;
	private persistenceUnknownFields: Record<string, unknown> = {};

	override async onload() {
		// Before registerView, where the views Obsidian restores mount and append their sheets.
		removePreviousStyles(this.app.workspace);
		this.isUnloaded = false;
		this.podcastViewMountEnabled = !this.isMobileRuntime();
		this.registerDomEvent(window, "pagehide", () => {
			this.closing = "window-unloading";
		});
		// Obsidian closes the window once its quit tasks settle, so start no write after
		// quit and let a write in flight finish first. A reload fires no quit; pagehide
		// covers it. A rejected quit task would stall the close until Obsidian forces it.
		this.registerEvent(
			this.app.workspace.on("quit", (tasks) => {
				this.closing = "obsidian-closing";
				if (this.writeInFlight) tasks.addPromise(this.writeInFlight);
			}),
		);
		plugin.set(this);
		this.online = onlineStatus(window);
		this.credentials = new CredentialRepository(this.app.secretStorage);
		this.feedUrls = new FeedUrlRepository(this.app.secretStorage);
		this.feeds = new FeedRepository({
			load: loadFeed,
			resolveUrl: (feed) => resolveFeedUrl(feed, this.feedUrls),
			storage: this.app,
			now: Date.now,
		});

		await this.loadSettings();
		this.writer = this.createWriter(MAIN_WINDOW_CLOCK);
		// Obsidian calls onExternalSettingsChange only when data.json's modified time is later
		// than PodNotes' last save. A sync client can keep the other device's earlier time, and
		// a write right after a save can round to the same millisecond, so the writer checks
		// every change Obsidian sees to the file, and once for a change made while it loaded.
		const dataFile = this.dataFilePath();
		const writer = this.writer;
		this.registerEvent(
			this.app.vault.on("raw", (path) => {
				if (path === dataFile) writer.report();
			}),
		);
		writer.report();

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
		// localFiles playlist that the Local files page renders. Svelte's immediate-fire
		// backfills already-downloaded episodes on load; later changes keep it current.
		this.localFilesMirrorUnsubscribe = downloadedEpisodes.subscribe((downloaded) =>
			localFiles.syncWithDownloaded(downloaded),
		);

		this.api = new API();
		this.capture = new CaptureService(this);

		// All user-facing commands live in src/commands.ts; this keeps onload
		// focused on lifecycle wiring (stores, view, ribbon, protocol, media session).
		registerCommands(this);

		this.addSettingTab(new PodNotesSettingsTab(this.app, this));

		this.navigation = new Navigation();
		this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => {
			const view = new MainView(leaf, this);
			this.views.add(view);
			return view;
		});

		// PodNotes is a single-instance view, and onunload deliberately does NOT
		// detach its leaves (detaching there would reset a leaf the user moved back
		// to its default location on the next load). The trade-off is a hot reload
		// (toggling the plugin) can briefly leave both the restored leaf and one
		// opened before it came back, so collapse any duplicates back to a single leaf
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
			podNotesURIHandler(action, () => this.showPlayer()),
		);

		this.registerEvent(getContextMenuHandler(this.app));
		const renames = getVaultRenameHandler(this);
		this.registerEvent(renames.eventRef);
		this.closeRenames = renames.close;
		this.storeUnsubscribers.push(
			bindMediaSession(this.player, {
				mediaSession: window.navigator.mediaSession,
				MediaMetadata: window.MediaMetadata,
				settings: () => this.settings,
				captureTimestamp: () => void this.capture.timestamp(),
				skipBackward: () => this.api.skipBackward(),
				skipForward: () => this.api.skipForward(),
				chapters: fetchChapters,
			}),
		);
		this.isReady = true;
	}

	// A new install meets the view once. After that PodNotes keeps the layout the
	// user left, on desktop and mobile alike.
	onLayoutReady(): void {
		if (this.isUnloaded || !this.freshInstall) return;

		this.activateView().catch((error) => {
			console.error("PodNotes: failed to initialize startup view", error);
		});
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

	/**
	 * Reveals the view, with the full player open when an episode is loaded. Works
	 * while no view exists.
	 */
	async showPlayer(): Promise<void> {
		if (get(this.player.state).status !== "empty") this.navigation.expand();
		await this.activateView();
	}

	openSettingsTab(): void {
		this.app.setting.open();
		this.app.setting.openTabById(this.manifest.id);
	}

	/** The one writer of the auto-queue preference, for the settings tab and the Queue page. */
	setAutoQueue(enabled: boolean): void {
		if (this.settings.autoQueue === enabled) return;
		this.settings.autoQueue = enabled;
		// Views read settings through the plugin store, so it must tell them.
		plugin.set(this);
		void this.saveSettings();
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

	// Public so the command registrations in src/commands.ts can reach it.
	getTranscriptionService(): TranscriptionService {
		if (!this.transcriptionService) {
			this.transcriptionService = new TranscriptionService(this);
		}

		return this.transcriptionService;
	}

	override onunload() {
		// While the player and the store bindings still save what a rename changes.
		this.closeRenames?.();
		this.isUnloaded = true;
		// The refusal ends with this instance; the next one reads the file itself.
		this.refusalNotice?.hide();
		this.capture?.dispose();
		dismissUndoNotices();
		// Before the store bindings are disposed, so the position it saves reaches the writer.
		this.player?.dispose();
		void this.writer?.unload();
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

	async loadSettings() {
		try {
			const data: unknown = await this.loadData();
			// loadData resolves nullish both for a missing file and for one it could
			// not read or parse.
			if (data == null && !(await this.dataFileHoldsNothing())) {
				this.settings = decodePodNotesData(undefined).settings;
				this.persistenceUnknownFields = { libraryId: newLibraryId() };
				this.startupRefusal = {
					recovery: "retry",
					message: `PodNotes could not read ${this.dataFilePath()}, so it left the file unchanged and started with default settings. Nothing is saved until you restore read access to the file and restart Obsidian.`,
				};
				this.showRefusal(this.startupRefusal);
				console.error(
					`PodNotes could not read ${this.dataFilePath()} and will not save over it`,
				);
				return;
			}
			this.freshInstall = data == null;

			const decoded = decodePodNotesData(data);
			this.credentials ??= new CredentialRepository(this.app.secretStorage);
			this.feedUrls ??= new FeedUrlRepository(this.app.secretStorage);

			const feedProtection = protectPrivateFeeds(decoded.settings, this.feedUrls);
			let settings = feedProtection.settings;
			const movedFeeds = settings !== decoded.settings;

			if (
				decoded.sourceVersion < PODNOTES_DATA_SCHEMA_VERSION ||
				decoded.retiredPlaintextPresent ||
				movedFeeds
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
					const addresses = privateFeedAddresses(settings.savedFeeds, this.feedUrls);
					const written = await this.writeProtectedDataFile(
						encodePodNotesData(settings, decoded.unknownFields, addresses),
						addresses,
					);
					if (written.kind !== "verified") throw this.writeFailure();
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
				if (movedFeeds && feedProtection.failed.length === 0) {
					new Notice("Moved private feed URLs out of data.json.");
				}
			}

			this.feedUrls.sweepOrphans(data, settings);

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
		if (this.isReady && !this.closing) this.writer?.request();
		return Promise.resolve();
	}

	/** Awaitable save for migrations/imports that must not report success on failure. */
	saveSettingsStrict(): Promise<void> {
		if (!this.isReady || !this.writer) return Promise.resolve();
		if (this.closing) return Promise.reject(new Error(CLOSING_REFUSALS[this.closing]));
		return this.writer.save();
	}

	/** Store changes made in `update` are playback progress: they save at most every 10 s. */
	checkpoint(update: () => void): void {
		if (this.writer) this.writer.checkpoint(update);
		else update();
	}

	/** Write what is not saved yet now. Never rejects. */
	flushSaves(): Promise<void> {
		if (this.closing) return Promise.resolve();
		return this.writer?.flush() ?? Promise.resolve();
	}

	// Obsidian refreshes an open settings tab once this resolves.
	override async onExternalSettingsChange(): Promise<void> {
		if (!this.writer) return;
		await this.writer.onExternalChange();
	}

	private showRefusal(refusal: Refusal | null): void {
		this.refusalNotice?.hide();
		this.refusalNotice =
			refusal && !this.isUnloaded && !this.closing ? new Notice(refusal.message, 0) : null;
	}

	private createWriter(clock: Clock): DataFileWriter<PersistedPodNotesDataV2> {
		return new DataFileWriter<PersistedPodNotesDataV2>(
			this.dataFileAccess(),
			clock,
			this.startupRefusal
				? { base: null, refusal: this.startupRefusal }
				: { base: this.localDocument() },
			{
				onRefusal: (refusal) => this.showRefusal(refusal),
				onWriteFailed: () => new Notice("PodNotes could not save your changes."),
			},
		);
	}

	private localDocument(): PersistedPodNotesDataV2 {
		return toDocument(
			this.settings,
			this.persistenceUnknownFields,
			privateFeedAddresses(this.settings.savedFeeds, this.feedUrls),
		);
	}

	private dataFileAccess(): DataFileAccess<PersistedPodNotesDataV2> {
		// The file as found, before decoding protects or repairs it. A readback still equal
		// to it means the write did not land.
		let lastRead: unknown;
		return {
			read: async (base): Promise<ReadOutcome<PersistedPodNotesDataV2>> => {
				const data: unknown = await this.loadData();
				lastRead = data;
				if (base && jsonValuesEqual(data, base))
					return { kind: "file", doc: structuredClone(base) };
				return this.decodeDataFile(data, base);
			},
			write: async (doc) => {
				const written = await this.writeProtectedDataFile(
					doc,
					privateFeedAddresses(this.settings.savedFeeds, this.feedUrls),
				);
				if (written.kind === "verified") return written;
				if (jsonValuesEqual(written.doc, lastRead)) throw this.writeFailure();
				// Without a base, a file that needs a repair is unreadable, so a damaged file
				// never passes for one another writer saved.
				const read = await this.decodeDataFile(written.doc, null);
				if (read.kind !== "file") throw this.writeFailure();
				return {
					kind: "different",
					doc: read.doc,
					rewrite: !jsonValuesEqual(read.doc, written.doc),
				};
			},
			local: () => this.localDocument(),
			publish: (doc) => this.publishDocument(doc),
		};
	}

	private async decodeDataFile(
		data: unknown,
		base: PersistedPodNotesDataV2 | null,
	): Promise<ReadOutcome<PersistedPodNotesDataV2>> {
		const path = this.dataFilePath();
		const unreadable: ReadOutcome<PersistedPodNotesDataV2> = {
			kind: "refused",
			refusal: {
				recovery: "retry",
				message: `PodNotes could not read ${path}, so it leaves the file unchanged. It tries again automatically and saves your changes once the file can be read.`,
			},
		};
		if (data == null) {
			return (await this.dataFileHoldsNothing()) ? { kind: "missing" } : unreadable;
		}
		let decoded: DecodedPodNotesData;
		try {
			decoded = decodePodNotesData(data);
		} catch (error) {
			if (!(error instanceof PodNotesDataError)) throw error;
			if (error.code === "invalid-data") return unreadable;
			return {
				kind: "refused",
				refusal: {
					recovery: "stop",
					message: `${path} was written by a newer version of PodNotes, likely synced from another device. PodNotes saves nothing until you update PodNotes.`,
				},
			};
		}
		// Only startup moves an older file's API keys into SecretStorage; a save now
		// would drop them.
		if (decoded.sourceVersion !== PODNOTES_DATA_SCHEMA_VERSION) {
			return {
				kind: "refused",
				refusal: {
					recovery: "stop",
					message: `${path} was replaced by a copy from an older version of PodNotes, likely synced from another device. PodNotes saves nothing until you restart Obsidian, which updates the file and keeps its API keys.`,
				},
			};
		}
		// With nothing loaded, an entry the codec drops has nothing to be kept from.
		if (!base && decoded.changed) return unreadable;
		// A private feed synced here raw is protected before it can be merged and written.
		const protection = protectPrivateFeeds(decoded.settings, this.feedUrls);
		const addresses = new Map([
			...privateFeedAddresses(protection.settings.savedFeeds, this.feedUrls),
			...privateFeedAddresses(this.settings.savedFeeds, this.feedUrls),
		]);
		const doc: Record<string, unknown> = toDocument(
			protection.settings,
			decoded.unknownFields,
			addresses,
		);
		// An entry the codec dropped while repairing a value (an invalid episode, a
		// collection reset) is not a deletion on the other device. Keep it.
		const raw = data as Record<string, unknown>;
		let restored = false;
		for (const [key, value] of Object.entries(base ?? {})) {
			if (jsonValuesEqual(raw[key], doc[key])) continue;
			const kept = restoreDropped(value, doc[key], raw[key], [key]);
			if (jsonValuesEqual(kept, doc[key])) continue;
			doc[key] = kept;
			restored = true;
		}
		// toDocument redacted the rest. A restored entry can quote a private address,
		// or name a private feed whose address other fields quote.
		return {
			kind: "file",
			doc: (restored
				? redactPrivateFeedAddresses(doc, addresses)
				: doc) as PersistedPodNotesDataV2,
			rewrite: redactPrivateFeedAddresses(data, addresses) !== data,
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
		this.player?.restore(this.settings.currentEpisode);
	}

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

	private async writeProtectedDataFile(
		data: unknown,
		privateFeedAddresses: ReadonlyMap<string, string>,
	): Promise<WriteOutcome<unknown>> {
		if (this.closing) throw new WriteRefusedError(CLOSING_REFUSALS[this.closing]);
		if (redactPrivateFeedAddresses(data, privateFeedAddresses) !== data) {
			throw new Error("PodNotes does not write a private feed URL to data.json.");
		}
		const write = this.saveData(data);
		this.writeInFlight = write.catch(() => undefined);
		try {
			await write;
		} finally {
			this.writeInFlight = null;
		}
		// saveData resolves even when the write failed (Obsidian's writeJson swallows the
		// error), so read the file back.
		let found: unknown;
		try {
			found = JSON.parse(await this.app.vault.adapter.read(this.dataFilePath()));
		} catch {
			throw this.writeFailure();
		}
		return jsonValuesEqual(found, JSON.parse(JSON.stringify(data)))
			? { kind: "verified" }
			: { kind: "different", doc: found };
	}

	private writeFailure(): Error {
		return new Error(`PodNotes could not write ${this.dataFilePath()}.`);
	}

	private dataFilePath(): string {
		return normalizePath(`${this.manifest.dir}/data.json`);
	}
}
