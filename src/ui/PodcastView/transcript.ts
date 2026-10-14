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

/** Sentence-sized lines: a word-level JSON file and half-sentence captions both merge to lines a tap can land in. */
const LINES: GroupLimits = { soft: 5, hard: 30 };

export type Transcript =
	| { readonly kind: "timed"; readonly lines: readonly TranscriptParagraph[] }
	| { readonly kind: "untimed"; readonly lines: readonly { readonly text: string }[] };

/** The last line to start at or before `time`, by time, never by index. -1 before the first. */
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
 * The episode's published transcript as lines, cached on success, or null when its feed
 * publishes none. Throws when the transcript or the feed could not be read, so the panel
 * offers Retry, never payment. A transcript's address can carry a private feed's own, so it
 * stays inside this function.
 */
export async function loadTranscript(
	feeds: FeedRepository,
	episode: Episode,
	signal: AbortSignal,
): Promise<Transcript | null> {
	const source = await findPublishedTranscript(feeds, episode);
	if (!source && get(feeds).get(episode.podcastName)?.status === "error") {
		throw new Error("The feed did not load.");
	}
	const parsed = source && (await fetchPublishedTranscript(feeds, source, signal));
	const transcript: Transcript | null = !parsed
		? null
		: parsed.kind === "timed"
			? { kind: "timed", lines: groupCues(parsed.cues, LINES) }
			: { kind: "untimed", lines: parsed.paragraphs.map((text) => ({ text })) };
	cached = { key: getEpisodeKey(episode), transcript };
	return transcript;
}
