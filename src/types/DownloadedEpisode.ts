import type { Episode } from "./Episode";

export default interface DownloadedEpisode extends Episode {
	filePath: string;
	size: number;
	/**
	 * Set only when PodNotes wrote the file itself. Older releases registered any
	 * file already at a download path, so an entry without it may point at the
	 * user's own file.
	 */
	downloadedByPodNotes?: true;
}
