import type { Episode } from "src/types/Episode";
import { formatEpisodeTimestamp } from "src/utility/formatEpisodeTimestamp";
import type { IAPI } from "./IAPI";
import { TFile } from "obsidian";
import { plugin } from "src/store";
import { get } from "svelte/store";
import { formatPodcastSegment, normalizePodcastSegmentTimes } from "src/utility/podcastSegment";
import {
	adjustPlaybackRate,
	normalizePlaybackRate,
	PLAYBACK_RATE_STEP,
} from "src/utility/playbackRate";
import { getEpisodeTranscriptPath } from "src/utility/getEpisodeTranscriptPath";
import { normalizeSkipLength } from "src/utility/skipLength";
import { isPlaying } from "src/player/PlayerController";

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

	public get isPlaying(): boolean {
		return isPlaying(this.state.status);
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

		return formatEpisodeTimestamp(
			this.podcast,
			Math.max(0, this.currentTime - offsetSeconds),
			format,
			linkify,
		);
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

		const segment = normalizePodcastSegmentTimes(startTime, endTime);
		if (!segment) return formatPodcastSegment(startTime, endTime, format);

		return formatEpisodeTimestamp(
			this.podcast,
			segment.startTime,
			format,
			linkify,
			segment.endTime,
		);
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
		// An over-skip lands 0.25s short of the end, so a playing episode finishes and
		// the queue advances; a seek to the end itself would pause. Never let the clamp
		// move the position BACKWARD: when already within the last 0.25s, a forward
		// skip must not rewind, so keep at least the current time (PB-02 / Codex review
		// #213). With an unknown/zero duration (metadata not loaded) leave it unclamped.
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
