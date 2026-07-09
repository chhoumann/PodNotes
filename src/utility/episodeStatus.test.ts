import { describe, expect, test } from "vitest";

import type { Episode } from "src/types/Episode";
import type { PlayedEpisode } from "src/types/PlayedEpisode";
import {
	getFinishedPlayedEpisodeRecords,
	getPlayedEpisode,
	getPlayedEpisodeAliasKeys,
	isEpisodeFinished,
} from "./episodeStatus";

const episode: Episode = {
	title: "Shared title",
	streamUrl: "https://example.com/audio.mp3",
	url: "https://example.com/episode",
	description: "",
	content: "",
	podcastName: "Design Podcast",
};

function playedEpisode(podcastName: string, finished: boolean): PlayedEpisode {
	return {
		title: episode.title,
		podcastName,
		time: finished ? 120 : 30,
		duration: 120,
		finished,
	};
}

describe("episodeStatus", () => {
	test("prefers composite played keys over legacy title keys", () => {
		const playedEpisodes = {
			[episode.title]: playedEpisode("Other Podcast", true),
			"Design Podcast::Shared title": playedEpisode("Design Podcast", false),
		};

		expect(getPlayedEpisode(playedEpisodes, episode)).toMatchObject({
			podcastName: "Design Podcast",
			finished: false,
		});
		expect(isEpisodeFinished(episode, playedEpisodes)).toBe(false);
	});

	test("falls back to legacy title keys", () => {
		const playedEpisodes = {
			[episode.title]: playedEpisode("Design Podcast", true),
		};

		expect(isEpisodeFinished(episode, playedEpisodes)).toBe(true);
	});

	test("lists only finished played records", () => {
		const records = getFinishedPlayedEpisodeRecords({
			finished: playedEpisode("Design Podcast", true),
			unfinished: playedEpisode("Design Podcast", false),
		});

		expect(records).toHaveLength(1);
		expect(records[0].key).toBe("finished");
	});

	test("deduplicates legacy and composite entries for the same played episode", () => {
		const records = getFinishedPlayedEpisodeRecords({
			[episode.title]: playedEpisode("Design Podcast", true),
			"Design Podcast::Shared title": playedEpisode("Design Podcast", true),
		});

		expect(records).toHaveLength(1);
		expect(records[0].key).toBe("Design Podcast::Shared title");
	});

	test("finds stored aliases for the same played episode", () => {
		const aliases = getPlayedEpisodeAliasKeys(
			{
				[episode.title]: playedEpisode("Design Podcast", true),
				"Design Podcast::Shared title": playedEpisode("Design Podcast", true),
				"Other Podcast::Shared title": playedEpisode("Other Podcast", true),
			},
			{
				title: episode.title,
				podcastName: episode.podcastName,
			},
			"Design Podcast::Shared title",
		);

		expect(aliases).toEqual([episode.title, "Design Podcast::Shared title"]);
	});
});
