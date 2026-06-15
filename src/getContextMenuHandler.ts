import type { App, EventRef, Menu, TAbstractFile } from "obsidian";
import { TFile } from "obsidian";
import { get } from "svelte/store";
import {
	downloadedEpisodes,
	playedEpisodes,
	currentEpisode,
	viewState,
} from "./store";
import type { LocalEpisode } from "./types/LocalEpisode";
import { ViewState } from "./types/ViewState";
import { createMediaUrlObjectFromFilePath } from "./utility/createMediaUrlObjectFromFilePath";

// Audio/video extensions PodNotes can play. The previous inline regex
// (/mp3|mp4|.../) had a trailing alternative that matched the empty string, so
// "Play with PodNotes" surfaced on every file regardless of type.
const PLAYABLE_EXTENSIONS = new Set([
	"mp3",
	"mp4",
	"wma",
	"aac",
	"wav",
	"webm",
	"flac",
	"m4a",
]);

export default function getContextMenuHandler(app: App): EventRef {
	return app.workspace.on(
		"file-menu",
		(menu: Menu, file: TAbstractFile) => {
			if (!(file instanceof TFile)) return;
			if (!PLAYABLE_EXTENSIONS.has(file.extension.toLowerCase())) return;

			menu.addItem((item) =>
				item
					.setIcon("play")
					.setTitle("Play with PodNotes")
					.onClick(async () => {
						const localEpisode: LocalEpisode = {
							title: file.basename,
							description: "",
							content: "",
							podcastName: "local file",
							url: app.fileManager.generateMarkdownLink(file, ""),
							streamUrl: await createMediaUrlObjectFromFilePath(
								file.path
							),
							filePath: file.path,
							episodeDate: new Date(file.stat.ctime),
						};

						if (
							!downloadedEpisodes.isEpisodeDownloaded(
								localEpisode
							)
						) {
							// The Local Files playlist is mirrored from downloadedEpisodes
							// (see localFiles.syncWithDownloaded), so this single write
							// surfaces the file there too.
							downloadedEpisodes.addEpisode(
								localEpisode,
								file.path,
								file.stat.size
							);
						}

						// Fixes where the episode won't play if it has been played.
						if (get(playedEpisodes)[file.basename]?.finished) {
							playedEpisodes.markAsUnplayed(localEpisode);
						}

						currentEpisode.set(localEpisode);
						viewState.set(ViewState.Player);
					})
			);
		}
	);
}
