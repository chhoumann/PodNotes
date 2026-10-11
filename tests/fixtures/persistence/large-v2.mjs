import { readFileSync } from "node:fs";
import config from "../../../obsidian-e2e.config.mjs";

/** @typedef {import("../../../src/persistence/episodeCodec").PersistedEpisode} SavedEpisode */

export function createLargeV2Fixture(includeGuid = false) {
	/** @type {{feed: import("../../../src/types/PodcastFeed").PodcastFeed, episodes: SavedEpisode[], guids: string[]}} */
	const sample = JSON.parse(readFileSync("tests/fixtures/persistence/feed-sample.json", "utf8"));
	// A file a released version wrote: it has no libraryId.
	const data =
		/** @type {import("../../../src/persistence/podNotesData").PersistedPodNotesSettings & { schemaVersion: 2 }} */ ({
			...structuredClone(config.defaultData),
			schemaVersion: 2,
		});
	/** @type {SavedEpisode[]} */
	const saved = [];
	for (let feedIndex = 0; feedIndex < 50; feedIndex++) {
		const name = `${sample.feed.title} fixture ${String(feedIndex + 1).padStart(2, "0")}`;
		const feedUrl = `${sample.feed.url}?fixture=${feedIndex + 1}`;
		data.savedFeeds[name] = { ...sample.feed, title: name, url: feedUrl };
		data.downloadedEpisodes[name] = [];
		for (let episodeIndex = 0; episodeIndex < 40; episodeIndex++) {
			const source = sample.episodes[episodeIndex % sample.episodes.length];
			const title = `${source.title} - ${episodeIndex + 1}`;
			const key = `${name}::${title}`;
			const duration = source.duration ?? 1800;
			data.playedEpisodes[key] = {
				title,
				podcastName: name,
				time: episodeIndex % 3 === 0 ? duration : Math.floor(duration / 2),
				duration,
				finished: episodeIndex % 3 === 0,
			};
			if (episodeIndex >= 4) continue;
			const episode = {
				...source,
				...(includeGuid ? { podnotesGuid: sample.guids[episodeIndex] } : {}),
				title,
				podcastName: name,
				feedUrl,
				streamUrl: `${source.streamUrl}&fixture=${feedIndex + 1}-${episodeIndex + 1}`,
			};
			saved.push(episode);
			data.downloadedEpisodes[name].push({
				...episode,
				filePath: `PodNotes/${name}/episode-${episodeIndex + 1}.mp3`,
				size: duration * 16_000,
			});
			if (episodeIndex < 2) {
				data.podNotes[key] = {
					episodeName: title,
					podcastFeedKey: name,
					filePath: `PodNotes/${name}/episode-${episodeIndex + 1}.md`,
				};
			}
		}
	}
	data.localFiles.episodes = Object.values(data.downloadedEpisodes).flat();
	data.favorites.episodes = saved.filter((_, index) => index % 2 === 0);
	data.queue.episodes = saved.slice(0, 20);
	for (let index = 0; index < 4; index++) {
		const name = `Listening ${index + 1}`;
		data.playlists[name] = {
			name,
			icon: "list",
			episodes: saved.slice(index * 50, (index + 1) * 50),
			shouldEpisodeRemoveAfterPlay: false,
			shouldRepeat: false,
		};
	}
	data.currentEpisode = saved[saved.length - 1];
	return data;
}
