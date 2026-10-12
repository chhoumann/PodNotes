import type { App, EventRef, Menu, TAbstractFile } from "obsidian";
import { Notice, TFile } from "obsidian";
import { get } from "svelte/store";
import { downloadedEpisodes, playedEpisodes, plugin } from "./store";
import type { EpisodeMediaType } from "./types/Episode";
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
					new Notice(
						`A local file named "${file.basename}" was already tracked at "${replacedFilePath}". It has been replaced by "${file.path}".`,
					);
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

				// Playing opens no view, so with the view closed (or hidden in a
				// collapsed sidebar) the file played to no visible player (issue
				// #84). Open the view if needed and reveal it with the full player.
				await get(plugin).showPlayer();
			}),
	);
}
