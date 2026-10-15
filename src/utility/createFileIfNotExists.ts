import { TFile } from "obsidian";
import { get } from "svelte/store";
import { plugin } from "src/store";
import { ensureFolderExists } from "./ensureFolderExists";

export async function createFileIfNotExists(
	path: string,
	content: string,
): Promise<{ file: TFile; created: boolean }> {
	const folderPath = path.split("/").slice(0, -1).join("/");
	await ensureFolderExists(folderPath);

	const { app } = get(plugin);
	try {
		return { file: await app.vault.create(path, content), created: true };
	} catch (error) {
		// A racing create may have won between the check and here; treat an
		// already-existing file as success rather than surfacing an error.
		const raced = app.vault.getAbstractFileByPath(path);
		if (raced instanceof TFile) {
			return { file: raced, created: false };
		}
		throw error;
	}
}
