import type DownloadedEpisode from "src/types/DownloadedEpisode";
import type { Episode } from "src/types/Episode";
import { getEpisodeKey, isSameEpisode } from "src/utility/episodeKey";
import { getPlayedEpisode, type PlayedEpisodeMap } from "src/utility/episodeStatus";
import { isLocalFile } from "src/utility/isLocalFile";

export type Downloads = Readonly<Record<string, readonly DownloadedEpisode[]>>;

export interface RowState {
	readonly played: PlayedEpisodeMap;
	readonly downloads: Downloads;
	/** The player's episode, and whether it is playing. */
	readonly now: Episode | undefined;
	readonly playing: boolean;
	readonly hasNote: boolean;
	/** Rows with a cover name the podcast instead of the date. */
	readonly cover: boolean;
	/** False for a Played record whose episode left every feed. */
	readonly available: boolean;
}

/** What an episode row shows, and the label that says it. */
export interface EpisodeRowModel {
	/** "Playing" or "Paused", the date, then the duration or the time left. */
	readonly meta: readonly string[];
	/** The share listened to, while in progress. */
	readonly progress?: number;
	readonly played: boolean;
	readonly current: boolean;
	readonly playing: boolean;
	readonly downloaded: boolean;
	readonly hasNote: boolean;
	readonly unavailable: boolean;
	readonly label: string;
}

const MONTH_DAY = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const FULL_DATE = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	year: "numeric",
});

function formatDate(value: Date | string | undefined): string | undefined {
	const date = value === undefined ? undefined : new Date(value);
	if (!date || Number.isNaN(date.getTime())) return undefined;
	return (date.getFullYear() === new Date().getFullYear() ? MONTH_DAY : FULL_DATE).format(date);
}

/** "48 min", "1 h 3 min". */
export function formatMinutes(seconds: number): string {
	const total = Math.max(1, Math.round(seconds / 60));
	return total >= 60 ? `${Math.floor(total / 60)} h ${total % 60} min` : `${total} min`;
}

export function isDownloaded(downloads: Downloads, episode: Episode): boolean {
	return downloads[episode.podcastName]?.some(({ title }) => title === episode.title) ?? false;
}

export function episodeRowModel(episode: Episode, state: RowState): EpisodeRowModel {
	const record = getPlayedEpisode(state.played, episode);
	const played = record?.finished ?? false;
	const inProgress =
		!played && record !== undefined && record.time > 0 && record.duration > record.time;
	const left = inProgress ? record.duration - record.time : undefined;
	const current = state.now !== undefined && isSameEpisode(state.now, episode);
	const playing = current && state.playing;
	const local = isLocalFile(episode);
	const downloaded = !local && isDownloaded(state.downloads, episode);
	const time =
		left !== undefined
			? `${formatMinutes(left)} left`
			: episode.duration
				? formatMinutes(episode.duration)
				: undefined;
	const meta = [
		current ? (playing ? "Playing" : "Paused") : undefined,
		current || state.cover || local ? undefined : formatDate(episode.episodeDate),
		time,
	].filter((part) => part !== undefined);
	const label = [
		episode.title,
		played && "played",
		left !== undefined && time,
		downloaded && "downloaded",
		state.hasNote && "has note",
		current && (playing ? "playing" : "paused"),
		!state.available && "unavailable",
	]
		.filter(Boolean)
		.join(", ");
	return {
		meta,
		progress: inProgress ? record.time / record.duration : undefined,
		played,
		current,
		playing,
		downloaded,
		hasNote: state.hasNote,
		unavailable: !state.available,
		label,
	};
}

/**
 * `{#each}` keys. Episode keys repeat for same-titled episodes of one podcast,
 * so a repeat gets a suffix. It starts with NUL, which feed text cannot contain
 * (see episodeKey.ts), so a suffixed key never equals another episode's key and
 * rows stay put as the list changes.
 */
export function rowKeys<T extends { episode: Episode }>(entries: readonly T[]): [string, T][] {
	const keys = new Set<string>();
	return entries.map((entry) => {
		const key = getEpisodeKey(entry.episode);
		let row = key;
		for (let repeat = 1; keys.has(row); repeat++) row = `${key}\u0000${repeat}`;
		keys.add(row);
		return [row, entry];
	});
}
