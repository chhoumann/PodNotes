import FeedParser from "src/parser/feedParser";
import {
	currentEpisode,
	downloadedEpisodes,
	favorites,
	localFiles,
	playedEpisodes,
	playlists,
	queue,
	savedFeeds,
	viewState,
} from "src/store";
import { Notice, Plugin, TAbstractFile, WorkspaceLeaf } from "obsidian";
import { API } from "src/API/API";
import { IAPI } from "src/API/IAPI";
import { DEFAULT_SETTINGS, VIEW_TYPE } from "src/constants";
import { PodNotesSettingsTab } from "src/ui/settings/PodNotesSettingsTab";
import { MainView } from "src/ui/PodcastView";
import { IPodNotesSettings } from "./types/IPodNotesSettings";
import { plugin } from "./store";
import { get } from "svelte/store";
import { IPodNotes } from "./types/IPodNotes";
import { EpisodeStatusController } from "./store_controllers/EpisodeStatusController";
import { StoreController } from "./types/StoreController";
import { PlayedEpisode } from "./types/PlayedEpisode";
import { PodcastFeed } from "./types/PodcastFeed";
import { SavedFeedsController } from "./store_controllers/SavedFeedsController";
import { Playlist } from "./types/Playlist";
import { PlaylistController } from "./store_controllers/PlaylistController";
import { QueueController } from "./store_controllers/QueueController";
import { FavoritesController } from "./store_controllers/FavoritesController";
import { Episode } from "./types/Episode";
import CurrentEpisodeController from "./store_controllers/CurrentEpisodeController";
import { ViewState } from "./types/ViewState";
import { TimestampTemplateEngine } from "./TemplateEngine";
import createPodcastNote from "./createPodcastNote";
import downloadEpisodeWithProgressNotice from "./downloadEpisode";
import DownloadedEpisode from "./types/DownloadedEpisode";
import DownloadedEpisodesController from "./store_controllers/DownloadedEpisodesController";
import { TFile } from "obsidian";
import { createMediaUrlObjectFromFilePath } from "./utility/createMediaUrlObjectFromFilePath";
import { LocalFilesController } from "./store_controllers/LocalFilesController";
import PartialAppExtension from "./global";

export default class PodNotes extends Plugin implements IPodNotes {
	public api: IAPI;
	public settings: IPodNotesSettings;
	public app: PartialAppExtension;

	private view: MainView;

	private playedEpisodeController: StoreController<{
		[episodeName: string]: PlayedEpisode;
	}>;
	private savedFeedsController: StoreController<{
		[podcastName: string]: PodcastFeed;
	}>;
	private playlistController: StoreController<{
		[playlistName: string]: Playlist;
	}>;
	private queueController: StoreController<Playlist>;
	private favoritesController: StoreController<Playlist>;
	private localFilesController: StoreController<Playlist>;
	private currentEpisodeController: StoreController<Episode>;
	private downloadedEpisodesController: StoreController<{
		[podcastName: string]: DownloadedEpisode[];
	}>;

	async onload() {
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

		this.playedEpisodeController = new EpisodeStatusController(
			playedEpisodes,
			this
		).on();
		this.savedFeedsController = new SavedFeedsController(
			savedFeeds,
			this
		).on();
		this.playlistController = new PlaylistController(playlists, this).on();
		this.queueController = new QueueController(queue, this).on();
		this.favoritesController = new FavoritesController(
			favorites,
			this
		).on();
		this.localFilesController = new LocalFilesController(
			localFiles,
			this
		).on();
		this.downloadedEpisodesController = new DownloadedEpisodesController(
			downloadedEpisodes,
			this
		).on();
		this.currentEpisodeController = new CurrentEpisodeController(
			currentEpisode,
			this
		).on();

		this.addCommand({
			id: "start-playing",
			name: "Play Podcast",
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
			checkCallback: (checking) => {
				if (checking) {
					return !!this.api.podcast;
				}

				const episode = this.api.podcast;
				downloadEpisodeWithProgressNotice(
					episode,
					this.settings.download.path
				);
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
			editorCheckCallback: (checking, editor, view) => {
				if (checking) {
					return (
						!!this.api.podcast && !!this.settings.timestamp.template
					);
				}

				const cursorPos = editor.getCursor();
				const capture = TimestampTemplateEngine(
					this.settings.timestamp.template
				);

				editor.replaceRange(capture, cursorPos);
				editor.setCursor(cursorPos.line, cursorPos.ch + capture.length);
			},
		});

		this.addCommand({
			id: "create-podcast-note",
			name: "Create Podcast Note",
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

		this.addSettingTab(new PodNotesSettingsTab(this.app, this));

		this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => {
			this.view = new MainView(leaf, this);
			this.api = new API();
			return this.view;
		});

		this.app.workspace.onLayoutReady(this.onLayoutReady.bind(this));

		this.registerObsidianProtocolHandler(
			"podnotes",
			async ({ url, episodeName, time }) => {
				if (!url || !episodeName || !time) {
					new Notice(
						"URL, episode name, and timestamp are required to play an episode"
					);
					return;
				}

				const decodedName = episodeName.replace(/\+/g, " ");
				const currentEp = get(currentEpisode);
				const episodeIsPlaying = currentEp?.title === decodedName;

				if (episodeIsPlaying) {
					viewState.set(ViewState.Player);
					this.api.currentTime = parseFloat(time);
				}

				if (!episodeIsPlaying) {
					const pcastParser = new FeedParser();
					const episode = await pcastParser.findItemByTitle(
						decodedName,
						url
					);

					if (!episode) {
						new Notice("Episode not found");
						return;
					}

					currentEpisode.set(episode);
					viewState.set(ViewState.Player);

					new Notice(
						"Episode found, playing now. Please click timestamp again to play at specific time."
					);
				}
			}
		);

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file: TAbstractFile) => {
				if (!(file instanceof TFile)) return;
				if (
					!file.extension.match(
						/mp3|mp4|wma|aac|wav|webm|aac|flac|m4a|/
					)
				)
					return;

				menu.addItem((item) =>
					item
						.setIcon("play")
						.setTitle("Play with PodNotes")
						.onClick(async () => {
							const localEpisode: Episode = {
								title: file.basename,
								description: "",
								content: "",
								podcastName: "local file",
								url: app.fileManager.generateMarkdownLink(
									file,
									""
								),
								streamUrl:
									await createMediaUrlObjectFromFilePath(
										file.path
									),
								episodeDate: new Date(file.stat.ctime),
							};

							if (
								!downloadedEpisodes.isEpisodeDownloaded(
									localEpisode
								)
							) {
								downloadedEpisodes.addEpisode(
									localEpisode,
									file.path,
									file.stat.size
								);
								localFiles.update((localFiles) => {
									localFiles.episodes.push(localEpisode);
									return localFiles;
								});
							}

							// Fixes where the episode won't play if it has been played.
							if (get(playedEpisodes)[file.basename]?.finished) {
								playedEpisodes.markAsUnplayed(localEpisode);
							}

							currentEpisode.set(localEpisode);
							viewState.set(ViewState.Player);
						})
				);
			})
		);
	}

	onLayoutReady(): void {
		if (this.app.workspace.getLeavesOfType(VIEW_TYPE).length) {
			return;
		}

		this.app.workspace.getRightLeaf(false).setViewState({
			type: VIEW_TYPE,
		});
	}

	onunload() {
		this?.playedEpisodeController.off();
		this?.savedFeedsController.off();
		this?.playlistController.off();
		this?.queueController.off();
		this?.favoritesController.off();
		this?.localFilesController.off();
		this?.downloadedEpisodesController.off();
		this?.currentEpisodeController.off();
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
