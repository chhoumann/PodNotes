import type { Episode } from "src/types/Episode";
import { formatSeconds } from "src/utility/formatSeconds";
import type { IAPI } from "./IAPI";
import {
	currentEpisode,
	currentTime,
	downloadedEpisodes,
	duration,
	isPaused,
	plugin,
	volume as volumeStore,
} from "src/store";
import { get } from "svelte/store";
import encodePodnotesURI from "src/utility/encodePodnotesURI";
import { isLocalFile } from "src/utility/isLocalFile";

const clampVolume = (value: number): number =>
	Math.min(1, Math.max(0, value));

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

	public get volume(): number {
		return get(volumeStore);
	}

	public set volume(value: number) {
		volumeStore.set(clampVolume(value));
	}

	/**
	 * Gets the current time in the given moment format.
	 * @param format Moment format.
	 * @param linkify Linking to the podcast so PodNotes can open it at this time later.
	 * @param offsetSeconds Optional offset to subtract from the current playback time.
	 * @returns
	 */
	getPodcastTimeFormatted(
		format: string,
		linkify = false,
		offsetSeconds = 0,
	): string {
		if (!this.podcast) {
			throw new Error("No podcast loaded");
		}

		const adjustedTime = Math.max(0, this.currentTime - offsetSeconds);
		const time = formatSeconds(adjustedTime, format);

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
			adjustedTime,
		);

		return `[${time}](${url.href})`;
	}

	start(): void {
		isPaused.update((_) => false);
	}

	stop(): void {
		isPaused.update((_) => true);
	}

	togglePlayback(): void { 
		isPaused.update((isPaused) => !isPaused);
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
