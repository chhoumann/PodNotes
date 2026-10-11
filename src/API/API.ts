import type { Episode } from "src/types/Episode";
import { formatSeconds } from "src/utility/formatSeconds";
import type { IAPI } from "./IAPI";
import { TFile } from "obsidian";
import { plugin } from "src/store";
import { get } from "svelte/store";
import encodePodnotesURI from "src/utility/encodePodnotesURI";
import { episodeLinkTarget } from "src/utility/episodeLinkTarget";
import { formatPodcastSegment, normalizePodcastSegmentTimes } from "src/utility/podcastSegment";
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

export class API implements IAPI {
	private get player() {
		return get(plugin).player;
	}

	private get state() {
		return get(this.player.state);
	}

	public get podcast(): Episode {
		return this.state.episode as Episode;
	}

	public get transcript(): Promise<string | null> {
		return this.getTranscript();
	}

	public get length(): number {
		return this.state.duration;
	}

	public get currentTime(): number {
		return this.state.currentTime;
	}

	public set currentTime(value: number) {
		this.player.seek(value);
	}

	/** True while loading too: it plays once the media is ready, and Stop can cancel that. */
	public get isPlaying(): boolean {
		const { status } = this.state;
		return status === "playing" || status === "loading";
	}

	public get volume(): number {
		return this.state.volume;
	}

	public set volume(value: number) {
		this.player.setVolume(value);
	}

	public get playbackRate(): number {
		return this.state.playbackRate;
	}

	public set playbackRate(value: number) {
		this.player.setPlaybackRate(value);
	}

	/**
	 * Gets the current time in the given moment format.
	 * @param format Moment format.
	 * @param linkify Linking to the podcast so PodNotes can open it at this time later.
	 * @param offsetSeconds Optional offset to subtract from the current playback time.
	 * @returns
	 */
	getPodcastTimeFormatted(format: string, linkify = false, offsetSeconds = 0): string {
		if (!this.podcast) {
			throw new Error("No podcast loaded");
		}

		const adjustedTime = Math.max(0, this.currentTime - offsetSeconds);
		const time = formatSeconds(adjustedTime, format);

		if (!linkify) return time;

		const target = episodeLinkTarget(this.podcast);

		if (!target) {
			// Considered handling this as an error case, but I think
			// it's better UX to just show the time rather than getting an error.
			return time;
		}

		const url = encodePodnotesURI(this.podcast.title, target, adjustedTime);

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
			? formatPodcastSegment(segmentTimes.startTime, segmentTimes.endTime, format)
			: formatPodcastSegment(startTime, endTime, format);

		if (!linkify || !segmentTimes) return segment;

		const target = episodeLinkTarget(this.podcast);

		if (!target) {
			return segment;
		}

		const url = encodePodnotesURI(
			this.podcast.title,
			target,
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
		const transcriptFile = pluginInstance.app.vault.getAbstractFileByPath(transcriptPath);

		if (!(transcriptFile instanceof TFile)) {
			return null;
		}

		return await pluginInstance.app.vault.read(transcriptFile);
	}

	start(): void {
		this.player.resume();
	}

	stop(): void {
		this.player.pause();
	}

	togglePlayback(): void {
		this.player.toggle();
	}

	skipBackward(): void {
		const skipBackLen = normalizeSkipLength(get(plugin).settings.skipBackwardLength);
		// Never seek before the start. A cleared settings field (NaN/null) falls
		// back to the default rather than corrupting currentTime (PB-02).
		this.currentTime = Math.max(0, this.currentTime - skipBackLen);
	}

	skipForward(): void {
		const skipForwardLen = normalizeSkipLength(get(plugin).settings.skipForwardLength);
		const target = this.currentTime + skipForwardLen;
		const dur = this.length;
		// An over-skip lands 0.25s short of the end and keeps playing, so the episode
		// finishes and the queue advances; a seek to the end itself would pause. Never
		// let the clamp move the position BACKWARD: when already within the last 0.25s,
		// a forward skip must not rewind, so keep at least the current time (PB-02 /
		// Codex review #213). With an unknown/zero duration (metadata not loaded)
		// leave it unclamped.
		this.currentTime =
			dur > 0 ? Math.max(this.currentTime, Math.min(target, dur - 0.25)) : target;
	}

	increasePlaybackRate(): void {
		this.playbackRate = adjustPlaybackRate(this.playbackRate, PLAYBACK_RATE_STEP);
	}

	decreasePlaybackRate(): void {
		this.playbackRate = adjustPlaybackRate(this.playbackRate, -PLAYBACK_RATE_STEP);
	}

	resetPlaybackRate(): void {
		this.playbackRate = this.defaultPlaybackRate;
	}

	private get defaultPlaybackRate(): number {
		return normalizePlaybackRate(get(plugin).settings.defaultPlaybackRate);
	}
}
