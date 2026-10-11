import { Notice } from "obsidian";
import type { ObsidianProtocolData } from "obsidian";
import { get } from "svelte/store";
import FeedParser from "./parser/feedParser";
import { downloadedEpisodes, localFiles, plugin, savedFeeds, viewState } from "./store";
import type DownloadedEpisode from "./types/DownloadedEpisode";
import type { Episode } from "./types/Episode";
import type { PodcastFeed } from "./types/PodcastFeed";
import { isFetchableUrl } from "./utility/assertFetchableUrl";
import { resolveFeedUrl } from "./services/privateFeeds";
import { isPrivateFeedPlaceholder, parsePrivateFeedPlaceholder } from "./utility/privateFeedUrl";
import { findUniqueTitleMatch, titleTokenSimilarity } from "./utility/episodeTitleMatch";
import { isLocalFile } from "./utility/isLocalFile";
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

	return findUniqueTitleMatch(nameCandidates, episodes, (episode) => episode.title, 1);
}

function findLocalEpisodeByCandidates(nameCandidates: string[]): Episode | undefined {
	for (const name of nameCandidates) {
		const episode = localFiles.getLocalEpisode(name);
		if (episode) return episode;
	}

	return findUniqueTitleMatch(
		nameCandidates,
		get(localFiles).episodes,
		(episode) => episode.title,
		1,
	);
}

/** A number of seconds from a link, or NaN unless the whole value is one. */
function parseSeconds(value: string): number {
	return value.trim() === "" ? Number.NaN : Number(value);
}

export default async function podNotesURIHandler(
	{ url, episodeName, time, endTime, end, to }: PodNotesProtocolData,
	revealPlayer?: RevealPodNotesPlayer,
) {
	if (!url || !episodeName) {
		new Notice("URL and episode name are required to play an episode");
		return;
	}

	// A link may omit the timestamp ({{episodelink}}, issue #35). The player then
	// resumes the episode where it was left, or from the start once finished.
	const hasExplicitTime = time !== undefined && time !== "";
	let requestedTime = 0;
	if (hasExplicitTime) {
		requestedTime = parseSeconds(time);
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
	const player = get(plugin).player;
	const playOptions = hasExplicitTime ? { time: requestedTime, endTime: requestedEndTime } : {};
	const loaded = get(player.state).episode;
	// A link to the loaded episode names its feed, or its file for a local file, so a
	// same-titled episode of another show is not taken for it.
	const loadedLinkTarget =
		loaded &&
		(isLocalFile(loaded)
			? ((loaded as Partial<DownloadedEpisode>).filePath ??
				downloadedEpisodes.getEpisode(loaded)?.filePath)
			: loaded.feedUrl);
	// Membership (not ordered selection) is correct here: there is only one loaded episode, and
	// keeping the legacy candidate lets a legacy '+'-as-space link to the loaded episode resume
	// without a feed round-trip. The only cost is a rare false-positive - a current-format link to
	// a "X+Y" episode while a distinct "X Y" twin is loaded resumes the loaded twin instead of
	// switching - which we accept over regressing the far more common same-episode legacy-link case.
	// A retitled same-episode link (guest name moved) has the same token set.
	// Sub-1.0 overlap is not enough here: "… Part 1" vs the loaded "… Part 2"
	// scores ~0.78, and with only one candidate the uniqueness guard is vacuous.
	// Those links fall through to the feed lookup, which can still exact-match.
	const episodeIsLoaded =
		!!loaded &&
		!!loadedLinkTarget &&
		candidateValues(url).includes(loadedLinkTarget) &&
		(nameCandidates.includes(loaded.title) ||
			nameCandidates.some((name) => titleTokenSimilarity(name, loaded.title) === 1));

	if (episodeIsLoaded) {
		if (!player.play(loaded, playOptions)) return;
		viewState.set(ViewState.Player);
		await revealPlayer?.();
		return;
	}

	// Taken before resolving the episode: a play the user starts meanwhile wins.
	const play = player.deferPlay();

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
		episode = findLocalEpisodeByCandidates(nameCandidates);
	} else if (!isPlaceholderLink && !candidateValues(url).some((u) => /^https?:\/\//i.test(u))) {
		// The probe found no file, yet `url` has no http(s) scheme, so it can only be
		// a vault path whose file was moved/renamed. Resolve the episode by name from
		// the local-files store rather than handing the bare path to FeedParser (which
		// would fail and show a misleading "Could not load the podcast feed").
		episode = findLocalEpisodeByCandidates(nameCandidates);
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

	if (!play(episode, playOptions)) return;
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

	const parsed = parseSeconds(rawEndTime);
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
