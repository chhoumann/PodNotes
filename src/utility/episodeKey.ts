import type { Episode } from "src/types/Episode";

const KEY_DELIMITER = "::";

/**
 * Joining a (podcastName, title) pair with a raw `::` is only unambiguous when
 * neither component can forge or straddle the delimiter. The mapping breaks
 * (two distinct pairs produce one key) when a component contains `::`, or the
 * name ends with `:` / the title starts with `:` - those merge with the
 * delimiter into `:::`, which can be split two ways. Concretely
 * ("A", "B::C") and ("A::B", "C") both yield "A::B::C", and ("A:", "B") and
 * ("A", ":B") both yield "A:::B". Both components come verbatim from a
 * (potentially malicious) RSS feed, so such a pair can be crafted to collide
 * with another subscribed feed's episode. Pairs flagged here are encoded
 * instead so the key stays injective.
 */
function compositeKeyIsAmbiguous(podcastName: string, title: string): boolean {
	return (
		podcastName.includes(KEY_DELIMITER) ||
		title.includes(KEY_DELIMITER) ||
		podcastName.endsWith(":") ||
		title.startsWith(":")
	);
}

/**
 * A NUL byte cannot appear in XML feed text (nor in the parsed PocketCasts
 * titles), so the escaped form below is prefixed with it. That keeps the escaped
 * key disjoint from the legacy title-only keys, which are raw, arbitrary titles
 * (a feed with an empty `<title>` yields `podcastName === ""` and so a raw-title
 * key - see feedParser/pocketCastsParser). Without the prefix a crafted legacy
 * title could equal an escaped composite key and re-introduce a cross-feed
 * collision.
 */
const ESCAPED_KEY_PREFIX = "\u0000";

/**
 * Escapes a key component so it contains no `:` at all: the escape char is
 * doubled (`\` -> `\\`) and every colon becomes `\c`. The result is therefore
 * colon-free and the mapping is injective. Unlike `encodeURIComponent` this
 * never throws (e.g. on lone surrogates), so a hostile feed value cannot turn
 * key generation into a crash.
 */
function escapeKeyComponent(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/:/g, "\\c");
}

/**
 * Generates a unique key for an episode.
 * Uses podcastName + title to avoid collisions between episodes with the same title
 * from different podcasts.
 *
 * The common case keeps the plain `podcastName::title` format so existing
 * `data.json` keys (and the dedup heuristics that look for `::`) stay valid with
 * no migration. Only the rare delimiter-forging pair (see
 * {@link compositeKeyIsAmbiguous}) is escaped, which makes the key collision-
 * resistant: a feed cannot choose a name/title that maps onto another feed's
 * episode key.
 *
 * Falls back to title-only for backwards compatibility with episodes that don't have podcastName.
 */
export function getEpisodeKey(episode: Episode | null | undefined): string {
	if (!episode || !episode.title) {
		return "";
	}
	if (episode.podcastName) {
		const { podcastName, title } = episode;
		if (compositeKeyIsAmbiguous(podcastName, title)) {
			// Collision-resistant form for the rare delimiter-forging pair. Each
			// escaped component is colon-free, so joining with a single `:` yields a
			// key with exactly one colon and never the `::` delimiter, keeping it
			// disjoint from the plain composite keys below; the NUL prefix keeps it
			// disjoint from the legacy title-only keys. The encoding is injective, so
			// no two distinct pairs can share a key.
			return `${ESCAPED_KEY_PREFIX}${escapeKeyComponent(podcastName)}:${escapeKeyComponent(title)}`;
		}
		return `${podcastName}${KEY_DELIMITER}${title}`;
	}
	// Fallback for legacy episodes without podcastName
	return episode.title;
}

/**
 * Checks if an episode matches a given key.
 * Handles both new composite keys and legacy title-only keys.
 */
export function episodeMatchesKey(episode: Episode | null | undefined, key: string): boolean {
	if (!episode || !key) {
		return false;
	}
	const compositeKey = getEpisodeKey(episode);
	if (compositeKey === key) {
		return true;
	}
	// Also check title-only for backwards compatibility
	return episode.title === key;
}

/**
 * Whether a STORED playlist/favorite entry refers to the same episode as
 * `current`. Matches on the composite key (podcastName::title) and, for LEGACY
 * entries saved before podcastName existed (the entry has no podcastName), by
 * title alone — but never matches a same-titled episode from a DIFFERENT podcast
 * (an entry that does carry a podcastName).
 *
 * episodeMatchesKey alone misses a legacy (title-only) entry when the current
 * episode's key is composite, so a legacy favorite/playlist entry looked absent
 * and got duplicated (or skipped on cleanup). This restores that legacy match
 * without reintroducing the cross-podcast title collision.
 */
export function isSameStoredEpisode(
	entry: Episode | null | undefined,
	current: Episode | null | undefined,
): boolean {
	if (!entry || !current) {
		return false;
	}
	if (episodeMatchesKey(entry, getEpisodeKey(current))) {
		return true;
	}
	return !entry.podcastName && !!current.title && entry.title === current.title;
}
