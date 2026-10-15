import type { Episode } from "src/types/Episode";
import type { PlayedEpisode } from "src/types/PlayedEpisode";
import { getEpisodeKey, getProgressKey, isGuidProgressKey } from "src/utility/episodeKey";

export type PlayedEpisodeMap = Record<string, PlayedEpisode>;

export interface PlayedEpisodeRecord {
	key: string;
	episode: PlayedEpisode;
}

export function podcastNamesAgree(podcastName: string, otherPodcastName: string): boolean {
	return !podcastName || !otherPodcastName || podcastName === otherPodcastName;
}

function own(playedEpisodes: PlayedEpisodeMap, key: string): PlayedEpisode | undefined {
	return Object.prototype.hasOwnProperty.call(playedEpisodes, key)
		? playedEpisodes[key]
		: undefined;
}

/** A record saved under the title, as 2.21.1 saved all progress: the episode key, else the raw title when its podcast agrees. */
function titleRecord(
	playedEpisodes: PlayedEpisodeMap,
	episode: Episode,
): PlayedEpisode | undefined {
	const legacy = own(playedEpisodes, episode.title);
	return (
		own(playedEpisodes, getEpisodeKey(episode)) ??
		(legacy && podcastNamesAgree(legacy.podcastName, episode.podcastName) ? legacy : undefined)
	);
}

export function getPlayedEpisode(
	playedEpisodes: PlayedEpisodeMap,
	episode: Episode | null | undefined,
): PlayedEpisode | undefined {
	if (!episode) return undefined;

	// A title record shared by two items of one feed cannot be told apart, so neither borrows it.
	return (
		own(playedEpisodes, getProgressKey(episode)) ??
		(episode.guid && episode.sharedTitle ? undefined : titleRecord(playedEpisodes, episode))
	);
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
		// A guid record may share its title with a twin, so only its own key names it.
		if (
			key === sourceKey ||
			key === targetKey ||
			(!isGuidProgressKey(key) && isSamePlayedEpisode(playedEpisode, episode))
		) {
			keys.add(key);
		}
	}

	return Array.from(keys);
}

export function getFinishedPlayedEpisodeRecords(
	playedEpisodes: PlayedEpisodeMap,
): PlayedEpisodeRecord[] {
	const recordsByEpisodeKey = new Map<string, PlayedEpisodeRecord>();
	const records = Object.entries(playedEpisodes);
	// Reads prefer a guid record to the title record, and twins' title record belongs to neither.
	const guidTitles = new Set(
		records
			.filter(([key]) => isGuidProgressKey(key))
			.map(([, episode]) => getPlayedEpisodeRecordKey(episode)),
	);

	for (const [key, episode] of records) {
		if (!episode.finished) continue;

		const byGuid = isGuidProgressKey(key);
		const episodeKey = byGuid ? key : getPlayedEpisodeRecordKey(episode);
		if (!byGuid && guidTitles.has(episodeKey)) continue;
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
