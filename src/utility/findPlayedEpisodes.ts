import FeedParser from "src/parser/feedParser";
import type { Episode } from "src/types/Episode";
import type { PlayedEpisode } from "src/types/PlayedEpisode"
import type { PodcastFeed } from "src/types/PodcastFeed";

export default async function findPlayedEpisodesInFeeds(
    playedEpisodes: PlayedEpisode[],
    feeds: PodcastFeed[],
): Promise<Episode[]> {
    const episodesByPodcast = playedEpisodes.reduce((acc: { [podcastName: string]: PlayedEpisode[] }, episode) => {
        const podcastName = episode.podcastName;
        const episodes = acc[podcastName] || [];
        episodes.push(episode);
        acc[podcastName] = episodes;
        return acc;
    }, {});

    const playedEpisodesInFeeds: Episode[] = [];

    for (const [podcastName, episodes] of Object.entries(episodesByPodcast)) {
        const feed = feeds.find(feed => feed.title === podcastName);
        if (!feed) continue;

        const parser = new FeedParser(feed);
        const episodesInFeed = await parser.getEpisodes(feed.url);

        for (const episode of episodes) {
            const episodeInFeed = episodesInFeed.find(e => e.title === episode.title);

            if (episodeInFeed) {
                playedEpisodesInFeeds.push(episodeInFeed);
            }
        }
    }

    return playedEpisodesInFeeds;
}
