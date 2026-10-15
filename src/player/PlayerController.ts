import type { Vault } from "obsidian";
import { get, writable, type Readable, type Writable } from "svelte/store";
import { downloadedEpisodes, playedEpisodes, playlists, queue } from "src/store";
import { writePlayerSettings } from "src/store/persistence";
import type { Episode, EpisodeMediaType } from "src/types/Episode";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import type { PlayedEpisode } from "src/types/PlayedEpisode";
import { createMediaUrlObjectFromFilePath } from "src/utility/createMediaUrlObjectFromFilePath";
import { getEpisodeKey, isSameStoredEpisode } from "src/utility/episodeKey";
import { getPlayedEpisode } from "src/utility/episodeStatus";
import { getEpisodeMediaType } from "src/utility/mediaType";
import { normalizePlaybackRate } from "src/utility/playbackRate";
import { isPrivateFeedPlaceholder } from "src/utility/privateFeedUrl";
import { selectSource, type PlaybackSource } from "./source";

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

/** A loading episode plays once ready, so it counts as playing: it shows Pause, and Stop cancels the load. */
export function isPlaying(status: PlayerStatus): status is "playing" | "loading" {
	return status === "playing" || status === "loading";
}

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
	/** The vault file `src` plays, if it plays one. */
	filePath?: string;
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
export const END_MARGIN_S = 0.25;
/** The media element's class, wherever it is. */
export const MEDIA_CLASS = "podnotes-media";

const isTime = (value: number) => Number.isFinite(value) && value >= 0;
const isOptionalTime = (value: number | undefined) => value === undefined || isTime(value);
const finiteOr0 = (value: number) => (Number.isFinite(value) ? value : 0);

function savedProgress(episode: Episode): PlayedEpisode | undefined {
	return getPlayedEpisode(get(playedEpisodes), episode);
}

function resumeTime(episode: Episode): number {
	const saved = savedProgress(episode);
	if (!saved || saved.finished || (saved.duration > 0 && saved.time >= saved.duration)) {
		return 0;
	}
	return saved.time;
}

/** The length shown until the metadata loads. */
function startDuration(episode: Episode): number {
	return savedProgress(episode)?.duration || episode.duration || 0;
}

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
	/** The user moved the position and it is not saved yet: a new load starts there, not at the saved progress. */
	private moved = false;
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

	restore(episode: Episode | undefined): void {
		this.noteStoppedMove();
		const { status, episode: shown, currentTime } = this.snapshot;
		if (status === "paused" && shown && !this.moved) {
			const time = resumeTime(shown);
			if (time !== currentTime) this.moveTo(time);
			return;
		}
		if (!episode || (status !== "empty" && status !== "restored")) return;
		this.moved &&= !!shown && getEpisodeKey(shown) === getEpisodeKey(episode);
		this.setState({
			status: "restored",
			episode,
			mediaType: getEpisodeMediaType(episode),
			currentTime: this.moved ? currentTime : resumeTime(episode),
			duration: startDuration(episode),
		});
	}

	/**
	 * Follows a vault file that moved from `from` to `to`: shows the episode `moved` maps
	 * the shown one to, and media loaded from that file reloads from `to`, with the same
	 * status, position and speed. A finished episode's session ends. Not
	 * an intent: nothing is selected, queued or saved, and a deferred play stays valid.
	 */
	relocate(from: string, to: string, moved: (episode: Episode) => Episode): void {
		const shown = this.snapshot.episode;
		if (this.disposed || !shown) return;
		const episode = moved(shown);
		const session = this.session?.filePath === from ? this.session : null;
		if (episode === shown && !session) return;
		this.setState(
			this.holdsMedia() ? { episode, currentTime: this.el.currentTime } : { episode },
		);
		if (!session) return;
		session.src = createMediaUrlObjectFromFilePath(this.plugin.app.vault, to);
		session.filePath = to;
		this.el.setAttribute("aria-label", episode.title);
		this.el.src = session.src;
		// The element reports "emptied" only later, so the next intent would act on stale state.
		this.onEmptied();
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
		this.noteStoppedMove();
		const { status, episode: outgoing, mediaType } = this.snapshot;
		const sameEpisode = !!outgoing && getEpisodeKey(outgoing) === getEpisodeKey(episode);
		this.select(episode);

		const session = this.session;
		if (
			session &&
			sameEpisode &&
			session.src === source.src &&
			mediaType === source.mediaType
		) {
			// The loaded copy may carry a private feed's secret URL, as when it was opened
			// before its feed was subscribed. The subscription's copy replaces it; a copy
			// with the secret never replaces one without.
			if (
				isPrivateFeedPlaceholder(episode.feedUrl ?? "") &&
				!isPrivateFeedPlaceholder(outgoing?.feedUrl ?? "")
			) {
				this.setState({ episode });
			}
			session.segmentEnd = endTime ?? null;
			session.preview = endTime !== undefined;
			const at = time ?? (status === "ended" ? resumeTime(episode) : undefined);
			if (time !== undefined) this.moved = true;
			if (at === undefined || this.moveTo(at)) this.start();
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
		const resumeAt = sameEpisode ? this.restartTime(episode) : resumeTime(episode);
		this.load(episode, source, time ?? resumeAt, endTime);
		this.moved = time !== undefined || (sameEpisode && this.moved);
		return true;
	}

	/**
	 * Plays the queue's next episode other than the current one. The episode it leaves
	 * goes last rather than first, so pressing again moves on through the queue.
	 */
	playNext(): void {
		const outgoing = this.snapshot.episode;
		const key = getEpisodeKey(outgoing);
		const next = get(queue).episodes.find((episode) => getEpisodeKey(episode) !== key);
		if (!next || !this.play(next) || !outgoing) return;
		const [first] = get(queue).episodes;
		if (first && getEpisodeKey(first) === key) {
			queue.remove(first);
			queue.add(first);
		}
	}

	/** Continues the current episode without selecting it. */
	resume(): void {
		if (this.disposed) return;
		this.noteStoppedMove();
		const { status, episode } = this.snapshot;
		if (!episode) return;
		this.requests++;
		if (status === "playing" || status === "loading") return;
		this.endPreview();
		if (!this.session) {
			const source = selectSource(episode, get(downloadedEpisodes), this.plugin.app.vault);
			this.load(episode, source, this.restartTime(episode));
		} else if (status !== "ended" || this.moveTo(resumeTime(episode))) {
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
		this.requests++;
		this.endPreview();
		this.moved = true;
		this.moveTo(time);
		return true;
	}

	setPlaybackRate(rate: number): void {
		if (this.disposed) return;
		const playbackRate = normalizePlaybackRate(rate, this.plugin.settings.defaultPlaybackRate);
		// The browser's own reload of the element, as in a popout's video stage, resets
		// the rate to the element's default rate.
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
	 * function plays only if no newer play, resume, pause, seek or queue advance happened since.
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

	private load(episode: Episode, source: PlaybackSource, time: number, endTime?: number): void {
		this.session = null;
		const duration = startDuration(episode);
		const shown = this.snapshot.episode;
		// Reloading the shown episode, as on its first play after a restart, keeps the user's speed.
		const playbackRate =
			shown && getEpisodeKey(shown) === getEpisodeKey(episode)
				? this.snapshot.playbackRate
				: normalizePlaybackRate(this.plugin.settings.defaultPlaybackRate);
		if (!source.src) {
			this.release();
			this.setState({
				status: "error",
				episode,
				mediaType: source.mediaType,
				currentTime: time,
				duration,
				playbackRate,
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
			filePath: source.filePath,
			pendingTime: time,
			ready: false,
			segmentEnd: endTime ?? null,
			preview: endTime !== undefined,
			lastCheckpoint: Number.NEGATIVE_INFINITY,
		};
		this.el.playbackRate = this.el.defaultPlaybackRate = playbackRate;
		this.setState({
			status: "loading",
			episode,
			mediaType: source.mediaType,
			currentTime: time,
			duration,
			playbackRate,
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
		this.persist();
		this.setState(
			this.holdsMedia()
				? { status: "paused", currentTime: this.el.currentTime }
				: { status: "paused" },
		);
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
			this.release();
		} else {
			session.ready = false;
			session.pendingTime = this.snapshot.currentTime;
			if (this.snapshot.status === "playing") this.setState({ status: "loading" });
		}
		this.placeElement();
	}

	private onPlay(): void {
		const { status } = this.snapshot;
		if (!this.holdsMedia() || this.el.paused) return;
		// A play the player did not start, such as from a media key, is the user's.
		if (status !== "playing" && status !== "loading") this.requests++;
		this.setState({ status: "playing" });
	}

	/** A reset pauses without this event (see onEmptied), so a pause while loading is a real one. */
	private onPause(): void {
		const { status } = this.snapshot;
		if ((status !== "playing" && status !== "loading") || !this.el.paused) return;
		// A pause the player did not make and no natural end made, such as from a media key.
		if (!this.el.ended) this.requests++;
		this.settlePaused();
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

		this.noteStoppedMove();
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
			resumeTime(next),
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

	private noteStoppedMove(): void {
		const { status, currentTime } = this.snapshot;
		const time = this.el.currentTime;
		if (status === "playing" || !this.holdsMedia() || time === currentTime) return;
		this.moved = true;
		this.setState({ currentTime: time, status: status === "ended" ? "paused" : status });
	}

	private persist(): void {
		const { session } = this;
		const { episode, duration, status } = this.snapshot;
		if (!session || !this.holdsMedia() || session.preview || this.disposed || !episode) return;
		this.noteStoppedMove();
		if (status !== "playing" && !this.moved) return;
		const time = this.el.currentTime;
		playedEpisodes.setEpisodeTime(episode, time, duration, duration > 0 && time >= duration);
		this.moved = false;
	}

	/**
	 * Where the shown episode starts on a new load: where it is while a session holds it
	 * or after the user moved it, else at its saved progress, which a sync may have changed.
	 */
	private restartTime(episode: Episode): number {
		const { status, currentTime } = this.snapshot;
		const live = status !== "ended" && (!!this.session || this.moved);
		return live ? currentTime : resumeTime(episode);
	}

	private setState(patch: Partial<PlayerState>): void {
		this.snapshot = { ...this.snapshot, ...patch };
		this.store.set(this.snapshot);
	}
}
