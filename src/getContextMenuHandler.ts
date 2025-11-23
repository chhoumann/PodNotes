import type { EventRef } from "obsidian";
import { Menu, TAbstractFile, TFile } from "obsidian";
import { get } from "svelte/store";
import {
	downloadedEpisodes,
	localFiles,
	playedEpisodes,
	currentEpisode,
	viewState,
} from "./store";
import type { LocalEpisode } from "./types/LocalEpisode";
import { ViewState } from "./types/ViewState";
import { createMediaUrlObjectFromFilePath } from "./utility/createMediaUrlObjectFromFilePath";

export default function getContextMenuHandler(): EventRef {
	return this.app.workspace.on(
		"file-menu",
		(menu: Menu, file: TAbstractFile) => {
			if (!(file instanceof TFile)) return;
			if (!file.extension.match(/mp3|mp4|wma|aac|wav|webm|aac|flac|m4a|/))
				return;

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

							localFiles.addEpisode(localEpisode);
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
