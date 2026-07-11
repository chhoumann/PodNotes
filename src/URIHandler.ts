import { Notice } from "obsidian";
import type { ObsidianProtocolData } from "obsidian";
import { get } from "svelte/store";
import type { IAPI } from "./API/IAPI";
import FeedParser from "./parser/feedParser";
import {
	currentEpisode,
	currentTime,
	duration,
	isPaused,
	activePlaybackSegment,
	localFiles,
	playedEpisodes,
	plugin,
	savedFeeds,
	requestedPlaybackTime,
	viewState,
} from "./store";
import type { Episode } from "./types/Episode";
import type { PodcastFeed } from "./types/PodcastFeed";
import { isFetchableUrl } from "./utility/assertFetchableUrl";
import { resolveFeedUrl } from "./services/privateFeeds";
import { isPrivateFeedPlaceholder, parsePrivateFeedPlaceholder } from "./utility/privateFeedUrl";
import { getEpisodeKey } from "./utility/episodeKey";
import { ViewState } from "./types/ViewState";

type PodNotesProtocolData = ObsidianProtocolData & {
	end?: string;
	endTime?: string;
	to?: string;
};
type RevealPodNotesPlayer = () => Promise<void> | void;

/**
 * Obsidian decodes protocol query values with decodeURIComponent only, which does NOT turn '+'
 * into a space. Current PodNotes links percent-encode spaces as '%20' (see encodePodnotesURI), so
 * the decoded value is already correct and a literal '+' is a real '+'. Links written by older
 * versions encoded spaces as '+', so for backwards compatibility we also try a variant with '+'
 * collapsed to spaces.
 *
 * Candidates are ordered most-correct-first; callers MUST resolve them in order and stop at the
 * first hit so a current-format title/path containing a literal '+' is never mis-collapsed.
 */
function candidateValues(raw: string): string[] {
	const legacy = raw.replace(/\+/g, " ");
	return raw === legacy ? [raw] : [raw, legacy];
}

function findEpisodeByCandidates(
	episodes: Episode[],
	nameCandidates: string[],
): Episode | undefined {
	for (const name of nameCandidates) {
		const target = name.trim().toLowerCase();
		const episode = episodes.find((ep) => ep.title.trim().toLowerCase() === target);
		if (episode) return episode;
	}

	return undefined;
}

/**
 * The time a no-timestamp link ({{episodelink}}, issue #35) should resume an
 * episode at: the last played location, or the start. A FINISHED episode is
 * stored at its end (time === duration); resuming there would immediately fire
 * the player's `ended` handler and auto-advance the queue, so we restart it from
 * the beginning instead — matching the issue's "the beginning if not played".
 */
function resolveResumeTime(episode: Episode): number {
	const played = playedEpisodes.get(episode);
	if (!played) return 0;

	const isFinished = played.finished || (played.duration > 0 && played.time >= played.duration);
	return isFinished ? 0 : played.time;
}

export default async function podNotesURIHandler(
	{ url, episodeName, time, endTime, end, to }: PodNotesProtocolData,
	api: IAPI,
	revealPlayer?: RevealPodNotesPlayer,
) {
	if (!url || !episodeName) {
		new Notice("URL and episode name are required to play an episode");
		return;
	}

	// A link may omit the timestamp ({{episodelink}}, issue #35). When it does we
	// reopen the episode and resume from the last played location (resolved from
	// saved progress below), or the start if it was never played or already
	// finished — rather than seeking to a baked-in time.
	const hasExplicitTime = time !== undefined && time !== "";
	let requestedTime = 0;
	if (hasExplicitTime) {
		requestedTime = parseFloat(time);
		if (!Number.isFinite(requestedTime)) {
			new Notice("Timestamp must be a valid number");
			return;
		}
		// One guard ahead of both the segment and plain paths: a negative time is
		// never valid (the segment path's own requestedTime < 0 check is now redundant).
		if (requestedTime < 0) {
			new Notice("Timestamp must be zero or greater");
			return;
		}
	}

	const requestedEndTime = parseSegmentEndTime(
		endTime ?? end ?? to,
		hasExplicitTime,
		requestedTime,
	);
	if (requestedEndTime === null) return;

	const nameCandidates = candidateValues(episodeName);
	const currentEp = get(currentEpisode);
	// Membership (not ordered selection) is correct here: there is only one loaded episode, and
	// keeping the legacy candidate lets a legacy '+'-as-space link to the loaded episode resume
	// without a feed round-trip (and without currentEpisode.set re-enqueueing it). The only cost is
	// a rare false-positive — a current-format link to a "X+Y" episode while a distinct "X Y" twin
	// is loaded resumes the loaded twin instead of switching — which we accept over regressing the
	// far more common same-episode legacy-link case.
	const episodeIsPlaying = !!currentEp && nameCandidates.includes(currentEp.title);
	const playerIsVisible = get(viewState) === ViewState.Player;

	if (episodeIsPlaying) {
		if (hasExplicitTime) {
			const episodeKey = getEpisodeKey(currentEp);
			requestedPlaybackTime.set({
				episodeKey,
				time: requestedTime,
				endTime: requestedEndTime,
			});
			viewState.set(ViewState.Player);
			api.currentTime = requestedTime;
			setActivePlaybackSegment(episodeKey, requestedTime, requestedEndTime);
			isPaused.set(false);
			if (playerIsVisible) {
				requestedPlaybackTime.set(null);
			}

			await revealPlayer?.();
			return;
		}

		// No timestamp: the live position already is the last played location, so
		// surface the player and resume playback without seeking — unless the
		// episode already finished (live position at its end), in which case
		// replaying would instantly fire `ended` and auto-advance, so restart it.
		activePlaybackSegment.set(null);
		viewState.set(ViewState.Player);
		const liveTime = get(currentTime);
		const liveDuration = get(duration);
		if (liveDuration > 0 && liveTime >= liveDuration) {
			api.currentTime = 0;
		}
		isPaused.set(false);

		await revealPlayer?.();
		return;
	}

	// The path probe only decides local-vs-feed routing; the episode itself is resolved by name.
	const { vault } = get(plugin).app;
	const localFile = candidateValues(url)
		.map((path) => vault.getAbstractFileByPath(path))
		.find((file) => file !== null);

	let episode: Episode | undefined;

	// A private-feed placeholder always routes to placeholder resolution (the
	// final branch): a vault file literally named like a placeholder must not
	// shadow private links.
	const isPlaceholderLink = isPrivateFeedPlaceholder(url);
	if (!isPlaceholderLink && localFile) {
		episode = nameCandidates
			.map((name) => localFiles.getLocalEpisode(name))
			.find((ep) => ep !== undefined);
	} else if (!isPlaceholderLink && !candidateValues(url).some((u) => /^https?:\/\//i.test(u))) {
		// The probe found no file, yet `url` has no http(s) scheme, so it can only be
		// a vault path whose file was moved/renamed. Resolve the episode by name from
		// the local-files store rather than handing the bare path to FeedParser (which
		// would fail and show a misleading "Could not load the podcast feed").
		episode = nameCandidates
			.map((name) => localFiles.getLocalEpisode(name))
			.find((ep) => ep !== undefined);
	} else {
		// Links for a private feed carry the non-fetchable placeholder, not the
		// secret URL. Resolution is local-only: the placeholder's feed name must
		// match a saved feed on THIS device, and the real URL comes from
		// SecretStorage. An attacker-crafted placeholder link can therefore only
		// make the user's own device fetch the user's own subscribed feed - and
		// the resolved URL still passes the fetchability gate below.
		let fetchUrl = url;
		let placeholderFeed: PodcastFeed | undefined;
		const placeholderName = parsePrivateFeedPlaceholder(url);
		if (placeholderName !== null) {
			placeholderFeed = get(savedFeeds)[placeholderName];
			const resolved = placeholderFeed
				? resolveFeedUrl(placeholderFeed, get(plugin).feedUrls)
				: null;
			if (resolved === null) {
				new Notice(
					"This link points to a private feed that is not available on this device.",
				);
				return;
			}
			fetchUrl = resolved;
		}

		// The url here came straight from an untrusted obsidian://podnotes deep link
		// (an attacker can put one behind <a href> on a web page), so a single click
		// must not be able to fetch an arbitrary internal host. Refuse anything that
		// isn't a public http(s) URL before handing it to FeedParser (blind SSRF).
		if (!isFetchableUrl(fetchUrl)) {
			new Notice("Refusing to load a feed from a private, local, or non-http(s) URL");
			return;
		}

		try {
			// Fetch with the raw url (current-format links are correct as-is); only the title gets
			// the legacy-candidate treatment. A '+' in a legacy feed URL is pre-existing and out of
			// scope. getEpisodes returns fully-populated episodes, so we match in memory rather than
			// re-fetching once per candidate.
			// For a private feed, parse against the SAVED feed so episodes keep the
			// placeholder identity - never the resolved secret - on url/feedUrl
			// (the picked episode persists via currentEpisode).
			const feedparser = new FeedParser(placeholderFeed);
			const episodes = await feedparser.getEpisodes(fetchUrl);
			episode = findEpisodeByCandidates(episodes, nameCandidates);
		} catch (error) {
			// A fetch/parse failure is distinct from a genuine title miss; surface it instead of
			// rejecting silently (the previous behaviour threw an unhandled rejection).
			console.error(error);
			new Notice("Could not load the podcast feed");
			return;
		}
	}

	if (!episode) {
		new Notice("Episode not found");
		return;
	}

	// Always arm requestedPlaybackTime so the resume point is explicit. For a
	// no-timestamp link (issue #35) we resolve it from saved progress here rather
	// than relying on the player's restore-on-absence: that makes the seek
	// deterministic and overrides any stale pending request from an earlier link
	// to this same episode (which would otherwise win on metadata load).
	requestedPlaybackTime.set({
		episodeKey: getEpisodeKey(episode),
		time: hasExplicitTime ? requestedTime : resolveResumeTime(episode),
		endTime: hasExplicitTime ? requestedEndTime : undefined,
	});
	setActivePlaybackSegment(
		getEpisodeKey(episode),
		hasExplicitTime ? requestedTime : resolveResumeTime(episode),
		hasExplicitTime ? requestedEndTime : undefined,
	);
	currentEpisode.set(episode);
	viewState.set(ViewState.Player);
	await revealPlayer?.();
}

function parseSegmentEndTime(
	rawEndTime: string | undefined,
	hasExplicitTime: boolean,
	requestedTime: number,
): number | undefined | null {
	if (rawEndTime === undefined || rawEndTime === "") return undefined;

	if (!hasExplicitTime) {
		new Notice("Segment links require a start timestamp");
		return null;
	}

	if (requestedTime < 0) {
		new Notice("Segment start time must be zero or greater");
		return null;
	}

	const parsed = parseFloat(rawEndTime);
	if (!Number.isFinite(parsed)) {
		new Notice("Segment end time must be a valid number");
		return null;
	}

	if (parsed <= requestedTime) {
		new Notice("Segment end time must be after the start time");
		return null;
	}

	return parsed;
}

function setActivePlaybackSegment(
	episodeKey: string,
	startTime: number,
	endTime: number | undefined,
): void {
	activePlaybackSegment.set(
		endTime === undefined
			? null
			: {
					episodeKey,
					startTime,
					endTime,
				},
	);
}
