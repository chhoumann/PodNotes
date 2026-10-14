import { get } from "svelte/store";
import type { FeedRepository } from "src/services/FeedRepository";
import {
	fetchPublishedTranscript,
	findPublishedTranscript,
} from "src/services/publishedTranscript";
import {
	type GroupLimits,
	groupCues,
	type TranscriptParagraph,
} from "src/services/publishedTranscript/render";
import type { Episode } from "src/types/Episode";
import { getEpisodeKey } from "src/utility/episodeKey";

const SENTENCES: GroupLimits = { soft: 5, hard: 30 };

export type Transcript =
	| { readonly kind: "timed"; readonly lines: readonly TranscriptParagraph[] }
	| { readonly kind: "untimed"; readonly lines: readonly { readonly text: string }[] };

/** The last line that starts at or before `time`, or -1 before the first. */
export function lineAt(lines: readonly { start: number }[], time: number): number {
	let at = -1;
	for (const [index, line] of lines.entries()) if (line.start <= time) at = index;
	return at;
}

let cached: { key: string; transcript: Transcript | null } | undefined;

/** Undefined when not cached; null when the episode's feed publishes no transcript. */
export function cachedTranscript(episode: Episode): Transcript | null | undefined {
	return cached?.key === getEpisodeKey(episode) ? cached.transcript : undefined;
}

/**
 * The episode's published transcript as lines, or null when its feed publishes none. Caches
 * the result, and throws when the transcript or the feed could not be read.
 */
export async function loadTranscript(
	feeds: FeedRepository,
	episode: Episode,
	signal: AbortSignal,
): Promise<Transcript | null> {
	const key = episode.podcastName;
	const source = await findPublishedTranscript(feeds, episode);
	const feedFailedBeforeTheEpisode =
		!source && !feeds.episodeMetadata(key, episode) && get(feeds).get(key)?.error;
	if (feedFailedBeforeTheEpisode) throw new Error("The feed did not load.");
	const parsed = source && (await fetchPublishedTranscript(feeds, episode, source, signal));
	const transcript: Transcript | null = !parsed
		? null
		: parsed.kind === "timed"
			? { kind: "timed", lines: groupCues(parsed.cues, SENTENCES) }
			: { kind: "untimed", lines: parsed.paragraphs.map((text) => ({ text })) };
	cached = { key: getEpisodeKey(episode), transcript };
	return transcript;
}
