import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "src/constants";
import type { PlayedEpisode } from "src/types/PlayedEpisode";
import type { PodcastFeed } from "src/types/PodcastFeed";
import type { PersistedEpisode, PersistedPlaylist } from "./episodeCodec";
import { jsonValuesEqual, restoreDropped, threeWayMergeSettings } from "./merge";
import { encodePodNotesData, type PersistedPodNotesDataV2 } from "./podNotesData";

type Data = PersistedPodNotesDataV2;

function episode(title: string, podcastName = "Pod A"): PersistedEpisode {
	const slug = `${podcastName}/${title}`;
	return {
		title,
		podcastName,
		streamUrl: `https://example.com/${slug}.mp3`,
		url: `https://example.com/${slug}`,
		description: "",
		content: "",
	};
}

function playlist(name: string, episodes: PersistedEpisode[]): PersistedPlaylist {
	return {
		icon: "list",
		name,
		episodes,
		shouldEpisodeRemoveAfterPlay: false,
		shouldRepeat: false,
	};
}

function feed(title: string): PodcastFeed {
	return { title, url: `https://example.com/${title}.xml`, artworkUrl: "" };
}

function played(title: string, time: number, finished = false): PlayedEpisode {
	return { title, podcastName: "Pod A", time, duration: 3600, finished };
}

/** A data.json document as PodNotes writes it, with every episode container populated. */
function data(): Data {
	const doc: Data = JSON.parse(
		JSON.stringify(encodePodNotesData(structuredClone(DEFAULT_SETTINGS))),
	);
	doc.savedFeeds = { "Pod A": feed("Pod A") };
	doc.playedEpisodes = { "Pod A::Ep 1": played("Ep 1", 10) };
	doc.currentEpisode = episode("Ep 1");
	doc.queue.episodes = [episode("Ep 1"), episode("Ep 2")];
	doc.favorites.episodes = [episode("Ep 1"), episode("Ep 2")];
	doc.localFiles.episodes = [episode("Ep 1"), episode("Ep 2")];
	doc.playlists = {
		Custom: playlist("Custom", [episode("Ep 1"), episode("Ep 2")]),
		Commute: playlist("Commute", []),
	};
	doc.downloadedEpisodes = {
		"Pod A": [
			{ ...episode("Ep 1"), filePath: "Podcasts/Ep 1.mp3", size: 1 },
			{ ...episode("Ep 2"), filePath: "Podcasts/Ep 2.mp3", size: 2 },
		],
	};
	return doc;
}

const episodeLists: [string, (doc: Data) => PersistedEpisode[]][] = [
	["the queue", (doc) => doc.queue.episodes],
	["favorites", (doc) => doc.favorites.episodes],
	["local files", (doc) => doc.localFiles.episodes],
	["a playlist", (doc) => doc.playlists.Custom.episodes],
	["a podcast's downloads", (doc) => doc.downloadedEpisodes["Pod A"]],
];

const currentEpisodeHolders: [string, (doc: Data) => { currentEpisode?: PersistedEpisode }][] = [
	["the player", (doc) => doc],
	["the queue", (doc) => doc.queue],
	["a playlist", (doc) => doc.playlists.Custom],
];

describe("jsonValuesEqual", () => {
	it("treats key order as irrelevant for plain objects", () => {
		expect(jsonValuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
	});

	it("treats array order as significant", () => {
		expect(jsonValuesEqual([1, 2], [2, 1])).toBe(false);
	});
});

describe("threeWayMergeSettings", () => {
	it("keeps the feed, playlist and progress another device synced in while this device only advanced playback (#357)", () => {
		const base = data();
		const local = structuredClone(base);
		local.playedEpisodes["Pod A::Ep 1"].time = 120;
		const disk = structuredClone(base);
		disk.savedFeeds["Pod B"] = feed("Pod B");
		disk.playlists.Gym = playlist("Gym", [episode("Ep 2")]);
		disk.playedEpisodes["Pod A::Ep 2"] = played("Ep 2", 300);

		const expected = structuredClone(disk);
		expected.playedEpisodes["Pod A::Ep 1"].time = 120;
		expect(threeWayMergeSettings(base, local, disk)).toEqual(expected);
	});

	it("keeps local when disk matches base", () => {
		const base = data();
		const local = structuredClone(base);
		local.queue.episodes.push(episode("Ep 3"));

		expect(threeWayMergeSettings(base, local, structuredClone(base))).toEqual(local);
	});

	it("keeps disk when local matches base", () => {
		const base = data();
		const disk = structuredClone(base);
		disk.defaultVolume = 0.5;

		expect(threeWayMergeSettings(base, structuredClone(base), disk)).toEqual(disk);
	});

	it("prefers local on irreducible leaf conflicts", () => {
		const base = data();
		const local = structuredClone(base);
		local.defaultPlaybackRate = 1.5;
		const disk = structuredClone(base);
		disk.defaultPlaybackRate = 2;

		expect(threeWayMergeSettings(base, local, disk)).toEqual(local);
	});

	it("recurses into nested objects when both sides edit different keys", () => {
		const base = data();
		const local = structuredClone(base);
		local.timestamp.template = "- {{linktime}} ";
		const disk = structuredClone(base);
		disk.timestamp.offset = 5;

		const expected = structuredClone(local);
		expected.timestamp.offset = 5;
		expect(threeWayMergeSettings(base, local, disk)).toEqual(expected);
	});

	it("keeps unknown root fields another device added", () => {
		const base = data();
		const local = structuredClone(base);
		local.defaultVolume = 0.5;
		const disk = structuredClone(base);
		disk.futureSetting = { enabled: true };

		const expected = structuredClone(local);
		expected.futureSetting = { enabled: true };
		expect(threeWayMergeSettings(base, local, disk)).toEqual(expected);
	});

	it("keeps fields this version does not know inside every collection another device wrote", () => {
		const base = data();
		const local = structuredClone(base);
		local.defaultVolume = 0.5;
		const disk = structuredClone(base);
		Object.assign(disk.savedFeeds["Pod A"], { futureFeedField: 1 });
		Object.assign(disk.playedEpisodes["Pod A::Ep 1"], { futureProgressField: 2 });
		Object.assign(disk.queue.episodes[0], { futureEpisodeField: 3 });
		Object.assign(disk.playlists.Custom, { futurePlaylistField: 4 });
		Object.assign(disk.downloadedEpisodes["Pod A"][1], { futureDownloadField: 5 });

		const merged = threeWayMergeSettings(base, local, disk);

		expect(merged.defaultVolume).toBe(0.5);
		expect(merged.savedFeeds["Pod A"]).toMatchObject({ futureFeedField: 1 });
		expect(merged.playedEpisodes["Pod A::Ep 1"]).toMatchObject({ futureProgressField: 2 });
		expect(merged.queue.episodes[0]).toMatchObject({ futureEpisodeField: 3 });
		expect(merged.playlists.Custom).toMatchObject({ futurePlaylistField: 4 });
		expect(merged.downloadedEpisodes["Pod A"][1]).toMatchObject({ futureDownloadField: 5 });
	});

	it("merges different playlists edited on each side", () => {
		const base = data();
		const local = structuredClone(base);
		local.playlists.Custom.episodes.push(episode("Ep 3"));
		const disk = structuredClone(base);
		disk.playlists.Commute.shouldRepeat = true;

		const expected = structuredClone(local);
		expected.playlists.Commute.shouldRepeat = true;
		expect(threeWayMergeSettings(base, local, disk)).toEqual(expected);
	});

	it("keeps a playlist created elsewhere while this device added to another playlist", () => {
		const base = data();
		const local = structuredClone(base);
		local.playlists.Custom.episodes.push(episode("Ep 3"));
		const disk = structuredClone(base);
		disk.playlists.Gym = playlist("Gym", [episode("Ep 1")]);

		expect(threeWayMergeSettings(base, local, disk).playlists).toEqual({
			Custom: local.playlists.Custom,
			Commute: base.playlists.Commute,
			Gym: disk.playlists.Gym,
		});
	});

	it("merges an episode edited elsewhere into a queue this device also changed", () => {
		const base = data();
		const local = structuredClone(base);
		local.queue.episodes.push(episode("Ep 3"));
		const disk = structuredClone(base);
		disk.queue.episodes[0].description = "Edited elsewhere";

		expect(threeWayMergeSettings(base, local, disk).queue.episodes).toEqual([
			disk.queue.episodes[0],
			episode("Ep 2"),
			episode("Ep 3"),
		]);
	});

	it.each(episodeLists)(
		"keeps episodes both devices added to %s, in local order with disk-only additions last",
		(_, list) => {
			const base = data();
			const local = structuredClone(base);
			list(local).unshift(episode("Added here"));
			const disk = structuredClone(base);
			list(disk).push(episode("Added elsewhere"));

			expect(list(threeWayMergeSettings(base, local, disk))).toEqual([
				episode("Added here"),
				...list(base),
				episode("Added elsewhere"),
			]);
		},
	);

	it("keeps same-titled episodes from different podcasts apart (#356)", () => {
		const base = data();
		const local = structuredClone(base);
		local.queue.episodes.push(episode("Trailer", "Pod A"));
		const disk = structuredClone(base);
		disk.queue.episodes.push(episode("Trailer", "Pod B"));

		expect(threeWayMergeSettings(base, local, disk).queue.episodes).toEqual([
			...base.queue.episodes,
			episode("Trailer", "Pod A"),
			episode("Trailer", "Pod B"),
		]);
	});

	it("keys an episode without a podcast name by its title", () => {
		const base = data();
		base.queue.episodes = [episode("Legacy", "")];
		const local = structuredClone(base);
		local.queue.episodes.push(episode("Ep 3"));
		const disk = structuredClone(base);
		disk.queue.episodes[0].description = "Edited elsewhere";

		expect(threeWayMergeSettings(base, local, disk).queue.episodes).toEqual([
			disk.queue.episodes[0],
			episode("Ep 3"),
		]);
	});

	it("never merges untitled episodes by key: local ones stay in place, disk-only ones are dropped", () => {
		const untitled = (id: string) => ({
			...episode(""),
			streamUrl: `https://example.com/${id}.mp3`,
		});
		const base = data();
		base.queue.episodes = [episode("Ep 1")];
		const local = structuredClone(base);
		local.queue.episodes = [untitled("a"), episode("Ep 1"), untitled("b")];
		const disk = structuredClone(base);
		disk.queue.episodes = [episode("Ep 1"), untitled("c"), episode("Ep 2")];

		expect(threeWayMergeSettings(base, local, disk).queue.episodes).toEqual([
			untitled("a"),
			episode("Ep 1"),
			untitled("b"),
			episode("Ep 2"),
		]);
	});

	it("keeps an episode removed here removed even when another device edited it", () => {
		const base = data();
		const local = structuredClone(base);
		local.queue.episodes = [episode("Ep 2")];
		const disk = structuredClone(base);
		disk.queue.episodes[0].description = "Edited elsewhere";

		expect(threeWayMergeSettings(base, local, disk).queue.episodes).toEqual([episode("Ep 2")]);
	});

	it("drops an episode removed elsewhere when this device left it unchanged", () => {
		const base = data();
		const local = structuredClone(base);
		local.queue.episodes.push(episode("Ep 3"));
		const disk = structuredClone(base);
		disk.queue.episodes = [episode("Ep 2")];

		expect(threeWayMergeSettings(base, local, disk).queue.episodes).toEqual([
			episode("Ep 2"),
			episode("Ep 3"),
		]);
	});

	it("keeps an episode edited here when another device removed it", () => {
		const base = data();
		const local = structuredClone(base);
		local.queue.episodes[0].description = "Edited here";
		const disk = structuredClone(base);
		disk.queue.episodes = [episode("Ep 2")];

		expect(threeWayMergeSettings(base, local, disk).queue.episodes).toEqual(
			local.queue.episodes,
		);
	});

	it("takes a download both devices changed whole from this device, in downloads and Local Files", () => {
		const download = (title: string, streamUrl: string, filePath: string, size: number) => ({
			...episode(title),
			streamUrl,
			filePath,
			size,
		});
		const base = data();
		base.downloadedEpisodes = {
			"Pod A": [download("Ep 1", "U", "P0", 1), download("Ep 2", "W", "Q0", 1)],
		};
		base.localFiles.episodes = [download("Ep 1", "U", "P0", 1)];
		const local = structuredClone(base);
		local.downloadedEpisodes["Pod A"][0] = download("Ep 1", "U", "P1", 2);
		local.localFiles.episodes[0] = download("Ep 1", "U", "P1", 2);
		const disk = structuredClone(base);
		disk.downloadedEpisodes["Pod A"] = [
			download("Ep 1", "V", "P2", 3),
			download("Ep 2", "W", "Q1", 4),
			download("Ep 3", "X", "R0", 5),
		];
		disk.localFiles.episodes[0] = download("Ep 1", "V", "P2", 3);

		const merged = threeWayMergeSettings(base, local, disk);

		expect(merged.downloadedEpisodes["Pod A"]).toEqual([
			download("Ep 1", "U", "P1", 2),
			download("Ep 2", "W", "Q1", 4),
			download("Ep 3", "X", "R0", 5),
		]);
		expect(merged.localFiles.episodes).toEqual([download("Ep 1", "U", "P1", 2)]);
	});

	it("never marks a file this device registered as one PodNotes downloaded because another device downloaded the episode", () => {
		const base = data();
		const local = structuredClone(base);
		local.downloadedEpisodes["Pod A"][0].filePath = "Recordings/Ep 1.mp3";
		const disk = structuredClone(base);
		disk.downloadedEpisodes["Pod A"][0] = {
			...base.downloadedEpisodes["Pod A"][0],
			filePath: "Podcasts/Ep 1 (1).mp3",
			downloadedByPodNotes: true,
		};

		expect(threeWayMergeSettings(base, local, disk).downloadedEpisodes["Pod A"][0]).toEqual(
			local.downloadedEpisodes["Pod A"][0],
		);
	});

	it("never mixes a queued episode's stream URL and file path from two devices", () => {
		const base = data();
		base.queue.episodes = [{ ...episode("Ep 1"), streamUrl: "U" }];
		const local = structuredClone(base);
		local.queue.episodes = [{ ...episode("Ep 1"), streamUrl: "U", filePath: "P1" }];
		const disk = structuredClone(base);
		disk.queue.episodes = [{ ...episode("Ep 1"), streamUrl: "V" }];

		expect(threeWayMergeSettings(base, local, disk).queue.episodes).toEqual([
			{ ...episode("Ep 1"), streamUrl: "U", filePath: "P1" },
		]);
	});

	it("keeps this device's whole progress record when both devices changed it", () => {
		const base = data();
		const local = structuredClone(base);
		local.playedEpisodes["Pod A::Ep 1"].time = 120;
		const disk = structuredClone(base);
		disk.playedEpisodes["Pod A::Ep 1"] = played("Ep 1", 3600, true);

		expect(threeWayMergeSettings(base, local, disk).playedEpisodes).toEqual({
			"Pod A::Ep 1": played("Ep 1", 120),
		});
	});

	it("keeps this device's whole saved feed when both devices changed it, private feed secret included", () => {
		const show = { title: "Show", url: "https://example.com/u0.xml", artworkUrl: "" };
		const base = data();
		base.savedFeeds = { Show: show, "Pod A": feed("Pod A"), "Pod B": feed("Pod B") };
		const local = structuredClone(base);
		local.savedFeeds.Show.url = "https://example.com/u1.xml";
		local.savedFeeds["Pod A"].artworkUrl = "https://example.com/a.png";
		const disk = structuredClone(base);
		disk.savedFeeds.Show = { ...show, url: "podnotes-private-feed:Show", urlSecretId: "S" };
		disk.savedFeeds["Pod B"].artworkUrl = "https://example.com/b.png";

		expect(threeWayMergeSettings(base, local, disk).savedFeeds).toEqual({
			Show: { ...show, url: "https://example.com/u1.xml" },
			"Pod A": { ...feed("Pod A"), artworkUrl: "https://example.com/a.png" },
			"Pod B": { ...feed("Pod B"), artworkUrl: "https://example.com/b.png" },
		});
	});

	it("keeps this device's whole note mapping when both devices changed it", () => {
		const base = data();
		base.podNotes = {
			"Ep 1": { episodeName: "Ep 1", filePath: "P0", podcastFeedKey: "Pod A" },
		};
		const local = structuredClone(base);
		local.podNotes["Ep 1"].filePath = "P1";
		const disk = structuredClone(base);
		disk.podNotes["Ep 1"].podcastFeedKey = "Pod B";

		expect(threeWayMergeSettings(base, local, disk).podNotes).toEqual(local.podNotes);
	});

	it("takes a progress record only another device changed", () => {
		const base = data();
		const local = structuredClone(base);
		local.playedEpisodes["Pod A::Ep 2"] = played("Ep 2", 50);
		const disk = structuredClone(base);
		disk.playedEpisodes["Pod A::Ep 1"] = played("Ep 1", 3600, true);

		expect(threeWayMergeSettings(base, local, disk).playedEpisodes).toEqual({
			"Pod A::Ep 1": played("Ep 1", 3600, true),
			"Pod A::Ep 2": played("Ep 2", 50),
		});
	});

	it.each(currentEpisodeHolders)(
		"keeps this device's whole current episode in %s when both devices switched episodes",
		(_, holder) => {
			const base = data();
			holder(base).currentEpisode = episode("Ep 1", "Pod A");
			const local = structuredClone(base);
			holder(local).currentEpisode = episode("Ep 2", "Pod A");
			const disk = structuredClone(base);
			holder(disk).currentEpisode = episode("Other", "Pod B");

			expect(holder(threeWayMergeSettings(base, local, disk)).currentEpisode).toEqual(
				episode("Ep 2", "Pod A"),
			);
		},
	);

	it("merges a playlist the user named like a playlist field per key, not whole", () => {
		const base = data();
		base.playlists.currentEpisode = playlist("currentEpisode", [episode("Ep 1")]);
		const local = structuredClone(base);
		local.playlists.currentEpisode.icon = "star";
		const disk = structuredClone(base);
		disk.playlists.currentEpisode.episodes.push(episode("Ep 2"));

		expect(threeWayMergeSettings(base, local, disk).playlists.currentEpisode).toEqual({
			...playlist("currentEpisode", [episode("Ep 1"), episode("Ep 2")]),
			icon: "star",
		});
	});

	it("writes no undefined field, so the merged document equals itself read back", () => {
		const base = data();
		const local = structuredClone(base);
		delete local.currentEpisode;
		const disk = structuredClone(base);
		disk.currentEpisode = episode("Ep 2");

		const merged = threeWayMergeSettings(base, local, disk);
		expect(jsonValuesEqual(merged, JSON.parse(JSON.stringify(merged)))).toBe(true);
		expect(merged).toEqual(local);
	});

	it("keeps an episode queued elsewhere when this device only advanced playback (#357)", () => {
		const base = data();
		const local = structuredClone(base);
		local.playedEpisodes["Pod A::Ep 1"].time = 120;
		const disk = structuredClone(base);
		disk.queue.episodes.push(episode("Ep 3"));

		const merged = threeWayMergeSettings(base, local, disk);
		expect(merged.queue.episodes).toEqual(disk.queue.episodes);
		expect(merged.playedEpisodes).toEqual(local.playedEpisodes);
	});
});

describe("restoreDropped", () => {
	it("puts back the entries the codec dropped and keeps every entry still there whole", () => {
		const base = data();
		base.savedFeeds = {
			Show: { ...feed("Show"), url: "podnotes-private-feed:Show", urlSecretId: "S" },
			"Pod A": feed("Pod A"),
		};
		const disk = structuredClone(base);
		disk.savedFeeds = { Show: { ...feed("Show"), url: "https://example.com/u1.xml" } };
		disk.queue.episodes = [{ ...episode("Ep 2"), description: "Edited elsewhere" }];
		const raw = structuredClone(disk) as unknown as Record<string, Record<string, unknown>>;
		raw.savedFeeds["Pod A"] = "not a feed";
		raw.queue.episodes = [...disk.queue.episodes, { title: 1 }];

		expect(
			restoreDropped(base.savedFeeds, disk.savedFeeds, raw.savedFeeds, ["savedFeeds"]),
		).toEqual({
			Show: { ...feed("Show"), url: "https://example.com/u1.xml" },
			"Pod A": feed("Pod A"),
		});
		expect(restoreDropped(base.queue, disk.queue, raw.queue, ["queue"]).episodes).toEqual([
			{ ...episode("Ep 2"), description: "Edited elsewhere" },
			episode("Ep 1"),
		]);
	});

	it("leaves out the entries the other device removed", () => {
		const base = data();
		base.savedFeeds = { "Pod A": feed("Pod A"), "Pod B": feed("Pod B") };
		const disk = structuredClone(base);
		delete disk.savedFeeds["Pod A"];
		disk.savedFeeds["Pod B"].collectionId = "7";
		disk.queue.episodes = [episode("Ep 2"), { ...episode("Ep 3"), filePath: "Ep 3.mp3" }];
		const raw = structuredClone(disk) as unknown as Record<string, Record<string, unknown>>;
		(raw.savedFeeds["Pod B"] as Record<string, unknown>).collectionId = 7;
		(raw.queue.episodes as Record<string, unknown>[])[1].filePath = 3;

		expect(
			restoreDropped(base.savedFeeds, disk.savedFeeds, raw.savedFeeds, ["savedFeeds"]),
		).toEqual(disk.savedFeeds);
		expect(restoreDropped(base.queue, disk.queue, raw.queue, ["queue"])).toEqual(disk.queue);
	});
});
