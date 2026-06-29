import Fuse from "fuse.js";
import type { Episode } from "src/types/Episode";

const fuseOptions = {
    shouldSort: true,
    findAllMatches: true,
    threshold: 0.4,
    isCaseSensitive: false,
    keys: ["title"],
};

const fuseCache = new WeakMap<
    Episode[],
    { fuse: Fuse<Episode>; signature: string }
>();

// Fingerprint the searchable content of the list. The Fuse index is keyed by the
// array reference, but the same reference can be mutated in place (an entry
// swapped or its title edited) while keeping the same length, so length alone is
// too weak a validity check - it would hand back an index built from the old
// contents. The signature captures each episode's title (the only indexed field)
// and streamUrl (its stable identity, so a same-title swap is still detected) in
// order, so any content or ordering change rebuilds the index while an unchanged
// list keeps reusing it across keystrokes. JSON framing keeps it collision-free
// regardless of what the titles and URLs contain.
function contentSignature(episodes: Episode[]): string {
    return JSON.stringify(
        episodes.map((episode) => [episode.title, episode.streamUrl]),
    );
}

function getFuse(episodes: Episode[]): Fuse<Episode> {
    const signature = contentSignature(episodes);
    const cached = fuseCache.get(episodes);

    if (cached && cached.signature === signature) {
        return cached.fuse;
    }

    const newFuse = new Fuse(episodes, fuseOptions);
    fuseCache.set(episodes, { fuse: newFuse, signature });

    return newFuse;
}

export default function searchEpisodes(query: string, episodes: Episode[]): Episode[] {
    if (episodes.length === 0) return [];

    // Trim before the empty check so a whitespace-only query restores the full
    // list rather than running a fuzzy search for spaces. This covers every call
    // site (feed/playlist/latest/played searches) at once (PV-08).
    if (query.trim().length === 0) {
        return episodes;
    }

    const fuse = getFuse(episodes);
    const searchResults = fuse.search(query);
    return searchResults.map(resItem => resItem.item);
}
