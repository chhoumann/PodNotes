import type { Episode } from "src/types/Episode";
import { formatSeconds } from "src/utility/formatSeconds";
import type { IAPI } from "./IAPI";
import {
	currentEpisode,
	currentTime,
	downloadedEpisodes,
	duration,
	isPaused,
	activePlaybackSegment,
	playbackRate as playbackRateStore,
	plugin,
	volume as volumeStore,
} from "src/store";
import { get } from "svelte/store";
import encodePodnotesURI from "src/utility/encodePodnotesURI";
import { isLocalFile } from "src/utility/isLocalFile";
import {
	formatPodcastSegment,
	normalizePodcastSegmentTimes,
} from "src/utility/podcastSegment";
import {
	adjustPlaybackRate,
	normalizePlaybackRate,
	PLAYBACK_RATE_STEP,
} from "src/utility/playbackRate";

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
		activePlaybackSegment.set(null);
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

	public get playbackRate(): number {
		return get(playbackRateStore);
	}

	public set playbackRate(value: number) {
		playbackRateStore.set(normalizePlaybackRate(value, this.defaultPlaybackRate));
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

		const feedUrl = this.getEpisodeLinkTarget();

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

	getPodcastSegmentFormatted(
		format: string,
		startTime: number,
		endTime: number,
		linkify = false,
	): string {
		if (!this.podcast) {
			throw new Error("No podcast loaded");
		}

		const segmentTimes = normalizePodcastSegmentTimes(startTime, endTime);
		const segment = segmentTimes
			? formatPodcastSegment(
					segmentTimes.startTime,
					segmentTimes.endTime,
					format,
				)
			: formatPodcastSegment(startTime, endTime, format);

		if (!linkify || !segmentTimes) return segment;

		const feedUrl = this.getEpisodeLinkTarget();

		if (!feedUrl || feedUrl === "") {
			return segment;
		}

		const url = encodePodnotesURI(
			this.podcast.title,
			feedUrl,
			segmentTimes.startTime,
			segmentTimes.endTime,
		);

		return `[${segment}](${url.href})`;
	}

	private getEpisodeLinkTarget(): string | undefined {
		const epIsLocal = isLocalFile(this.podcast);
		return !epIsLocal
			? this.podcast.feedUrl
			: downloadedEpisodes.getEpisode(this.podcast)?.filePath;
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

	increasePlaybackRate(): void {
		playbackRateStore.update((rate) =>
			adjustPlaybackRate(rate, PLAYBACK_RATE_STEP),
		);
	}

	decreasePlaybackRate(): void {
		playbackRateStore.update((rate) =>
			adjustPlaybackRate(rate, -PLAYBACK_RATE_STEP),
		);
	}

	resetPlaybackRate(): void {
		this.playbackRate = this.defaultPlaybackRate;
	}

	private get defaultPlaybackRate(): number {
		return normalizePlaybackRate(get(plugin).settings.defaultPlaybackRate);
	}
}
