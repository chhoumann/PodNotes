import { Notice } from "obsidian";
import type { ObsidianProtocolData } from "obsidian";
import { get } from "svelte/store";
import type { IAPI } from "./API/IAPI";
import FeedParser from "./parser/feedParser";
import {
	currentEpisode,
	isPaused,
	localFiles,
	requestedPlaybackTime,
	viewState,
} from "./store";
import type { Episode } from "./types/Episode";
import { getEpisodeKey } from "./utility/episodeKey";
import { ViewState } from "./types/ViewState";

export default async function podNotesURIHandler(
	{ url, episodeName, time }: ObsidianProtocolData,
	api: IAPI
) {
	if (!url || !episodeName || time === undefined) {
		new Notice(
			"URL, episode name, and timestamp are required to play an episode"
		);
		return;
	}

	const requestedTime = parseFloat(time);
	if (!Number.isFinite(requestedTime)) {
		new Notice("Timestamp must be a valid number");
		return;
	}

	const decodedName = episodeName.replace(/\+/g, " ");
	const currentEp = get(currentEpisode);
	const episodeIsPlaying = currentEp?.title === decodedName;
	const playerIsVisible = get(viewState) === ViewState.Player;

	if (episodeIsPlaying) {
		requestedPlaybackTime.set({
			episodeKey: getEpisodeKey(currentEp),
			time: requestedTime,
		});
		viewState.set(ViewState.Player);
		api.currentTime = requestedTime;
		isPaused.set(false);
		if (playerIsVisible) {
			requestedPlaybackTime.set(null);
		}

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

	requestedPlaybackTime.set({
		episodeKey: getEpisodeKey(episode),
		time: requestedTime,
	});
	currentEpisode.set(episode);
	viewState.set(ViewState.Player);
}
