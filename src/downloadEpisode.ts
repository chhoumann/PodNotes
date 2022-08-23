import { Notice } from "obsidian";
import { downloadedEpisodes } from "./store";
import { DownloadPathTemplateEngine } from "./TemplateEngine";
import { Episode } from "./types/Episode";
import getUrlExtension from "./utility/getUrlExtension";

export default async function downloadEpisode(episode: Episode, downloadPathTemplate: string): Promise<void> {
	try {
		const response = await fetch(episode.streamUrl, {
			method: 'GET',
		});

		const blobPromise = response.blob();
		const blob = await blobPromise;

		if (!blob.type.contains('audio')) {
			throw new Error('Not an audio file');
		}

		const basename = DownloadPathTemplateEngine(downloadPathTemplate, episode);
		const filePath = `${basename}.${getUrlExtension(response.url)}`;
		const buffer = await blob.arrayBuffer();

		await app.vault.createBinary(filePath, buffer);
		downloadedEpisodes.update(podcasts => {
			podcasts[episode.podcastName] = podcasts[episode.podcastName] || [];
			
			podcasts[episode.podcastName].push({
				...episode,
				filePath,
			});

			return podcasts;
		});

		new Notice(`Downloaded "${episode.title}" from ${episode.podcastName}`);
	} catch (error) {
		console.error(error);
		new Notice(error);
	}
}
