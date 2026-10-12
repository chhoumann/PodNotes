import type { Episode } from "src/types/Episode";
import encodePodnotesURI from "./encodePodnotesURI";
import { episodeLinkTarget } from "./episodeLinkTarget";
import { formatSeconds } from "./formatSeconds";

/**
 * `seconds` in `format`, and with `linkify` a PodNotes link that opens `episode`
 * at exactly `seconds`. An episode PodNotes cannot link to, such as an old
 * snapshot without a feed URL, gets the plain time.
 */
export function formatEpisodeTimestamp(
	episode: Episode,
	seconds: number,
	format: string,
	linkify: boolean,
): string {
	const time = formatSeconds(seconds, format);
	const target = linkify ? episodeLinkTarget(episode) : undefined;
	return target ? `[${time}](${encodePodnotesURI(episode.title, target, seconds).href})` : time;
}
