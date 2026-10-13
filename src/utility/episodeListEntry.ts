import type { Episode } from "src/types/Episode";
import type { PlayedEpisode } from "src/types/PlayedEpisode";
import { getEpisodeKey } from "src/utility/episodeKey";
import {
	getFinishedPlayedEpisodeRecords,
	getPlayedEpisodeRecordKey,
	podcastNamesAgree,
	type PlayedEpisodeMap,
} from "src/utility/episodeStatus";

export interface EpisodeListEntry {
	episode: Episode;
	isAvailable: boolean;
}

export interface PlayedEpisodeListEntry extends EpisodeListEntry {
	playedEpisode: PlayedEpisode;
	playedEpisodeKey: string;
}

function createEpisodeListEntry(episode: Episode): EpisodeListEntry {
	return {
		episode,
		isAvailable: true,
	};
}

export function createEpisodeListEntries(episodes: readonly Episode[]): EpisodeListEntry[] {
	return episodes.map(createEpisodeListEntry);
}

export function buildPlayedEpisodeListEntries(
	playedEpisodes: PlayedEpisodeMap,
	episodeSources: readonly (readonly Episode[])[],
): PlayedEpisodeListEntry[] {
	const episodeLookup = buildEpisodeLookup(episodeSources.flat());

	return getFinishedPlayedEpisodeRecords(playedEpisodes)
		.map(({ key, episode }) => createPlayedEpisodeListEntry(key, episode, episodeLookup))
		.sort(comparePlayedEpisodeEntries);
}

function createPlayedEpisodeListEntry(
	key: string,
	playedEpisode: PlayedEpisode,
	episodeLookup: Map<string, Episode>,
): PlayedEpisodeListEntry {
	const episode = resolvePlayedEpisode(key, playedEpisode, episodeLookup);

	if (episode) {
		return {
			episode,
			isAvailable: true,
			playedEpisode,
			playedEpisodeKey: key,
		};
	}

	return {
		episode: createPlayedEpisodePlaceholder(playedEpisode),
		isAvailable: false,
		playedEpisode,
		playedEpisodeKey: key,
	};
}

function resolvePlayedEpisode(
	key: string,
	playedEpisode: PlayedEpisode,
	episodeLookup: Map<string, Episode>,
): Episode | undefined {
	const lookupKeys = [getPlayedEpisodeRecordKey(playedEpisode), key, playedEpisode.title];

	for (const lookupKey of lookupKeys) {
		const episode = episodeLookup.get(lookupKey);
		if (episode && podcastNamesAgree(playedEpisode.podcastName, episode.podcastName)) {
			return episode;
		}
	}

	return undefined;
}

function buildEpisodeLookup(episodes: Episode[]): Map<string, Episode> {
	const lookup = new Map<string, Episode>();

	for (const episode of episodes) {
		const keys = [
			getEpisodeKey(episode),
			episode.podcastName ? `${episode.podcastName}::${episode.title}` : "",
			episode.title,
		].filter(Boolean);

		for (const key of keys) {
			if (!lookup.has(key)) {
				lookup.set(key, episode);
			}
		}
	}

	return lookup;
}

function createPlayedEpisodePlaceholder(
	playedEpisode: Pick<PlayedEpisode, "title" | "podcastName">,
): Episode {
	return {
		title: playedEpisode.title,
		podcastName: playedEpisode.podcastName,
		streamUrl: "",
		url: "",
		description: "",
		content: "",
	};
}

function comparePlayedEpisodeEntries(a: PlayedEpisodeListEntry, b: PlayedEpisodeListEntry): number {
	if (a.isAvailable !== b.isAvailable) {
		return a.isAvailable ? -1 : 1;
	}

	const aDate = getEpisodeTimestamp(a.episode);
	const bDate = getEpisodeTimestamp(b.episode);
	if (aDate !== bDate) {
		return bDate - aDate;
	}

	return a.episode.title.localeCompare(b.episode.title);
}

function getEpisodeTimestamp(episode: Episode): number {
	if (!episode.episodeDate) return 0;

	const timestamp = Number(new Date(episode.episodeDate));
	return Number.isNaN(timestamp) ? 0 : timestamp;
}
