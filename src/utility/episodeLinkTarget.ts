import { downloadedEpisodes } from "src/store";
import type { Episode } from "src/types/Episode";
import { isLocalFile } from "./isLocalFile";

/**
 * The `url` of a PodNotes link to `episode`: a local file's own vault path, else the
 * path it is registered under, and the feed for any other episode. The URI handler
 * compares an incoming link's `url` with it, so links PodNotes writes find their episode.
 */
export function episodeLinkTarget(episode: Episode): string | undefined {
	if (!isLocalFile(episode)) return episode.feedUrl;
	return episode.filePath ?? downloadedEpisodes.getEpisode(episode)?.filePath;
}
