import type { App, EventRef, Menu, TAbstractFile, WorkspaceLeaf } from "obsidian";
import { Notice, TFile } from "obsidian";
import { get } from "svelte/store";
import { VIEW_TYPE } from "./constants";
import { downloadedEpisodes, playedEpisodes, viewState, plugin } from "./store";
import type { EpisodeMediaType } from "./types/Episode";
import { ViewState } from "./types/ViewState";
import { localEpisodeFromFile } from "./utility/localEpisodeFromFile";
import { getMediaTypeFromPath, isAudioContainerExtension } from "./utility/mediaType";

export default function getContextMenuHandler(app: App): EventRef {
	return app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
		if (!(file instanceof TFile)) return;
		const mediaType = getMediaTypeFromPath(file.path);
		const isAmbiguousContainer = isAudioContainerExtension(file.extension);
		if (!mediaType && !isAmbiguousContainer) return;

		if (isAmbiguousContainer) {
			addPlayLocalFileItem(menu, app, file, "audio");
			addPlayLocalFileItem(menu, app, file, "video");
			return;
		}

		if (!mediaType) return;
		addPlayLocalFileItem(menu, app, file, mediaType);
	});
}

function addPlayLocalFileItem(
	menu: Menu,
	app: App,
	file: TFile,
	mediaType: EpisodeMediaType,
): void {
	const isAmbiguousContainer = isAudioContainerExtension(file.extension);
	const title = isAmbiguousContainer
		? `Play as ${mediaType} with PodNotes`
		: "Play with PodNotes";

	menu.addItem((item) =>
		item
			.setIcon("play")
			.setTitle(title)
			.onClick(async () => {
				const localEpisode = localEpisodeFromFile(app, file, mediaType);

				// The Local Files playlist is mirrored from downloadedEpisodes
				// (see localFiles.syncWithDownloaded), so this single write
				// surfaces the file there too. Always refresh the entry: two
				// same-basename local files can differ by folder or media type.
				// addEpisode reports a basename collision (a different file already
				// tracked under this name) so we can warn here — the store stays pure
				// (#LF-06).
				const replacedFilePath = downloadedEpisodes.addEpisode(
					localEpisode,
					file.path,
					file.stat.size,
				);
				if (replacedFilePath) {
					showReplacedLocalFileNotice(file.basename, replacedFilePath, file.path);
				}

				// Re-enable replay for a finished local file. Look it up with
				// playedEpisodes.get (which resolves the composite "local
				// file::<basename>" key and falls back to legacy bare-title), not
				// the raw bare-basename map — markAsPlayed/setEpisodeTime store under
				// the composite key, so the old bare-basename lookup never matched
				// and a finished local file refused to replay (CM-10/LF-09).
				if (playedEpisodes.get(localEpisode)?.finished) {
					playedEpisodes.markAsUnplayed(localEpisode);
				}

				get(plugin).player.play(localEpisode);
				viewState.set(ViewState.Player);
				get(plugin)?.enablePodcastViewMount();

				// Playing opens no view, so with the view closed (or hidden in a
				// collapsed sidebar) the file played to no visible player (issue
				// #84). Open the view if needed and reveal it so the player
				// surfaces with the just-selected episode.
				await revealPodcastView(app);
			}),
	);
}

/** The local file at `filePath` took over the name `title` from the file at `replacedFilePath`. */
export function showReplacedLocalFileNotice(
	title: string,
	replacedFilePath: string,
	filePath: string,
): void {
	new Notice(
		`A local file named "${title}" was already tracked at "${replacedFilePath}". It has been replaced by "${filePath}".`,
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

	let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE)[0] ?? null;

	if (!leaf) {
		leaf = workspace.getRightLeaf(false);
		if (!leaf) return;

		await leaf.setViewState({ type: VIEW_TYPE, active: true });
	}

	await workspace.revealLeaf(leaf);
}
