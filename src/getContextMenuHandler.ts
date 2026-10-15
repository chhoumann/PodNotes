import type { App, EventRef, Menu, TAbstractFile } from "obsidian";
import { TFile } from "obsidian";
import { playLocalFile } from "./playLocalFile";
import type { EpisodeMediaType } from "./types/Episode";
import { getMediaTypeFromPath, isAudioContainerExtension } from "./utility/mediaType";

export default function getContextMenuHandler(app: App): EventRef {
	return app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
		if (!(file instanceof TFile)) return;

		if (isAudioContainerExtension(file.extension)) {
			addPlayLocalFileItem(menu, app, file, "audio", "Play as audio with PodNotes");
			addPlayLocalFileItem(menu, app, file, "video", "Play as video with PodNotes");
			return;
		}

		const mediaType = getMediaTypeFromPath(file.path);
		if (mediaType) addPlayLocalFileItem(menu, app, file, mediaType, "Play with PodNotes");
	});
}

function addPlayLocalFileItem(
	menu: Menu,
	app: App,
	file: TFile,
	mediaType: EpisodeMediaType,
	title: string,
): void {
	menu.addItem((item) =>
		item
			.setIcon("play")
			.setTitle(title)
			.onClick(() => playLocalFile(app, file, mediaType)),
	);
}
