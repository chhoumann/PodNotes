import { describe, expect, test } from "vitest";

import type { Episode } from "src/types/Episode";
import type { PlayedEpisode } from "src/types/PlayedEpisode";
import { buildPlayedEpisodeListEntries } from "./episodeListEntry";

function episode(
	title: string,
	podcastName: string,
	episodeDate: string,
): Episode {
	return {
		title,
		podcastName,
		streamUrl: `https://example.com/${title}.mp3`,
		url: `https://example.com/${title}`,
		description: "",
		content: "",
		episodeDate: new Date(episodeDate),
	};
}

function played(
	title: string,
	podcastName: string,
	finished: boolean = true,
): PlayedEpisode {
	return {
		title,
		podcastName,
		time: finished ? 100 : 25,
		duration: 100,
		finished,
	};
}

describe("episodeListEntry", () => {
	test("resolves finished played records against available episode sources", () => {
		const resolvedEpisode = episode(
			"Resolved",
			"Design Podcast",
			"2024-02-01T00:00:00.000Z",
		);

		const entries = buildPlayedEpisodeListEntries(
			{
				"Design Podcast::Resolved": played("Resolved", "Design Podcast"),
			},
			[[resolvedEpisode]],
		);

		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			episode: resolvedEpisode,
			isAvailable: true,
		});
	});

	test("keeps unavailable played records visible", () => {
		const entries = buildPlayedEpisodeListEntries(
			{
				"Design Podcast::Missing": played("Missing", "Design Podcast"),
			},
			[[]],
		);

		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			isAvailable: false,
			unavailableReason: "Unavailable in current feeds",
			episode: {
				title: "Missing",
				podcastName: "Design Podcast",
				streamUrl: "",
			},
		});
	});

	test("sorts available played episodes by publish date and unavailable records last", () => {
		const olderEpisode = episode(
			"Older",
			"Design Podcast",
			"2024-01-01T00:00:00.000Z",
		);
		const newerEpisode = episode(
			"Newer",
			"Design Podcast",
			"2024-03-01T00:00:00.000Z",
		);

		const entries = buildPlayedEpisodeListEntries(
			{
				"Design Podcast::Older": played("Older", "Design Podcast"),
				"Design Podcast::Missing": played("Missing", "Design Podcast"),
				"Design Podcast::Newer": played("Newer", "Design Podcast"),
			},
			[[olderEpisode, newerEpisode]],
		);

		expect(entries.map((entry) => entry.episode.title)).toEqual([
			"Newer",
			"Older",
			"Missing",
		]);
	});
});
