import type { App, TFile } from "obsidian";
import type { EpisodeMediaType } from "src/types/Episode";
import type { LocalEpisode } from "src/types/LocalEpisode";
import { createMediaUrlObjectFromFilePath } from "./createMediaUrlObjectFromFilePath";

/** The episode that plays a vault file. */
export function localEpisodeFromFile(
	app: App,
	file: TFile,
	mediaType: EpisodeMediaType,
): LocalEpisode {
	return {
		title: file.basename,
		description: "",
		content: "",
		podcastName: "local file",
		url: app.fileManager.generateMarkdownLink(file, ""),
		streamUrl: createMediaUrlObjectFromFilePath(app.vault, file.path),
		filePath: file.path,
		episodeDate: new Date(file.stat.ctime),
		mediaType,
	};
}
