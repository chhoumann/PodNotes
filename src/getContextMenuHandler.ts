import type { App, EventRef, Menu, TAbstractFile } from "obsidian";
import { TFile } from "obsidian";
import { playLocalFile } from "./playLocalFile";
import type { EpisodeMediaType } from "./types/Episode";
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
			.onClick(() => playLocalFile(app, file, mediaType)),
	);
}
