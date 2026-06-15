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

// Extensions for which "Play with PodNotes" is offered. Kept in sync with the
// formats PodNotes already recognizes as audio elsewhere (detectAudioFileExtension
// in downloadEpisode.ts and getExtensionFromContentType), plus the mp4/webm
// containers, so right-clicking any such file offers playback. The previous inline
// regex had a trailing empty alternative that matched every file regardless of type.
const PLAYABLE_EXTENSIONS = new Set([
	"mp3",
	"mp4",
	"m4a",
	"aac",
	"ogg",
	"wav",
	"webm",
	"flac",
	"wma",
	"amr",
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
							streamUrl: createMediaUrlObjectFromFilePath(file.path),
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
