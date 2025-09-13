import Fuse from "fuse.js";
import type { Episode } from "src/types/Episode";

export default function searchEpisodes(query: string, episodes: Episode[]): Episode[] {
	if (episodes.length === 0) return [];

    if (query.length === 0) {
        return episodes;
    } 

    const fuse = new Fuse(episodes, {
        shouldSort: true,
        findAllMatches: true,
        threshold: 0.4,
        isCaseSensitive: false,
        keys: ['title'],
    });
    
    const searchResults = fuse.search(query);
    return searchResults.map(resItem => resItem.item);
}
