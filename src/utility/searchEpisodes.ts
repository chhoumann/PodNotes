import type { Episode } from "src/types/Episode";
import { fuzzySearch } from "./fuzzySearch";

export default function searchEpisodes(
	query: string,
	episodes: readonly Episode[],
): readonly Episode[] {
	if (query.trim().length === 0) {
		return episodes;
	}

	return fuzzySearch(query, episodes, (episode) => episode.title, {
		findAllMatches: true,
	});
}
