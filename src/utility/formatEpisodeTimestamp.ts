import type { Episode } from "src/types/Episode";
import encodePodnotesURI from "./encodePodnotesURI";
import { episodeLinkTarget } from "./episodeLinkTarget";
import { formatSeconds } from "./formatSeconds";
import { formatPodcastSegment } from "./podcastSegment";
import { vaultSafeLinkTarget } from "src/services/privateFeeds";

export function formatEpisodeTimestamp(
	episode: Episode,
	seconds: number,
	format: string,
	linkify: boolean,
	endSeconds?: number,
): string {
	const time =
		endSeconds === undefined
			? formatSeconds(seconds, format)
			: formatPodcastSegment(seconds, endSeconds, format);
	const link = linkify ? episodeTimestampLink(episode, seconds, endSeconds) : "";
	return link ? `[${time}](${link})` : time;
}

/** The obsidian://podnotes link that plays `episode` from `seconds`, or "" when no link may address it. */
export function episodeTimestampLink(
	episode: Episode,
	seconds: number,
	endSeconds?: number,
): string {
	const target = vaultSafeLinkTarget(episode, episodeLinkTarget(episode));
	return target ? encodePodnotesURI(episode, target, seconds, endSeconds).href : "";
}
