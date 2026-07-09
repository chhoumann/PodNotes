import type { Episode } from "src/types/Episode";
import type { PlayedEpisode } from "src/types/PlayedEpisode";
import { getEpisodeKey } from "src/utility/episodeKey";

export type PlayedEpisodeMap = Record<string, PlayedEpisode>;

export interface PlayedEpisodeRecord {
	key: string;
	episode: PlayedEpisode;
}

export function getPlayedEpisode(
	playedEpisodes: PlayedEpisodeMap,
	episode: Episode | null | undefined,
): PlayedEpisode | undefined {
	if (!episode) return undefined;

	const key = getEpisodeKey(episode);
	if (key && playedEpisodes[key]) {
		return playedEpisodes[key];
	}

	if (episode.title && playedEpisodes[episode.title]) {
		return playedEpisodes[episode.title];
	}

	return undefined;
}

export function isEpisodeFinished(
	episode: Episode | null | undefined,
	playedEpisodes: PlayedEpisodeMap,
): boolean {
	return getPlayedEpisode(playedEpisodes, episode)?.finished ?? false;
}

export function getPlayedEpisodeRecordKey(
	episode: Pick<PlayedEpisode, "title" | "podcastName">,
): string {
	if (episode.podcastName) {
		return `${episode.podcastName}::${episode.title}`;
	}

	return episode.title;
}

export function getPlayedEpisodeAliasKeys(
	playedEpisodes: PlayedEpisodeMap,
	episode: Pick<PlayedEpisode, "title" | "podcastName">,
	sourceKey?: string,
): string[] {
	const keys = new Set<string>();
	const targetKey = getPlayedEpisodeRecordKey(episode);

	for (const [key, playedEpisode] of Object.entries(playedEpisodes)) {
		if (key === sourceKey || key === targetKey || isSamePlayedEpisode(playedEpisode, episode)) {
			keys.add(key);
		}
	}

	return Array.from(keys);
}

export function getFinishedPlayedEpisodeRecords(
	playedEpisodes: PlayedEpisodeMap,
): PlayedEpisodeRecord[] {
	const recordsByEpisodeKey = new Map<string, PlayedEpisodeRecord>();

	for (const [key, episode] of Object.entries(playedEpisodes)) {
		if (!episode.finished) continue;

		const episodeKey = getPlayedEpisodeRecordKey(episode);
		const existingRecord = recordsByEpisodeKey.get(episodeKey);
		if (!existingRecord || isCompositePlayedKey(key)) {
			recordsByEpisodeKey.set(episodeKey, { key, episode });
		}
	}

	return Array.from(recordsByEpisodeKey.values());
}

function isCompositePlayedKey(key: string): boolean {
	return key.includes("::");
}

function isSamePlayedEpisode(
	playedEpisode: PlayedEpisode,
	episode: Pick<PlayedEpisode, "title" | "podcastName">,
): boolean {
	if (playedEpisode.title !== episode.title) return false;
	if (!playedEpisode.podcastName || !episode.podcastName) return true;

	return playedEpisode.podcastName === episode.podcastName;
}
