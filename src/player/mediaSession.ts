import { get, type Unsubscriber } from "svelte/store";
import type { Episode } from "src/types/Episode";
import {
	END_MARGIN_S,
	type PlayerController,
	type PlayerState,
	type PlayerStatus,
} from "./PlayerController";

interface MediaSessionHost {
	mediaSession: MediaSession | undefined;
	MediaMetadata: typeof MediaMetadata | undefined;
	captureTimestamp(): void;
	skipBackward(): void;
	skipForward(): void;
}

const NEXT_TRACK_SKIP_S = 30;

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

function positionOf({ currentTime, duration, playbackRate }: PlayerState) {
	if (!isPositive(duration) || !isPositive(playbackRate) || !Number.isFinite(currentTime)) {
		return undefined;
	}
	return { duration, playbackRate, position: Math.min(duration, Math.max(0, currentTime)) };
}

export function bindMediaSession(
	player: Pick<PlayerController, "state" | "resume" | "pause" | "seek">,
	host: MediaSessionHost,
): Unsubscriber {
	if (!host.mediaSession) return () => {};
	const { mediaSession, MediaMetadata } = host;

	const actions: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
		["play", () => player.resume()],
		["pause", () => player.pause()],
		["seekbackward", () => host.skipBackward()],
		["seekforward", () => host.skipForward()],
		["previoustrack", () => host.captureTimestamp()],
		[
			"nexttrack",
			() => {
				const { currentTime, duration } = get(player.state);
				const target = currentTime + NEXT_TRACK_SKIP_S;
				player.seek(
					duration > 0
						? Math.max(currentTime, Math.min(target, duration - END_MARGIN_S))
						: target,
				);
			},
		],
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
