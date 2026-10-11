import type { Vault } from "obsidian";
import { get, writable, type Readable, type Writable } from "svelte/store";
import { downloadedEpisodes, playedEpisodes, playlists, queue } from "src/store";
import { writePlayerSettings } from "src/store/persistence";
import type { Episode, EpisodeMediaType } from "src/types/Episode";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import type { PlayedEpisode } from "src/types/PlayedEpisode";
import { getEpisodeKey, isSameStoredEpisode } from "src/utility/episodeKey";
import { getEpisodeMediaType } from "src/utility/mediaType";
import { normalizePlaybackRate } from "src/utility/playbackRate";
import { selectSource, type MediaSource } from "./source";

export type PlayerStatus =
	| "empty"
	/** The selected episode at startup, paused at its saved position. No media is loaded. */
	| "restored"
	/** Media is loading and plays once ready. */
	| "loading"
	| "playing"
	| "paused"
	| "ended"
	| "error";

export interface PlayerState {
	status: PlayerStatus;
	episode: Episode | undefined;
	mediaType: EpisodeMediaType;
	/** Seconds. Before the media is ready, where playback will start. */
	currentTime: number;
	/** Seconds. Before the media is ready, the saved or the feed's duration. */
	duration: number;
	playbackRate: number;
	volume: number;
}

export interface PlayOptions {
	time?: number;
	/** Plays the segment from `time` to here, then stops, without saving progress. */
	endTime?: number;
}

export type PlayerHost = {
	settings: IPodNotesSettings;
	app: { vault: Vault };
	checkpoint(update: () => void): void;
	saveSettings(): Promise<void>;
};

export type PlayerDocument = Pick<Document, "createElement" | "body">;

/** One load of one episode. A load replaces it. */
interface Session {
	src: string;
	/** Where playback starts once the metadata loads. */
	pendingTime: number;
	/** The metadata loaded and the start position is set. */
	ready: boolean;
	segmentEnd: number | null;
	/** A segment link's session saves no progress and does not finish until a normal intent. */
	preview: boolean;
	lastCheckpoint: number;
}

const SAVE_POSITION_THROTTLE_MS = 5000;
/** HTMLMediaElement.HAVE_NOTHING: the element holds no media. */
const HAVE_NOTHING = 0;
/** A seek at or past the end stops this far short of it, so a seek never finishes an episode. */
const END_MARGIN_S = 0.25;
/** The media element's class, wherever it is. */
export const MEDIA_CLASS = "podnotes-media";

const isTime = (value: number) => Number.isFinite(value) && value >= 0;
const isOptionalTime = (value: number | undefined) => value === undefined || isTime(value);
const finiteOr0 = (value: number) => (Number.isFinite(value) ? value : 0);

/**
 * Owns the one media element, in the main window, from plugin load to unload.
 * Views render `state` and call the intents.
 *
 * Only an explicit `play` (and the queue advancing at a natural end) selects an
 * episode: it writes settings.currentEpisode and takes the episode out of the
 * queue. Restoring, resuming and saving progress never do.
 */
export class PlayerController {
	readonly state: Readable<PlayerState>;
	private readonly store: Writable<PlayerState>;
	private snapshot: PlayerState;
	private el: HTMLMediaElement;
	private session: Session | null = null;
	private stage: HTMLElement | null = null;
	/** Advanced by every intent that makes a deferred play stale. */
	private requests = 0;
	private disposed = false;

	constructor(
		private readonly doc: PlayerDocument,
		private readonly plugin: PlayerHost,
	) {
		const { defaultPlaybackRate, defaultVolume } = plugin.settings;
		this.snapshot = {
			status: "empty",
			episode: undefined,
			mediaType: "audio",
			currentTime: 0,
			duration: 0,
			playbackRate: normalizePlaybackRate(defaultPlaybackRate),
			volume: Number.isFinite(defaultVolume) ? Math.min(1, Math.max(0, defaultVolume)) : 1,
		};
		this.store = writable(this.snapshot);
		this.state = { subscribe: this.store.subscribe };
		this.el = this.createElement("audio");
		this.placeElement();
	}

	/**
	 * Shows the selected episode paused at its saved position, without loading it: at
	 * startup, and again after a sync while nothing is loaded. Loaded media stays.
	 */
	restore(episode: Episode | undefined): void {
		const { status } = this.snapshot;
		if (!episode || (status !== "empty" && status !== "restored")) return;
		this.setState({
			status: "restored",
			episode,
			mediaType: getEpisodeMediaType(episode),
			currentTime: this.resumeTime(episode),
			duration: this.savedProgress(episode)?.duration || episode.duration || 0,
		});
	}

	/**
	 * Selects and plays `episode`. Without a time it resumes where it was left, or
	 * from the start once finished. Switching away from another episode saves its
	 * position and queues it first when the queue is automatic.
	 */
	play(episode: Episode, { time, endTime }: PlayOptions = {}): boolean {
		if (this.disposed || !isOptionalTime(time) || !isOptionalTime(endTime)) return false;
		if (endTime !== undefined && (time === undefined || endTime <= time)) return false;
		this.requests++;

		const source = selectSource(episode, get(downloadedEpisodes), this.plugin.app.vault);
		const { status, episode: outgoing, currentTime, mediaType } = this.snapshot;
		const sameEpisode = !!outgoing && getEpisodeKey(outgoing) === getEpisodeKey(episode);
		this.select(episode);

		const session = this.session;
		if (
			session &&
			sameEpisode &&
			session.src === source.src &&
			mediaType === source.mediaType
		) {
			session.segmentEnd = endTime ?? null;
			session.preview = endTime !== undefined;
			if (time === undefined && status === "ended") this.moveTo(0);
			if (time === undefined || this.moveTo(time)) this.start();
			return true;
		}

		this.persist();
		if (
			outgoing &&
			!sameEpisode &&
			status !== "ended" &&
			this.plugin.settings.autoQueue !== false
		) {
			queue.prepend(outgoing);
		}
		const resumeAt = sameEpisode && status !== "ended" ? currentTime : this.resumeTime(episode);
		this.load(episode, source, time ?? resumeAt, endTime);
		return true;
	}

	/** Continues the current episode without selecting it. */
	resume(): void {
		const { status, episode, currentTime } = this.snapshot;
		if (this.disposed || !episode || status === "playing" || status === "loading") return;
		this.endPreview();
		if (!this.session) {
			const source = selectSource(episode, get(downloadedEpisodes), this.plugin.app.vault);
			this.load(episode, source, status === "ended" ? 0 : currentTime);
		} else {
			if (status === "ended") this.moveTo(0);
			this.start();
		}
	}

	pause(): void {
		if (this.disposed) return;
		this.requests++;
		const { status } = this.snapshot;
		if (status !== "playing" && status !== "loading") return;
		this.el.pause();
		this.settlePaused();
	}

	toggle(): void {
		const { status } = this.snapshot;
		if (status === "playing" || status === "loading") this.pause();
		else this.resume();
	}

	/**
	 * False, changing nothing, for a time that is not a finite number of seconds or
	 * with no episode. A time at or past the end stops just short of it and pauses.
	 */
	seek(time: number): boolean {
		if (this.disposed || !this.snapshot.episode || !isTime(time)) return false;
		this.endPreview();
		this.moveTo(time);
		return true;
	}

	setPlaybackRate(rate: number): void {
		if (this.disposed) return;
		const playbackRate = normalizePlaybackRate(rate, this.plugin.settings.defaultPlaybackRate);
		// A new load resets the rate to the default rate.
		this.el.playbackRate = this.el.defaultPlaybackRate = playbackRate;
		this.setState({ playbackRate });
	}

	/** The live volume is the saved default volume. */
	setVolume(volume: number): void {
		if (this.disposed || !Number.isFinite(volume)) return;
		const clamped = Math.min(1, Math.max(0, volume));
		this.el.volume = clamped;
		this.setState({ volume: clamped });
		writePlayerSettings(this.plugin, { defaultVolume: clamped });
	}

	/** Saves the position now rather than at the next checkpoint. */
	save(): void {
		this.persist();
	}

	/**
	 * For a play that waits on something first, such as a feed fetch. The returned
	 * function plays only if no newer play, pause or queue advance happened since.
	 */
	deferPlay(): (episode: Episode, options?: PlayOptions) => boolean {
		const request = ++this.requests;
		return (episode, options) => request === this.requests && this.play(episode, options);
	}

	/**
	 * A Svelte action for the view's video stage. The video plays inside the stage
	 * while the stage is in the main window, and hidden in the main window otherwise.
	 */
	readonly videoStage = (stage: HTMLElement): { destroy(): void } => {
		this.stage = stage;
		this.placeElement();
		const stopFollowingWindow = stage.onWindowMigrated?.(() => this.placeElement());
		return {
			destroy: () => {
				stopFollowingWindow?.();
				if (this.stage !== stage) return;
				this.stage = null;
				this.placeElement();
			},
		};
	};

	/** Saves the position, then releases the element. Every intent is a no-op afterwards. */
	dispose(): void {
		if (this.disposed) return;
		this.persist();
		this.requests++;
		this.disposed = true;
		this.session = null;
		this.release();
		this.el.remove();
	}

	private select(episode: Episode): void {
		writePlayerSettings(this.plugin, { currentEpisode: episode });
		queue.remove(episode);
	}

	private load(episode: Episode, source: MediaSource, time: number, endTime?: number): void {
		this.session = null;
		const duration = this.savedProgress(episode)?.duration || episode.duration || 0;
		if (!source.src) {
			this.release();
			this.setState({
				status: "error",
				episode,
				mediaType: source.mediaType,
				currentTime: time,
				duration,
			});
			return;
		}

		if (this.el.tagName.toLowerCase() !== source.mediaType) {
			this.release();
			this.el.remove();
			this.el = this.createElement(source.mediaType);
			this.placeElement();
		}
		this.session = {
			src: source.src,
			pendingTime: time,
			ready: false,
			segmentEnd: endTime ?? null,
			preview: endTime !== undefined,
			lastCheckpoint: Number.NEGATIVE_INFINITY,
		};
		this.setState({
			status: "loading",
			episode,
			mediaType: source.mediaType,
			currentTime: time,
			duration,
		});
		this.el.setAttribute("aria-label", episode.title);
		this.el.src = source.src;
		// In the intent's own call, so a mobile user's tap still counts as the gesture.
		this.playElement();
	}

	/** Stops the element and lets go of its media, which a removed element would keep. */
	private release(): void {
		this.el.removeAttribute("src");
		this.el.load();
	}

	private createElement(kind: EpisodeMediaType): HTMLMediaElement {
		const el = this.doc.createElement(kind);
		el.className = MEDIA_CLASS;
		if (kind === "video") el.setAttribute("playsinline", "");
		el.playbackRate = el.defaultPlaybackRate = this.snapshot.playbackRate;
		el.volume = this.snapshot.volume;
		const handlers: Record<string, () => void> = {
			loadedmetadata: () => this.onLoadedMetadata(),
			play: () => this.onPlay(),
			pause: () => this.onPause(),
			timeupdate: () => this.onTimeUpdate(),
			ended: () => this.onEnded(),
			emptied: () => this.onEmptied(),
			error: () => this.onError(),
		};
		for (const [type, handle] of Object.entries(handlers)) {
			// A replaced element's events are stale.
			el.addEventListener(type, () => {
				if (el === this.el && !this.disposed) handle();
			});
		}
		return el;
	}

	/** Removing a media element from its document pauses it; moving it does not. */
	private placeElement(): void {
		if (this.disposed) return;
		const { stage, el } = this;
		const staged = !!stage && stage.ownerDocument === this.doc && el.tagName === "VIDEO";
		if (staged && el.parentNode !== stage) stage.prepend(el);
		if (!staged && el.parentNode !== this.doc.body) this.doc.body.append(el);
		el.hidden = !staged;
	}

	/** play() unpauses the element at once, so the next intent can act on the new status. */
	private start(): void {
		const { status } = this.snapshot;
		if (status === "playing" || status === "loading") return;
		this.setState({ status: this.holdsMedia() ? "playing" : "loading" });
		this.playElement();
	}

	private playElement(): void {
		this.el.play().catch((error: unknown) => {
			// A pause, a newer load or an element reset aborts a play, and onEmptied
			// recovers a reset. Only a refusal, such as the autoplay policy, pauses.
			if (error instanceof DOMException && error.name === "AbortError") return;
			// A play that has since started, such as the next load's, keeps playing.
			const { status } = this.snapshot;
			if (this.disposed || !this.el.paused) return;
			if (status === "loading" || status === "playing") this.settlePaused();
		});
	}

	/**
	 * Moves the position, or the pending start before the media is ready. Returns
	 * false when the time was at or past the end and playback paused short of it.
	 */
	private moveTo(time: number): boolean {
		const session = this.session;
		const { duration, status: was } = this.snapshot;
		const status = was === "ended" ? "paused" : was;
		if (!this.holdsMedia()) {
			if (session) session.pendingTime = time;
			this.setState({ currentTime: time, status });
			return true;
		}

		const pastEnd = duration > 0 && time >= duration;
		this.el.currentTime = pastEnd ? Math.max(0, duration - END_MARGIN_S) : time;
		this.setState({ currentTime: this.el.currentTime, status });
		if (pastEnd && status === "playing") {
			this.el.pause();
			this.settlePaused();
		}
		return !pastEnd;
	}

	private endPreview(): void {
		if (!this.session) return;
		this.session.segmentEnd = null;
		this.session.preview = false;
	}

	private settlePaused(): void {
		this.setState(
			this.holdsMedia()
				? { status: "paused", currentTime: this.el.currentTime }
				: { status: "paused" },
		);
		this.persist();
	}

	private onLoadedMetadata(): void {
		const session = this.session;
		if (!session || session.ready) return;
		session.ready = true;
		// A reset element (see onEmptied) lost the play() of its load.
		if (this.snapshot.status === "loading" && this.el.paused) this.playElement();
		this.setState({
			status: this.el.paused ? "paused" : "playing",
			duration: finiteOr0(this.el.duration),
		});
		this.moveTo(session.pendingTime);
	}

	/**
	 * The element dropped its media without a load from us. Moving a media element
	 * to another window's document reloads it, which a video stage in a popout does.
	 * Start again where it was, playing if it played, back in the main window. A
	 * finished episode stays finished: its session ends, and resume() loads it again.
	 */
	private onEmptied(): void {
		const session = this.session;
		if (!session?.ready) return;
		if (this.snapshot.status === "ended") {
			this.session = null;
		} else {
			session.ready = false;
			session.pendingTime = this.snapshot.currentTime;
			if (this.snapshot.status === "playing") this.setState({ status: "loading" });
		}
		this.placeElement();
	}

	private onPlay(): void {
		if (this.holdsMedia() && !this.el.paused) this.setState({ status: "playing" });
	}

	private onPause(): void {
		if (this.snapshot.status === "playing" && this.el.paused) this.settlePaused();
	}

	private onTimeUpdate(): void {
		const session = this.session;
		if (!session || !this.holdsMedia()) return;
		const time = this.el.currentTime;
		if (session.segmentEnd !== null && time >= session.segmentEnd) {
			this.el.currentTime = session.segmentEnd;
			session.segmentEnd = null;
			this.el.pause();
			this.settlePaused();
			return;
		}

		this.setState({ currentTime: time, duration: finiteOr0(this.el.duration) });
		const now = Date.now();
		if (now - session.lastCheckpoint < SAVE_POSITION_THROTTLE_MS) return;
		session.lastCheckpoint = now;
		this.plugin.checkpoint(() => this.persist());
	}

	/** A natural end: marks the episode played, takes it out of every list, then plays the queue's next. */
	private onEnded(): void {
		const session = this.session;
		const { status, episode } = this.snapshot;
		if (!session || !this.holdsMedia() || !episode || status === "ended") return;
		if (session.preview) {
			session.segmentEnd = null;
			this.settlePaused();
			return;
		}

		this.setState({ status: "ended", currentTime: this.el.currentTime });
		playedEpisodes.markAsPlayed(episode);
		playlists.update((lists) => {
			for (const playlist of Object.values(lists)) {
				playlist.episodes = playlist.episodes.filter(
					(e) => !isSameStoredEpisode(e, episode),
				);
			}
			return lists;
		});
		queue.remove(episode);

		const next = get(queue).episodes[0];
		if (!next || this.plugin.settings.autoQueue === false) return;
		this.requests++;
		this.select(next);
		this.load(
			next,
			selectSource(next, get(downloadedEpisodes), this.plugin.app.vault),
			this.resumeTime(next),
		);
	}

	/** Saved progress stays as it was. */
	private onError(): void {
		if (!this.session) return;
		this.session = null;
		this.setState({ status: "error" });
	}

	/** The current load set its start position, and the element still holds its media. */
	private holdsMedia(): boolean {
		return !!this.session?.ready && this.el.readyState > HAVE_NOTHING;
	}

	private persist(): void {
		const { session } = this;
		const { episode, duration } = this.snapshot;
		if (!session || !this.holdsMedia() || session.preview || this.disposed || !episode) return;
		const time = this.el.currentTime;
		playedEpisodes.setEpisodeTime(episode, time, duration, duration > 0 && time >= duration);
	}

	/** The composite key's record, else a legacy title-only record that does not name another podcast. */
	private savedProgress(episode: Episode): PlayedEpisode | undefined {
		const played = get(playedEpisodes);
		const legacy = played[episode.title];
		return (
			played[getEpisodeKey(episode)] ??
			(legacy &&
			(!legacy.podcastName ||
				!episode.podcastName ||
				legacy.podcastName === episode.podcastName)
				? legacy
				: undefined)
		);
	}

	private resumeTime(episode: Episode): number {
		const saved = this.savedProgress(episode);
		if (!saved || saved.finished || (saved.duration > 0 && saved.time >= saved.duration)) {
			return 0;
		}
		return saved.time;
	}

	private setState(patch: Partial<PlayerState>): void {
		this.snapshot = { ...this.snapshot, ...patch };
		this.store.set(this.snapshot);
	}
}
