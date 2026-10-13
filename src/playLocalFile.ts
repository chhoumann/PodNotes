import type { App, TFile } from "obsidian";
import { Notice } from "obsidian";
import { get } from "svelte/store";
import { downloadedEpisodes, playedEpisodes, plugin } from "./store";
import type { EpisodeMediaType } from "./types/Episode";
import { localEpisodeFromFile } from "./utility/localEpisodeFromFile";

export async function playLocalFile(
	app: App,
	file: TFile,
	mediaType: EpisodeMediaType,
): Promise<void> {
	// A file renamed after it was registered keeps the title it was registered under.
	const registeredHere = get(downloadedEpisodes)["local file"]?.find(
		(episode) => episode.filePath === file.path,
	);
	const localEpisode = {
		...localEpisodeFromFile(app, file, mediaType),
		...(registeredHere && { title: registeredHere.title }),
	};

	// Local Files mirrors downloadedEpisodes, so this one write lists the file.
	const replacedFilePath = downloadedEpisodes.addEpisode(localEpisode, file.path, file.stat.size);
	if (replacedFilePath) {
		new Notice(
			`A local file named "${file.basename}" was already tracked at "${replacedFilePath}". It has been replaced by "${file.path}".`,
		);
	}

	if (playedEpisodes.get(localEpisode)?.finished) {
		playedEpisodes.markAsUnplayed(localEpisode);
	}

	get(plugin).player.play(localEpisode);

	await get(plugin).showPlayer();
}
