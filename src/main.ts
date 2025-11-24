import {
	currentEpisode,
	downloadedEpisodes,
	favorites,
	localFiles,
	playedEpisodes,
	playlists,
	queue,
	savedFeeds,
	hidePlayedEpisodes,
	volume,
} from "src/store";
import { blobUrlManager } from "src/utility/createMediaUrlObjectFromFilePath";
import { Plugin, type WorkspaceLeaf } from "obsidian";
import { API } from "src/API/API";
import type { IAPI } from "src/API/IAPI";
import { DEFAULT_SETTINGS, VIEW_TYPE } from "src/constants";
import { PodNotesSettingsTab } from "src/ui/settings/PodNotesSettingsTab";
import { MainView } from "src/ui/PodcastView";
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
import createPodcastNote from "./createPodcastNote";
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
import type { Unsubscriber } from "svelte/store";

export default class PodNotes extends Plugin implements IPodNotes {
	public api!: IAPI;
	public settings!: IPodNotesSettings;
	public override app!: PartialAppExtension;

	private view: MainView | null = null;

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

	private maxLayoutReadyAttempts = 10;
	private layoutReadyAttempts = 0;
	private isReady = false;
	private pendingSave: IPodNotesSettings | null = null;
	private saveScheduled = false;
	private saveChain: Promise<void> = Promise.resolve();

	override async onload() {
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
		volume.set(
			Math.min(1, Math.max(0, this.settings.defaultVolume ?? 1)),
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
			checkCallback: (checking: boolean) => {
				if (checking) {
					return !this.app.workspace.getLeavesOfType(VIEW_TYPE).length;
				}

				this.app.workspace.getRightLeaf(false)?.setViewState({
					type: VIEW_TYPE,
				});
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
			id: "hrpn",
			name: "Reload PodNotes",
			callback: () => {
				const id = this.manifest.id;

				this.app.plugins
					.disablePlugin(id)
					.then(() => this.app.plugins.enablePlugin(id));
			},
		});

		this.addCommand({
			id: "capture-timestamp",
			name: "Capture Timestamp",
			icon: "clock" as IconType,
			editorCheckCallback: (checking, editor, view) => {
				if (checking) {
					return !!this.api.podcast && !!this.settings.timestamp.template;
				}

				const cursorPos = editor.getCursor();
				const capture = TimestampTemplateEngine(
					this.settings.timestamp.template,
				);

				editor.replaceRange(capture, cursorPos);
				editor.setCursor(cursorPos.line, cursorPos.ch + capture.length);
			},
		});

		this.addCommand({
			id: "create-podcast-note",
			name: "Create Podcast Note",
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
			id: "podnotes-transcribe",
			name: "Transcribe current episode",
			checkCallback: (checking) => {
				const canTranscribe =
					!!this.api.podcast && !!this.settings.openAIApiKey?.trim();

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
			this.view = new MainView(leaf, this);
			return this.view;
		});

		this.app.workspace.onLayoutReady(this.onLayoutReady.bind(this));

		this.registerObsidianProtocolHandler("podnotes", (action) =>
			podNotesURIHandler(action, this.api),
		);

		this.registerEvent(getContextMenuHandler(this.app));

		this.isReady = true;
	}

	onLayoutReady(): void {
		if (!this.app.workspace || !this.app.workspace.layoutReady) {
			// Workspace is not ready, schedule a retry
			this.layoutReadyAttempts++;
			if (this.layoutReadyAttempts < this.maxLayoutReadyAttempts) {
				setTimeout(() => this.onLayoutReady(), 100);
			} else {
				console.error(
					"Failed to initialize PodNotes layout after maximum attempts",
				);
			}
			return;
		}

		if (this.app.workspace.getLeavesOfType(VIEW_TYPE).length) {
			return;
		}

		const leaf = this.app.workspace.getRightLeaf(false);

		if (leaf) {
			leaf.setViewState({
				type: VIEW_TYPE,
			});
		}
	}

	private getTranscriptionService(): TranscriptionService {
		if (!this.transcriptionService) {
			this.transcriptionService = new TranscriptionService(this);
		}

		return this.transcriptionService;
	}

	override onunload() {
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

		// Clean up any active blob URLs to prevent memory leaks
		blobUrlManager.revokeAll();
	}

	async loadSettings() {
		const loadedData = await this.loadData();

		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
		this.settings.timestamp = {
			...DEFAULT_SETTINGS.timestamp,
			...(loadedData?.timestamp ?? {}),
		};
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
