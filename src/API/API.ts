import { Episode } from "src/types/Episode";
import { formatSeconds } from "src/utility/formatSeconds";
import { IAPI } from "./IAPI";
import {
	currentEpisode,
	currentTime,
	downloadedEpisodes,
	duration,
	isPaused,
	plugin,
} from "src/store";
import { get } from "svelte/store";
import encodePodnotesURI from "src/utility/encodePodnotesURI";
import { isLocalFile } from "src/utility/isLocalFile";

export class API implements IAPI {
	public get podcast(): Episode {
		return get(currentEpisode);
	}

	public get length(): number {
		return get(duration);
	}

	public get currentTime(): number {
		return get(currentTime);
	}

	public set currentTime(value: number) {
		currentTime.update((_) => value);
	}

	public get isPlaying(): boolean {
		return !get(isPaused);
	}

	/**
	 * Gets the current time in the given moment format.
	 * @param format Moment format.
	 * @param linkify Linking to the podcast so PodNotes can open it at this time later.
	 * @returns
	 */
	getPodcastTimeFormatted(format: string, linkify = false): string {
		if (!this.podcast) {
			throw new Error("No podcast loaded");
		}

		const time = formatSeconds(this.currentTime, format);

		if (!linkify) return time;

		const epIsLocal = isLocalFile(this.podcast);
		const feedUrl = !epIsLocal
			? this.podcast.feedUrl
			: downloadedEpisodes.getEpisode(this.podcast)?.filePath;

		if (!feedUrl || feedUrl === "") {
			// Considered handling this as an error case, but I think
			// it's better UX to just show the time rather than getting an error.
			return time;
		}

		const url = encodePodnotesURI(
			this.podcast.title,
			feedUrl,
			this.currentTime
		);

		return `[${time}](${url.href})`;
	}

	start(): void {
		isPaused.update((_) => false);
	}

	stop(): void {
		isPaused.update((_) => true);
	}

	skipBackward(): void {
		const skipBackLen = get(plugin).settings.skipBackwardLength;
		this.currentTime -= skipBackLen;
	}

	skipForward(): void {
		const skipForwardLen = get(plugin).settings.skipForwardLength;
		this.currentTime += skipForwardLen;
	}
}
