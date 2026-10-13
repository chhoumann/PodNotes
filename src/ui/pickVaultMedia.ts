import type { App } from "obsidian";
import { playLocalFile } from "src/playLocalFile";
import { getMediaTypeFromPath } from "src/utility/mediaType";
import { PickerModal } from "./PickerModal";

/** Offers the vault's audio and video files, and plays the chosen one. An mp4 or webm plays as video. */
export function pickVaultMedia(app: App): void {
	new PickerModal(
		app,
		app.vault.getFiles().filter((file) => getMediaTypeFromPath(file.path)),
		(file) => file.path,
		"Play a vault file",
		(file) => void playLocalFile(app, file, getMediaTypeFromPath(file.path) ?? "audio"),
	).open();
}
