import { get, type Unsubscriber } from "svelte/store";
import { queue } from "src/store";
import type { Chapter } from "src/types/Chapter";
import type { Episode } from "src/types/Episode";
import type { NextTrackAction, PreviousTrackAction } from "src/types/Headset";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import { getEpisodeKey } from "src/utility/episodeKey";
import type { PlayerController, PlayerState, PlayerStatus } from "./PlayerController";

interface MediaSessionHost {
	mediaSession: MediaSession | undefined;
	MediaMetadata: typeof MediaMetadata | undefined;
	/** Read on each press, so a mapping changed in Settings or synced in needs no rebind. */
	settings(): Pick<IPodNotesSettings, "headsetPreviousTrack" | "headsetNextTrack">;
	captureTimestamp(): void;
	skipBackward(): void;
	skipForward(): void;
	/** The episode's chapters, in order, or none when they cannot be loaded. */
	chapters(url: string): Promise<Chapter[]>;
}

/** Previous chapter restarts the current one until this far into it. */
const CHAPTER_RESTART_S = 2;
/** Next chapter skips a start this close ahead, where a seek to a chapter can land. */
const CHAPTER_TOLERANCE_S = 0.25;

const PLAYBACK_STATES: Record<PlayerStatus, MediaSessionPlaybackState> = {
	empty: "none",
	restored: "none",
	loading: "playing",
	playing: "playing",
	paused: "paused",
	ended: "paused",
	error: "none",
};

/**
 * Browsers implement Media Session in part. Each call stands alone, and none may
 * throw: a throwing subscriber leaves Svelte's shared queue stuck for every store.
 */
function attempt(call: () => void): boolean {
	try {
		call();
		return true;
	} catch {
		return false;
	}
}

const isPositive = (value: number) => Number.isFinite(value) && value > 0;

/** Where next (1) or previous (-1) chapter goes from `time`, or nowhere. */
export function chapterStart(
	chapters: readonly Chapter[],
	time: number,
	direction: 1 | -1,
): number | undefined {
	if (direction === 1) {
		return chapters.find(({ startTime }) => startTime > time + CHAPTER_TOLERANCE_S)?.startTime;
	}
	let start = 0;
	for (const { startTime } of chapters) {
		if (startTime > time - CHAPTER_RESTART_S) break;
		start = startTime;
	}
	return start;
}

function positionOf({ currentTime, duration, playbackRate }: PlayerState) {
	if (!isPositive(duration) || !isPositive(playbackRate) || !Number.isFinite(currentTime)) {
		return undefined;
	}
	return { duration, playbackRate, position: Math.min(duration, Math.max(0, currentTime)) };
}

export function bindMediaSession(
	player: Pick<PlayerController, "state" | "resume" | "pause" | "seek" | "play">,
	host: MediaSessionHost,
): Unsubscriber {
	if (!host.mediaSession) return () => {};
	const { mediaSession, MediaMetadata } = host;
	/** One episode's chapters, loading or loaded. */
	let chapters: { url: string; loading: Promise<Chapter[]> } | undefined;

	async function seekChapter(direction: 1 | -1): Promise<void> {
		const { episode } = get(player.state);
		const url = episode?.chaptersUrl;
		if (!url) return;
		if (chapters?.url !== url) {
			chapters = { url, loading: host.chapters(url).catch(() => []) };
		}
		const asked = chapters;
		const loaded = await asked.loading;
		// None loaded, as offline: the next press asks again.
		if (loaded.length === 0 && chapters === asked) chapters = undefined;
		const now = get(player.state);
		if (unbound || !now.episode || getEpisodeKey(now.episode) !== getEpisodeKey(episode))
			return;
		const start = chapterStart(loaded, now.currentTime, direction);
		if (start !== undefined) player.seek(start);
	}

	/** Plays the queue's first episode. The one switched away from goes last, so presses go through the queue. */
	function playNextInQueue(): void {
		const [next] = get(queue).episodes;
		const outgoing = get(player.state).episode;
		if (!next || !player.play(next) || !outgoing) return;
		const [first] = get(queue).episodes;
		if (first && getEpisodeKey(first) === getEpisodeKey(outgoing)) {
			queue.remove(first);
			queue.add(first);
		}
	}

	const run: Record<PreviousTrackAction | NextTrackAction, () => void> = {
		captureTimestamp: () => host.captureTimestamp(),
		skipBackward: () => host.skipBackward(),
		skipForward: () => host.skipForward(),
		previousChapter: () => void seekChapter(-1),
		nextChapter: () => void seekChapter(1),
		nextInQueue: playNextInQueue,
	};

	const actions: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
		["play", () => player.resume()],
		["pause", () => player.pause()],
		["seekbackward", () => host.skipBackward()],
		["seekforward", () => host.skipForward()],
		["previoustrack", () => run[host.settings().headsetPreviousTrack]()],
		["nexttrack", () => run[host.settings().headsetNextTrack]()],
		[
			"seekto",
			({ seekTime }) => {
				if (seekTime !== undefined) player.seek(seekTime);
			},
		],
	];
	let unbound = false;
	let registered: MediaSessionAction[] | null = null;
	let shownMetadata: string | undefined;

	function setHandlers(shown: boolean): void {
		if (shown && !registered) {
			registered = [];
			for (const [action, handle] of actions) {
				const handler: MediaSessionActionHandler = (details) => {
					if (!unbound) handle(details);
				};
				if (attempt(() => mediaSession.setActionHandler(action, handler))) {
					registered.push(action);
				}
			}
		} else if (!shown && registered) {
			for (const action of registered) {
				attempt(() => mediaSession.setActionHandler(action, null));
			}
			registered = null;
		}
	}

	function showMetadata(episode: Episode | undefined): void {
		const key = JSON.stringify(
			episode ? [episode.title, episode.podcastName, episode.artworkUrl] : null,
		);
		if (key === shownMetadata) return;
		shownMetadata = key;
		if (!episode || !MediaMetadata) {
			attempt(() => {
				mediaSession.metadata = null;
			});
			return;
		}
		const text = { title: episode.title, artist: episode.podcastName, album: "PodNotes" };
		const artwork = episode.artworkUrl ? [{ src: episode.artworkUrl }] : [];
		// MediaMetadata rejects an artwork URL it cannot parse.
		const shown = attempt(() => {
			mediaSession.metadata = new MediaMetadata({ ...text, artwork });
		});
		if (!shown) {
			attempt(() => {
				mediaSession.metadata = new MediaMetadata(text);
			});
		}
	}

	function show(state: PlayerState): void {
		setHandlers(!!state.episode);
		showMetadata(state.episode);
		const playbackState = PLAYBACK_STATES[state.status];
		attempt(() => {
			mediaSession.playbackState = playbackState;
		});
		const position = playbackState === "none" ? undefined : positionOf(state);
		attempt(() => mediaSession.setPositionState(position));
	}

	const unsubscribe = player.state.subscribe(show);
	return () => {
		if (unbound) return;
		unbound = true;
		unsubscribe();
		show({ ...get(player.state), status: "empty", episode: undefined });
	};
}
