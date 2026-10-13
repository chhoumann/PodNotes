import type { App } from "obsidian";
import { playLocalFile } from "src/playLocalFile";
import { getMediaTypeFromPath } from "src/utility/mediaType";
import { PickerModal } from "./PickerModal";

export function pickVaultMedia(app: App): void {
	new PickerModal(
		app,
		app.vault.getFiles().filter((file) => getMediaTypeFromPath(file.path)),
		(file) => file.path,
		"Play a vault file",
		(file) => void playLocalFile(app, file, getMediaTypeFromPath(file.path) ?? "audio"),
	).open();
}
