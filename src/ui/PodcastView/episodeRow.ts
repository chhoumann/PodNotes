import { downloadedCopy, offlinePlayable } from "src/player/source";
import type DownloadedEpisode from "src/types/DownloadedEpisode";
import type { Episode } from "src/types/Episode";
import type { PlayedEpisode } from "src/types/PlayedEpisode";
import { getEpisodeKey, isSameEpisode } from "src/utility/episodeKey";
import { getPlayedEpisode, type PlayedEpisodeMap } from "src/utility/episodeStatus";
import { isLocalFile } from "src/utility/isLocalFile";
import { getEpisodeMediaType, isSameMediaSource } from "src/utility/mediaType";

export type Downloads = Readonly<Record<string, readonly DownloadedEpisode[]>>;

/**
 * Whether a row plays. missing: a Played record whose episode left every feed.
 * not-downloaded: offline, with no vault file or downloaded copy to play.
 */
export type Availability = "available" | "missing" | "not-downloaded";

export function availabilityOf(
	episode: Episode,
	resolved: boolean,
	online: boolean,
	downloads: Downloads,
): Availability {
	if (!resolved) return "missing";
	return online || offlinePlayable(episode, downloads) ? "available" : "not-downloaded";
}

export interface RowState {
	readonly played: PlayedEpisodeMap;
	readonly downloads: Downloads;
	readonly now: Episode | undefined;
	readonly playing: boolean;
	readonly hasNote: boolean;
	/** Rows with a cover name the podcast, or a local file's folder, before the rest. */
	readonly cover: boolean;
	/** Whether the row shows the episode's date, unless it is under way in a cover row. */
	readonly date: boolean;
	readonly availability: Availability;
}

export interface EpisodeRowModel {
	/** A cover row's podcast name, or a local file's vault folder. */
	readonly source?: string;
	/** A local file in a cover row shows a tile with this icon instead of artwork. */
	readonly tile?: "music" | "video";
	readonly meta: readonly string[];
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

export function formatMinutes(seconds: number): string {
	const total = Math.max(1, Math.round(seconds / 60));
	return total >= 60 ? `${Math.floor(total / 60)} h ${total % 60} min` : `${total} min`;
}

/**
 * Whether `episode` is the player's. Same-titled episodes of one podcast share a key,
 * so their media tells them apart, as it does for the player.
 */
export function isCurrentEpisode(now: Episode | undefined, episode: Episode): boolean {
	return (
		now !== undefined &&
		isSameEpisode(now, episode) &&
		isSameMediaSource(now.streamUrl, episode.streamUrl)
	);
}

/** The episode's length: the feed's, else the one its Played record learned as it played. */
function durationOf(episode: Episode, record: PlayedEpisode | undefined): number {
	return episode.duration || record?.duration || 0;
}

/** What is left of an episode played part of the way. A finished one plays again from the start. */
function leftOf(record: PlayedEpisode | undefined): number | undefined {
	return record && !record.finished && record.time > 0 && record.duration > record.time
		? record.duration - record.time
		: undefined;
}

/** How long the episodes last, in seconds. Unknown lengths count as nothing. */
export function totalSeconds(episodes: readonly Episode[], played: PlayedEpisodeMap): number {
	return episodes.reduce(
		(sum, episode) => sum + durationOf(episode, getPlayedEpisode(played, episode)),
		0,
	);
}

/** The listening left in the episodes, in seconds: the rest of one under way, else its length. */
export function secondsLeft(episodes: readonly Episode[], played: PlayedEpisodeMap): number {
	return episodes.reduce((sum, episode) => {
		const record = getPlayedEpisode(played, episode);
		return sum + (leftOf(record) ?? durationOf(episode, record));
	}, 0);
}

/** The vault folder of a file, "/" at the vault's root. */
function folderOf(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash > 0 ? path.slice(0, slash) : "/";
}

export function episodeRowModel(episode: Episode, state: RowState): EpisodeRowModel {
	const record = getPlayedEpisode(state.played, episode);
	const played = record?.finished ?? false;
	const left = leftOf(record);
	const duration = durationOf(episode, record);
	const current = isCurrentEpisode(state.now, episode);
	const playing = current && state.playing;
	const local = isLocalFile(episode);
	const copy = downloadedCopy(state.downloads, episode);
	const downloaded = !local && copy !== undefined;
	const filePath = local ? (episode.filePath ?? copy?.filePath) : undefined;
	const time =
		left !== undefined
			? `${formatMinutes(left)} left`
			: duration
				? formatMinutes(duration)
				: undefined;
	const showDate = state.date && !current && !local && !(state.cover && left !== undefined);
	const meta = [
		current ? (playing ? "Playing" : "Paused") : undefined,
		showDate ? formatDate(episode.episodeDate) : undefined,
		time,
	].filter((part) => part !== undefined);
	const label = [
		episode.title,
		played && "played",
		left !== undefined && time,
		downloaded && "downloaded",
		state.hasNote && "has note",
		current && (playing ? "playing" : "paused"),
		state.availability === "missing" && "unavailable",
		state.availability === "not-downloaded" && "not downloaded",
	]
		.filter(Boolean)
		.join(", ");
	return {
		source:
			!state.cover || current
				? undefined
				: local
					? filePath && folderOf(filePath)
					: episode.podcastName,
		tile:
			state.cover && local
				? getEpisodeMediaType(episode) === "video"
					? "video"
					: "music"
				: undefined,
		meta,
		progress: left !== undefined && record ? record.time / record.duration : undefined,
		played,
		current,
		playing,
		downloaded,
		hasNote: state.hasNote,
		unavailable: state.availability !== "available",
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
