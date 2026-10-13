import type { Vault } from "obsidian";
import type DownloadedEpisode from "src/types/DownloadedEpisode";
import type { Episode, EpisodeMediaType } from "src/types/Episode";
import { createMediaUrlObjectFromFilePath } from "src/utility/createMediaUrlObjectFromFilePath";
import { isLocalFile } from "src/utility/isLocalFile";
import {
	getEpisodeMediaType,
	getEpisodeMediaTypeWithContainerHint,
	isSameMediaSource,
} from "src/utility/mediaType";

/** What one load plays. `src` is empty when there is nothing to play, such as a missing vault file. */
export interface PlaybackSource {
	src: string;
	mediaType: EpisodeMediaType;
	/** The vault file `src` plays, if it plays one. */
	filePath?: string;
}

/**
 * Plays the snapshot it is given, decided once per load:
 * 1. The snapshot's own vault `filePath` (a local file, a download snapshot) plays that file.
 * 2. Otherwise its `downloadedCopy` plays.
 * 3. Otherwise the stream plays.
 * A chosen file that is missing is an empty `src`, never a fall back to other audio.
 */
export function selectSource(
	episode: Episode,
	downloaded: { [podcastName: string]: DownloadedEpisode[] },
	vault: Vault,
): PlaybackSource {
	const ownPath = (episode as Partial<DownloadedEpisode>).filePath;
	if (ownPath) {
		return {
			src: createMediaUrlObjectFromFilePath(vault, ownPath),
			mediaType: getEpisodeMediaType(episode),
			filePath: ownPath,
		};
	}

	const copy = downloadedCopy(downloaded, episode);
	if (copy) {
		return {
			src: createMediaUrlObjectFromFilePath(vault, copy.filePath),
			mediaType: getEpisodeMediaTypeWithContainerHint(copy, episode.mediaType),
			filePath: copy.filePath,
		};
	}

	return { src: episode.streamUrl, mediaType: getEpisodeMediaType(episode) };
}

/**
 * The downloaded copy registered under the episode's podcast and title, when it is a copy of
 * the same media: its original stream URL matches, or the episode is a local file. A media
 * type the episode declares must agree. Same-titled episodes of one podcast share the
 * registration, so the media tells them apart.
 */
export function downloadedCopy(
	downloaded: Readonly<Record<string, readonly DownloadedEpisode[]>>,
	episode: Episode,
): DownloadedEpisode | undefined {
	const copy = downloaded[episode.podcastName]?.find((d) => d.title === episode.title);
	if (!copy?.filePath) return undefined;
	const sameMedia = isLocalFile(episode) || isSameMediaSource(copy.streamUrl, episode.streamUrl);
	const mediaType = getEpisodeMediaTypeWithContainerHint(copy, episode.mediaType);
	return sameMedia && (!episode.mediaType || mediaType === episode.mediaType) ? copy : undefined;
}

/** Whether the episode plays with no connection: its own vault file, or a downloaded copy. */
export function offlinePlayable(
	episode: Episode,
	downloaded: Readonly<Record<string, readonly DownloadedEpisode[]>>,
): boolean {
	return (
		Boolean((episode as Partial<DownloadedEpisode>).filePath) ||
		!!downloadedCopy(downloaded, episode)
	);
}
