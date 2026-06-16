import type { App, EventRef, Menu, TAbstractFile, WorkspaceLeaf } from "obsidian";
import { TFile } from "obsidian";
import { get } from "svelte/store";
import { VIEW_TYPE } from "./constants";
import {
	downloadedEpisodes,
	playedEpisodes,
	currentEpisode,
	viewState,
	plugin,
} from "./store";
import type { LocalEpisode } from "./types/LocalEpisode";
import { ViewState } from "./types/ViewState";
import { createMediaUrlObjectFromFilePath } from "./utility/createMediaUrlObjectFromFilePath";
import { getMediaTypeFromPath } from "./utility/mediaType";

export default function getContextMenuHandler(app: App): EventRef {
	return app.workspace.on(
		"file-menu",
		(menu: Menu, file: TAbstractFile) => {
			if (!(file instanceof TFile)) return;
			const mediaType = getMediaTypeFromPath(file.path);
			if (!mediaType) return;

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
							mediaType,
						};

						// The Local Files playlist is mirrored from downloadedEpisodes
						// (see localFiles.syncWithDownloaded), so this single write
						// surfaces the file there too. Always refresh the entry: two
						// same-basename local files can differ by folder or media type.
						downloadedEpisodes.addEpisode(
							localEpisode,
							file.path,
							file.stat.size
						);

						// Fixes where the episode won't play if it has been played.
						if (get(playedEpisodes)[file.basename]?.finished) {
							playedEpisodes.markAsUnplayed(localEpisode);
						}

						currentEpisode.set(localEpisode);
						viewState.set(ViewState.Player);
						get(plugin)?.enablePodcastViewMount();

						// Setting the stores above only updates an already-mounted
						// PodNotes view. When the view is closed (or hidden in a
						// collapsed sidebar) nothing reacts, so "Play with PodNotes"
						// silently did nothing — the file played to no visible player
						// (issue #84). Open the view if needed and reveal it so the
						// player surfaces with the just-selected episode.
						await revealPodcastView(app);
					})
			);
		}
	);
}

/**
 * Ensures the PodNotes player view is open and brought into view.
 *
 * Mirrors the "Show PodNotes" command and onLayoutReady: reuse an existing leaf
 * when present, otherwise open the view in the right sidebar. revealLeaf also
 * surfaces a leaf that exists but is hidden inside a collapsed sidebar.
 */
async function revealPodcastView(app: App): Promise<void> {
	const { workspace } = app;

	let leaf: WorkspaceLeaf | null =
		workspace.getLeavesOfType(VIEW_TYPE)[0] ?? null;

	if (!leaf) {
		leaf = workspace.getRightLeaf(false);
		if (!leaf) return;

		await leaf.setViewState({ type: VIEW_TYPE, active: true });
	}

	await workspace.revealLeaf(leaf);
}
