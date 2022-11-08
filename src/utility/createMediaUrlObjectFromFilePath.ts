import { TFile } from "obsidian";

export async function createMediaUrlObjectFromFilePath(filePath: string) {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!file || !(file instanceof TFile)) return "";

	const binary = await app.vault.readBinary(file);

	return URL.createObjectURL(new Blob([binary], { type: "audio/mpeg" }));
}
