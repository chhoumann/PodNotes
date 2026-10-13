import type { Episode } from "src/types/Episode";
import encodePodnotesURI from "./encodePodnotesURI";
import { episodeLinkTarget } from "./episodeLinkTarget";
import { formatSeconds } from "./formatSeconds";
import { formatPodcastSegment } from "./podcastSegment";

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
	const target = linkify ? episodeLinkTarget(episode) : undefined;
	return target
		? `[${time}](${encodePodnotesURI(episode, target, seconds, endSeconds).href})`
		: time;
}
