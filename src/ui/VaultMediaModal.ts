import { FuzzySuggestModal, type App, type TFile } from "obsidian";
import { playLocalFile } from "src/playLocalFile";
import { getMediaTypeFromPath } from "src/utility/mediaType";

/** The vault's audio and video files, to play one. An mp4 or webm plays as video. */
class VaultMediaModal extends FuzzySuggestModal<TFile> {
	getItems(): TFile[] {
		return this.app.vault.getFiles().filter((file) => getMediaTypeFromPath(file.path));
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		void playLocalFile(this.app, file, getMediaTypeFromPath(file.path) ?? "audio");
	}
}

export function pickVaultMedia(app: App): void {
	const modal = new VaultMediaModal(app);
	modal.setPlaceholder("Play a vault file");
	modal.open();
}
