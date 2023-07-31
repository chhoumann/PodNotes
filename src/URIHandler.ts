import { Notice, ObsidianProtocolData } from "obsidian";
import { get } from "svelte/store";
import { IAPI } from "./API/IAPI";
import FeedParser from "./parser/feedParser";
import { currentEpisode, viewState, localFiles } from "./store";
import { Episode } from "./types/Episode";
import { ViewState } from "./types/ViewState";

export default async function podNotesURIHandler(
	{ url, episodeName, time }: ObsidianProtocolData,
	api: IAPI
) {
	if (!url || !episodeName || !time) {
		new Notice(
			"URL, episode name, and timestamp are required to play an episode"
		);
		return;
	}

	const decodedName = episodeName.replace(/\+/g, " ");
	const currentEp = get(currentEpisode);
	const episodeIsPlaying = currentEp?.title === decodedName;

	if (episodeIsPlaying) {
		viewState.set(ViewState.Player);
		api.currentTime = parseFloat(time);

		return;
	}
	
	const decodedUrl = url.replace(/\+/g, " ");
	const localFile = app.vault.getAbstractFileByPath(decodedUrl);

	let episode: Episode | undefined;

	if (localFile) {
		episode = localFiles.getLocalEpisode(decodedName);
	} else {
		const feedparser = new FeedParser();

		episode = await feedparser.findItemByTitle(decodedName, url);
	}

	if (!episode) {
		new Notice("Episode not found");
		return;
	}

	currentEpisode.set(episode);
	viewState.set(ViewState.Player);

	new Notice(
		"Episode found, playing now. Please click timestamp again to play at specific time."
	);
}
