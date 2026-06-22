import type { Episode } from "src/types/Episode";
import { formatSeconds } from "src/utility/formatSeconds";
import type { IAPI } from "./IAPI";
import { TFile } from "obsidian";
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
import { getEpisodeTranscriptPath } from "src/utility/getEpisodeTranscriptPath";

// Default used when a persisted/configured skip length is missing or invalid
// (e.g. a cleared settings field serialized to null/NaN). Mirrors
// DEFAULT_SETTINGS.skip*Length.
const DEFAULT_SKIP_LENGTH = 15;

const normalizeSkipLength = (length: number): number =>
	Number.isFinite(length) && length > 0 ? length : DEFAULT_SKIP_LENGTH;

// A non-finite volume (e.g. api.volume = NaN) must never poison the player, which
// two-way binds the store onto the media element. Fall back to the current value
// (itself clamped) so a bad write is a no-op rather than corrupting playback.
const clampVolume = (value: number, fallback = 1): number => {
	const safeFallback = Number.isFinite(fallback)
		? Math.min(1, Math.max(0, fallback))
		: 1;
	return Number.isFinite(value)
		? Math.min(1, Math.max(0, value))
		: safeFallback;
};

export class API implements IAPI {
	public get podcast(): Episode {
		return get(currentEpisode);
	}

	public get transcript(): Promise<string | null> {
		return this.getTranscript();
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
		volumeStore.set(clampVolume(value, get(volumeStore)));
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

	async getTranscript(episode = this.podcast): Promise<string | null> {
		if (!episode) {
			return null;
		}

		const pluginInstance = get(plugin);
		const transcriptPath = getEpisodeTranscriptPath(
			episode,
			pluginInstance.settings.transcript.path,
		);
		const transcriptFile =
			pluginInstance.app.vault.getAbstractFileByPath(transcriptPath);

		if (!(transcriptFile instanceof TFile)) {
			return null;
		}

		return await pluginInstance.app.vault.read(transcriptFile);
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
		const skipBackLen = normalizeSkipLength(
			get(plugin).settings.skipBackwardLength,
		);
		// Never seek before the start. A cleared settings field (NaN/null) falls
		// back to the default rather than corrupting currentTime (PB-02).
		this.currentTime = Math.max(0, this.currentTime - skipBackLen);
	}

	skipForward(): void {
		const skipForwardLen = normalizeSkipLength(
			get(plugin).settings.skipForwardLength,
		);
		const target = this.currentTime + skipForwardLen;
		const dur = this.length;
		// Clamp just short of the end so an over-skip lands at the end instead of
		// firing 'ended' and auto-advancing the queue. Never let the clamp move the
		// position BACKWARD: when already within the last 0.25s, a forward skip must
		// not rewind, so keep at least the current time (PB-02 / Codex review #213).
		// With an unknown/zero duration (metadata not loaded) leave it unclamped.
		this.currentTime =
			dur > 0
				? Math.max(this.currentTime, Math.min(target, dur - 0.25))
				: target;
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
