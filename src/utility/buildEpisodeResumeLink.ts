import type { Episode } from "src/types/Episode";
import { downloadedEpisodes } from "src/store";
import encodePodnotesURI from "./encodePodnotesURI";
import { episodeLinkTarget } from "./episodeLinkTarget";
import { vaultSafeFeedUrl } from "./privateFeedUrl";

/**
 * Build an `obsidian://podnotes` deep link that reopens `episode` in the PodNotes
 * player. Unlike a timestamp link, this link carries NO `time`, so URIHandler
 * resumes from the last played location at click time (or the start when the
 * episode has never been played). See issue #35.
 *
 * The link's `url` is how the player rediscovers the episode, mirroring
 * API.getPodcastTimeFormatted: a streamed episode is addressed by its feed URL
 * (the player refetches the feed and matches by title); a local file is
 * addressed by its on-disk vault path. As a last resort either kind falls back
 * to a downloaded copy's path, so an episode whose snapshot predates `feedUrl`
 * still gets a working link instead of none. Returns "" when the target is a private feed
 * without a subscription placeholder, or nothing can address the episode.
 */
export default function buildEpisodeResumeLink(episode: Episode): string {
	const target = vaultSafeFeedUrl(
		episodeLinkTarget(episode) ?? downloadedEpisodes.getEpisode(episode)?.filePath,
	);

	// URIHandler rejects an empty episodeName, so without a title there is no
	// working link to emit: degrade to "" rather than a dead link (UR-03).
	if (!target || !episode.title) return "";

	return encodePodnotesURI(episode, target).href;
}
