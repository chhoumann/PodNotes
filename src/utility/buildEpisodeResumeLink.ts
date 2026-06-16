import type { Episode } from "src/types/Episode";
import type { LocalEpisode } from "src/types/LocalEpisode";
import { downloadedEpisodes } from "src/store";
import encodePodnotesURI from "./encodePodnotesURI";
import { isLocalFile } from "./isLocalFile";

/**
 * Build an `obsidian://podnotes` deep link that reopens `episode` in the PodNotes
 * player. Unlike a timestamp link, this link carries NO `time`, so URIHandler
 * resumes from the last played location at click time (or the start when the
 * episode has never been played). See issue #35.
 *
 * The link's `url` is how the player rediscovers the episode, mirroring
 * API.getPodcastTimeFormatted: a streamed episode is addressed by its feed URL
 * (the player refetches the feed and matches by title); a local/downloaded
 * episode is addressed by its on-disk vault path. Returns "" when neither is
 * known, so a template degrades to an empty value rather than a broken link.
 */
export default function buildEpisodeResumeLink(episode: Episode): string {
	const target = isLocalFile(episode)
		? (episode as LocalEpisode).filePath ??
			downloadedEpisodes.getEpisode(episode)?.filePath
		: episode.feedUrl;

	if (!target) return "";

	return encodePodnotesURI(episode.title, target).href;
}
