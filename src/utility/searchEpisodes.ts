import Fuse from "fuse.js";
import type { Episode } from "src/types/Episode";

const fuseOptions = {
    shouldSort: true,
    findAllMatches: true,
    threshold: 0.4,
    isCaseSensitive: false,
    keys: ["title"],
};

const fuseCache = new WeakMap<Episode[], { fuse: Fuse<Episode>; size: number }>();

function getFuse(episodes: Episode[]): Fuse<Episode> {
    const cached = fuseCache.get(episodes);

    if (cached && cached.size === episodes.length) {
        return cached.fuse;
    }

    const newFuse = new Fuse(episodes, fuseOptions);
    fuseCache.set(episodes, { fuse: newFuse, size: episodes.length });

    return newFuse;
}

export default function searchEpisodes(query: string, episodes: Episode[]): Episode[] {
    if (episodes.length === 0) return [];

    if (query.length === 0) {
        return episodes;
    }

    const fuse = getFuse(episodes);
    const searchResults = fuse.search(query);
    return searchResults.map(resItem => resItem.item);
}
