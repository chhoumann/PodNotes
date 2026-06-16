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

/**
 * Obsidian decodes protocol query values with decodeURIComponent only, which does NOT turn '+'
 * into a space. Current PodNotes links percent-encode spaces as '%20' (see encodePodnotesURI), so
 * the decoded value is already correct and a literal '+' is a real '+'. Links written by older
 * versions encoded spaces as '+', so for backwards compatibility we also try a variant with '+'
 * collapsed to spaces.
 *
 * Candidates are ordered most-correct-first; callers MUST resolve them in order and stop at the
 * first hit so a current-format title/path containing a literal '+' is never mis-collapsed.
 */
function candidateValues(raw: string): string[] {
	const legacy = raw.replace(/\+/g, " ");
	return raw === legacy ? [raw] : [raw, legacy];
}

function findEpisodeByCandidates(
	episodes: Episode[],
	nameCandidates: string[],
): Episode | undefined {
	for (const name of nameCandidates) {
		const target = name.trim().toLowerCase();
		const episode = episodes.find(
			(ep) => ep.title.trim().toLowerCase() === target,
		);
		if (episode) return episode;
	}

	return undefined;
}

export default async function podNotesURIHandler(
	{ url, episodeName, time }: ObsidianProtocolData,
	api: IAPI
) {
	if (!url || !episodeName) {
		new Notice("URL and episode name are required to play an episode");
		return;
	}

	// A link may omit the timestamp ({{episodelink}}, issue #35). When it does we
	// reopen the episode and let the player's saved-progress restore resume from
	// the last played location (or the start if it has never been played), rather
	// than seeking to a baked-in time.
	const hasExplicitTime = time !== undefined && time !== "";
	let requestedTime = 0;
	if (hasExplicitTime) {
		requestedTime = parseFloat(time);
		if (!Number.isFinite(requestedTime)) {
			new Notice("Timestamp must be a valid number");
			return;
		}
	}

	const nameCandidates = candidateValues(episodeName);
	const currentEp = get(currentEpisode);
	// Membership (not ordered selection) is correct here: there is only one loaded episode, and
	// keeping the legacy candidate lets a legacy '+'-as-space link to the loaded episode resume
	// without a feed round-trip (and without currentEpisode.set re-enqueueing it). The only cost is
	// a rare false-positive — a current-format link to a "X+Y" episode while a distinct "X Y" twin
	// is loaded resumes the loaded twin instead of switching — which we accept over regressing the
	// far more common same-episode legacy-link case.
	const episodeIsPlaying = !!currentEp && nameCandidates.includes(currentEp.title);
	const playerIsVisible = get(viewState) === ViewState.Player;

	if (episodeIsPlaying) {
		if (hasExplicitTime) {
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

		// No timestamp: the live position already is the last played location, so
		// just surface the player and resume playback without seeking.
		viewState.set(ViewState.Player);
		isPaused.set(false);

		return;
	}

	// The path probe only decides local-vs-feed routing; the episode itself is resolved by name.
	const localFile = candidateValues(url)
		.map((path) => app.vault.getAbstractFileByPath(path))
		.find((file) => file !== null);

	let episode: Episode | undefined;

	if (localFile) {
		episode = nameCandidates
			.map((name) => localFiles.getLocalEpisode(name))
			.find((ep) => ep !== undefined);
	} else {
		try {
			// Fetch with the raw url (current-format links are correct as-is); only the title gets
			// the legacy-candidate treatment. A '+' in a legacy feed URL is pre-existing and out of
			// scope. getEpisodes returns fully-populated episodes, so we match in memory rather than
			// re-fetching once per candidate.
			const feedparser = new FeedParser();
			const episodes = await feedparser.getEpisodes(url);
			episode = findEpisodeByCandidates(episodes, nameCandidates);
		} catch (error) {
			// A fetch/parse failure is distinct from a genuine title miss; surface it instead of
			// rejecting silently (the previous behaviour threw an unhandled rejection).
			console.error(error);
			new Notice("Could not load the podcast feed");
			return;
		}
	}

	if (!episode) {
		new Notice("Episode not found");
		return;
	}

	if (hasExplicitTime) {
		requestedPlaybackTime.set({
			episodeKey: getEpisodeKey(episode),
			time: requestedTime,
		});
	}
	// Without an explicit timestamp we deliberately leave requestedPlaybackTime
	// unset: loading the episode triggers the player's saved-progress restore,
	// which resumes from the last played location (issue #35).
	currentEpisode.set(episode);
	viewState.set(ViewState.Player);
}
