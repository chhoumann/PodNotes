import type { Episode } from "src/types/Episode";
import { fuzzySearch } from "./fuzzySearch";

export default function searchEpisodes(
	query: string,
	episodes: readonly Episode[],
): readonly Episode[] {
	// Trim before the empty check so a whitespace-only query restores the full
	// list rather than running a fuzzy search for spaces. This covers every call
	// site (feed/playlist/latest/played searches) at once (PV-08).
	if (query.trim().length === 0) {
		return episodes;
	}

	return fuzzySearch(
		query,
		episodes.map((episode) => episode.title),
		true,
	).map((index) => episodes[index]);
}
