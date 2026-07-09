import FeedParser from "src/parser/feedParser";
import type { Episode } from "src/types/Episode";
import type { PlayedEpisode } from "src/types/PlayedEpisode";
import type { PodcastFeed } from "src/types/PodcastFeed";

export default async function findPlayedEpisodesInFeeds(
	playedEpisodes: PlayedEpisode[],
	feeds: PodcastFeed[],
): Promise<Episode[]> {
	// Group by podcast name with a Map, not a plain object. The name comes
	// verbatim from a feed's `<title>`, so a crafted value like "__proto__" or
	// "constructor" would resolve `acc[name]` to an inherited prototype member
	// (truthy, no `.push`) and throw, rejecting this Promise. A Map keys on the
	// string itself, so any name is handled safely.
	const episodesByPodcast = new Map<string, PlayedEpisode[]>();
	for (const episode of playedEpisodes) {
		const episodes = episodesByPodcast.get(episode.podcastName);
		if (episodes) {
			episodes.push(episode);
		} else {
			episodesByPodcast.set(episode.podcastName, [episode]);
		}
	}

	const playedEpisodesInFeeds: Episode[] = [];

	for (const [podcastName, episodes] of episodesByPodcast) {
		const feed = feeds.find((feed) => feed.title === podcastName);
		if (!feed) continue;

		const parser = new FeedParser(feed);
		const episodesInFeed = await parser.getEpisodes(feed.url);

		for (const episode of episodes) {
			const episodeInFeed = episodesInFeed.find((e) => e.title === episode.title);

			if (episodeInFeed) {
				playedEpisodesInFeeds.push(episodeInFeed);
			}
		}
	}

	return playedEpisodesInFeeds;
}
