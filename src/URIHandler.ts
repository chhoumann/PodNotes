import { Notice, TFile } from "obsidian";
import type { ObsidianProtocolData } from "obsidian";
import { get } from "svelte/store";
import { localFiles, plugin, savedFeeds } from "./store";
import type { Episode } from "./types/Episode";
import type { LocalEpisode } from "./types/LocalEpisode";
import { isFetchableUrl } from "./utility/assertFetchableUrl";
import { isSavedFeed, resolveFeedUrl } from "./services/privateFeeds";
import { isPrivateFeedPlaceholder, parsePrivateFeedPlaceholder } from "./utility/privateFeedUrl";
import { findUniqueTitleMatch, titleTokenSimilarity } from "./utility/episodeTitleMatch";
import { episodeLinkTarget } from "./utility/episodeLinkTarget";
import { isLocalFile } from "./utility/isLocalFile";
import { localEpisodeFromFile } from "./utility/localEpisodeFromFile";
import { getEpisodeMediaType, getUnambiguousMediaTypeFromPath } from "./utility/mediaType";

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
	episodes: readonly Episode[],
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

function filesNamedLike(
	files: readonly TFile[],
	paths: readonly string[],
): { paths: string[]; name: string; files: TFile[] } {
	const candidates = paths.map((path) => {
		const name = path.slice(path.lastIndexOf("/") + 1);
		return { path, name, files: files.filter((file) => file.name === name) };
	});
	const { name, files: named } =
		candidates.find((candidate) => candidate.files.length > 0) ?? candidates[0];
	return {
		paths: candidates.filter((candidate) => candidate.name === name).map(({ path }) => path),
		name,
		files: named,
	};
}

/** A number of seconds from a link, or NaN unless the whole value is one. */
function parseSeconds(value: string): number {
	return value.trim() === "" ? Number.NaN : Number(value);
}

// Two links opened in quick succession can load their feeds out of order, so a
// link acts after loading only if no newer link that fetched or played has arrived since.
let latestRequest = 0;

export default async function podNotesURIHandler(
	{ url: linkUrl, episodeName, time, endTime, end, to }: PodNotesProtocolData,
	revealPlayer?: RevealPodNotesPlayer,
) {
	if (!linkUrl || !episodeName) {
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
	const { app, feedUrls } = get(plugin);
	// A link carrying a saved private feed's secret URL opens as the feed's placeholder
	// link, so the secret stays out of the episode.
	const url =
		Object.values(get(savedFeeds)).find((saved) => isSavedFeed(saved, linkUrl, feedUrls))
			?.url ?? linkUrl;
	const localFile = candidateValues(url)
		.map((path) => app.vault.getAbstractFileByPath(path))
		.find((file) => file instanceof TFile);
	// A link to the loaded episode names its feed, or its file for a local file, so a
	// same-titled episode of another show is not taken for it.
	const loadedLinkTarget = loaded && episodeLinkTarget(loaded);
	// Membership (not ordered selection) is correct here: there is only one loaded episode, and
	// keeping the legacy candidate lets a legacy '+'-as-space link to the loaded episode resume
	// without a feed round-trip. The only cost is a rare false-positive - a current-format link to
	// a "X+Y" feed episode while a distinct "X Y" twin is loaded resumes the loaded twin instead of
	// switching - which we accept over regressing the far more common same-episode legacy-link case.
	// A retitled same-episode link (guest name moved) has the same token set.
	// Sub-1.0 overlap is not enough here: "… Part 1" vs the loaded "… Part 2"
	// scores ~0.78, and with only one candidate the uniqueness guard is vacuous.
	// Those links fall through to the feed lookup, which can still exact-match.
	const episodeIsLoaded =
		!!loaded &&
		!!loadedLinkTarget &&
		(!isLocalFile(loaded) || localFile?.path === loadedLinkTarget) &&
		candidateValues(url).includes(loadedLinkTarget) &&
		(nameCandidates.includes(loaded.title) ||
			nameCandidates.some((name) => titleTokenSimilarity(name, loaded.title) === 1));

	if (episodeIsLoaded) {
		latestRequest++;
		if (!player.play(loaded, playOptions)) return;
		await revealPlayer?.();
		return;
	}

	let episode: Episode | undefined;
	let play = player.play.bind(player);

	// A private-feed placeholder always routes to placeholder resolution (the
	// final branch): a vault file literally named like a placeholder must not
	// shadow private links.
	const isPlaceholderLink = isPrivateFeedPlaceholder(url);
	if (!isPlaceholderLink && localFile) {
		// The file the link names plays, registered or not, and as it is registered at its path.
		const named = findLocalEpisodeByCandidates(nameCandidates);
		episode =
			get(localFiles).episodes.find(
				(candidate) => (candidate as LocalEpisode).filePath === localFile.path,
			) ??
			localEpisodeFromFile(
				app,
				localFile,
				// A file does not record whether an mp4 or webm is audio or video, so it takes a same-named registration's.
				getUnambiguousMediaTypeFromPath(localFile.path) ??
					(named ? getEpisodeMediaType(named) : "audio"),
			);
	} else if (!isPlaceholderLink && !candidateValues(url).some((u) => /^https?:\/\//i.test(u))) {
		const { paths, name, files } = filesNamedLike(app.vault.getFiles(), candidateValues(url));
		if (files.length !== 1) {
			new Notice(
				files.length === 0
					? `No vault file is named "${name}".`
					: `More than one vault file is named "${name}". Update the link with the correct path.`,
			);
			return;
		}
		const [file] = files;
		const { episodes: registered } = get(localFiles);
		const original = paths.flatMap((path) =>
			[loaded, ...registered].filter(
				(candidate) => (candidate as LocalEpisode | undefined)?.filePath === path,
			),
		)[0];
		episode =
			registered.find((candidate) => (candidate as LocalEpisode).filePath === file.path) ??
			localEpisodeFromFile(
				app,
				file,
				getUnambiguousMediaTypeFromPath(file.path) ?? original?.mediaType ?? "audio",
			);
	} else {
		// Links for a private feed carry the non-fetchable placeholder, not the
		// secret URL. Resolution is local-only: the placeholder's feed name must
		// match a saved feed on THIS device, and the real URL comes from
		// SecretStorage. An attacker-crafted placeholder link can therefore only
		// make the user's own device fetch the user's own subscribed feed - and
		// the resolved URL still passes the network fetchability gate.
		const feeds = get(plugin).feeds;
		const placeholderKey = parsePrivateFeedPlaceholder(url);
		if (placeholderKey !== null) {
			// Only a feed whose URL is on this device is fetched, and a newer link or play
			// wins over that fetch. Any other link is decided from the feed's last copy
			// without a fetch: it claims a turn only when it plays, so a refused one
			// cancels nothing.
			const saved = get(savedFeeds);
			const fetches =
				Object.prototype.hasOwnProperty.call(saved, placeholderKey) &&
				resolveFeedUrl(saved[placeholderKey], get(plugin).feedUrls) !== null;
			const request = fetches ? ++latestRequest : latestRequest;
			if (fetches) play = player.deferPlay();
			// Fetch even a fresh feed so the link finds an episode published since.
			await feeds.load([placeholderKey], "network");
			if (request !== latestRequest) return;
			const state = get(feeds).get(placeholderKey);
			episode = findEpisodeByCandidates(state?.episodes ?? [], nameCandidates);
			if (!episode && (!state || state.error)) {
				new Notice(
					state?.error === "network"
						? "Could not load the podcast feed"
						: "This link points to a private feed that is not available on this device.",
				);
				return;
			}
		} else {
			// The url here came straight from an untrusted obsidian://podnotes deep link
			// (an attacker can put one behind <a href> on a web page), so a single click
			// must not be able to fetch an arbitrary internal host. Refuse anything that
			// isn't a public http(s) URL before fetching it (blind SSRF).
			if (!isFetchableUrl(url)) {
				new Notice("Refusing to load a feed from a private, local, or non-http(s) URL");
				return;
			}

			// Taken once the link passed every check, so a refused link cancels nothing,
			// and a newer link or play wins.
			const request = ++latestRequest;
			play = player.deferPlay();
			let episodes: Episode[];
			try {
				// Fetch with the raw url (current-format links are correct as-is); only the
				// title gets the legacy-candidate treatment. A '+' in a legacy feed URL is
				// pre-existing and out of scope.
				episodes = await feeds.episodesAt(url);
			} catch (error) {
				if (request !== latestRequest) return;
				// A fetch/parse failure is distinct from a genuine title miss; surface it.
				console.error(error);
				new Notice("Could not load the podcast feed");
				return;
			}
			if (request !== latestRequest) return;
			episode = findEpisodeByCandidates(episodes, nameCandidates);
		}
	}

	if (!episode) {
		new Notice("Episode not found");
		return;
	}

	latestRequest++;
	if (!play(episode, playOptions)) return;
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
