import { describe, expect, it } from "vitest";
import {
	MAX_FEEDS,
	MAX_PLAYLIST_EPISODE_REFERENCES,
	MAX_TITLE_BYTES,
	validateLibraryV3,
} from "./libraryModel";
import {
	cloneLibrary,
	foreignFeedId,
	localEpisodeId,
	localFeedId,
	missingEpisodeId,
	playlist,
	remoteCapabilityRef,
	remoteEpisodeId,
	remoteFeedId,
	secondRemoteEpisodeId,
} from "./__tests__/fixtures";
import { serializedLibraryFits } from "./scalars";

describe("schema-v3 hostile input rejection", () => {
	it("does not classify non-serializable roots as fitting the byte budget", () => {
		expect(serializedLibraryFits(undefined)).toBe(false);
		expect(serializedLibraryFits(Symbol("unsupported"))).toBe(false);
	});

	it.each([
		["feed url", "feed", "url"],
		["feed artwork", "feed", "artworkUrl"],
		["feed site link", "feed", "link"],
		["episode url", "episode", "url"],
		["stream target", "episode", "streamUrl"],
		["feed target", "episode", "feedUrl"],
		["episode artwork", "episode", "artworkUrl"],
		["chapters target", "episode", "chaptersUrl"],
		["raw guid", "episode", "guid"],
		["episode target reference", "episode", "targetRef"],
		["legacy HTML content", "episode", "content"],
	])("rejects hidden target field %s", (_label, owner, field) => {
		const value = cloneLibrary();
		const target =
			owner === "feed" ? value.feeds[remoteFeedId] : value.episodes[remoteEpisodeId];
		target[field] =
			field === "content"
				? "<a href='https://secret.example'>secret</a>"
				: "https://secret.example/value";
		expect(validateLibraryV3(value)).toBeNull();
	});

	it.each(["descriptionText", "contentText"])(
		"rejects HTML disguised as target-free episode %s",
		(field) => {
			const value = cloneLibrary();
			value.episodes[remoteEpisodeId][field] =
				"<img src='https://secret.example/pixel?token=value'>";
			expect(validateLibraryV3(value)).toBeNull();
		},
	);

	it("rejects HTML disguised as target-free feed description text", () => {
		const value = cloneLibrary();
		value.feeds[remoteFeedId].descriptionText =
			"<img src='https://secret.example/pixel?token=value'>";
		expect(validateLibraryV3(value)).toBeNull();
	});

	it("rejects a capability reference on a local feed", () => {
		const value = cloneLibrary();
		value.feeds[localFeedId].capabilityRef = remoteCapabilityRef;
		expect(validateLibraryV3(value)).toBeNull();
	});

	it("rejects a nested legacy playlist currentEpisode snapshot", () => {
		const value = cloneLibrary();
		value.queue.currentEpisode = {
			...value.episodes[remoteEpisodeId],
			streamUrl: "https://secret.example/audio.mp3",
		};
		expect(validateLibraryV3(value)).toBeNull();
	});

	it("rejects cross-feed and kind ownership mismatches", () => {
		const crossFeed = cloneLibrary();
		crossFeed.episodes[remoteEpisodeId].feedId = localFeedId;
		expect(validateLibraryV3(crossFeed)).toBeNull();

		const wrongKind = cloneLibrary();
		wrongKind.episodes[remoteEpisodeId].kind = "local";
		expect(validateLibraryV3(wrongKind)).toBeNull();

		const foreignOwner = cloneLibrary();
		foreignOwner.episodes[remoteEpisodeId].feedId = foreignFeedId;
		expect(validateLibraryV3(foreignOwner)).toBeNull();
	});

	it("rejects missing references from every top-level reference map", () => {
		const current = cloneLibrary();
		current.currentEpisodeId = missingEpisodeId;
		expect(validateLibraryV3(current)).toBeNull();

		const progress = cloneLibrary();
		progress.progress[missingEpisodeId] = {
			episodeId: missingEpisodeId,
			time: 0,
			duration: 0,
			finished: false,
		};
		expect(validateLibraryV3(progress)).toBeNull();

		const note = cloneLibrary();
		note.podNotes[missingEpisodeId] = {
			episodeId: missingEpisodeId,
			filePath: "PodNotes/Missing.md",
		};
		expect(validateLibraryV3(note)).toBeNull();

		const download = cloneLibrary();
		download.downloads[missingEpisodeId] = [{ filePath: "PodNotes/Missing.mp3", size: 100 }];
		expect(validateLibraryV3(download)).toBeNull();
	});

	it("rejects prototype-pollution keys at every map boundary", () => {
		const root = cloneLibrary();
		Object.setPrototypeOf(root, { polluted: true });
		expect(validateLibraryV3(root)).toBeNull();

		const feeds = cloneLibrary();
		Object.defineProperty(feeds.feeds, "constructor", {
			value: { feedId: remoteFeedId },
			enumerable: true,
		});
		expect(validateLibraryV3(feeds)).toBeNull();

		const playlists = cloneLibrary();
		Object.defineProperty(playlists.playlists, "prototype", {
			value: playlist("prototype"),
			enumerable: true,
		});
		expect(validateLibraryV3(playlists)).toBeNull();
	});

	it("rejects count and string bombs before accepting the model", () => {
		const tooManyFeeds = cloneLibrary();
		tooManyFeeds.feeds = Object.fromEntries(
			Array.from({ length: MAX_FEEDS + 1 }, (_, index) => {
				const hex = index.toString(16).padStart(64, "0");
				const feedId = `podnotes-feed-${hex}`;
				return [feedId, { feedId, kind: "local", title: `Feed ${index}` }];
			}),
		);
		expect(validateLibraryV3(tooManyFeeds)).toBeNull();

		const tooManyRefs = cloneLibrary();
		tooManyRefs.queue.episodeIds = Array.from(
			{ length: MAX_PLAYLIST_EPISODE_REFERENCES + 1 },
			() => remoteEpisodeId,
		);
		expect(validateLibraryV3(tooManyRefs)).toBeNull();

		const longTitle = cloneLibrary();
		longTitle.feeds[remoteFeedId].title = "x".repeat(MAX_TITLE_BYTES + 1);
		expect(validateLibraryV3(longTitle)).toBeNull();
	});

	it.each([
		"not-a-date",
		"2026-02-30T12:00:00Z",
		"2026-01-01",
		"2026-01-01T25:00:00Z",
		"2026-01-01T12:00:00",
		"0001-01-01T00:00:00+23:59",
		"9999-12-31T23:59:59-23:59",
	])("rejects invalid or timezone-free date %s", (episodeDate) => {
		const value = cloneLibrary();
		value.episodes[remoteEpisodeId].episodeDate = episodeDate;
		expect(validateLibraryV3(value)).toBeNull();
	});

	it.each([
		"/absolute/file.mp3",
		"../escape.mp3",
		"Audio/../escape.mp3",
		"Audio\\file.mp3",
		"https://secret.example/file.mp3",
		"C:/absolute/file.mp3",
		"Audio//file.mp3",
		"Audio/",
		" Audio/file.mp3",
		".obsidian/plugins/podnotes/data.json",
		".TRASH/deleted.mp3",
		".Git/config",
		".Hg/store",
		".SvN/entries",
		"Audio/CON",
		"Audio/prn.mp3",
		"Audio/COM1.wav",
		"Audio/lPt9.txt",
		"Audio/bad<name>.mp3",
		"Audio/bad:name.mp3",
		"Audio/file.mp3.",
		"Audio./file.mp3",
		"Audio/Cafe\u0301.mp3",
	])("rejects non-canonical vault path %s", (filePath) => {
		const value = cloneLibrary();
		value.localAssets[localEpisodeId].filePath = filePath;
		expect(validateLibraryV3(value)).toBeNull();
	});

	it("rejects local-vs-remote asset mismatches", () => {
		const remoteLocalAsset = cloneLibrary();
		remoteLocalAsset.localAssets[remoteEpisodeId] = {
			episodeId: remoteEpisodeId,
			filePath: "Audio/remote.mp3",
		};
		expect(validateLibraryV3(remoteLocalAsset)).toBeNull();

		const localDownload = cloneLibrary();
		localDownload.downloads[localEpisodeId] = [{ filePath: "Audio/local.mp3", size: 100 }];
		expect(validateLibraryV3(localDownload)).toBeNull();

		const remoteInLocalFiles = cloneLibrary();
		remoteInLocalFiles.localFiles.episodeIds.push(remoteEpisodeId);
		expect(validateLibraryV3(remoteInLocalFiles)).toBeNull();
	});

	it("rejects media paths claimed by more than one episode", () => {
		const value = cloneLibrary();
		value.episodes[secondRemoteEpisodeId] = {
			...value.episodes[remoteEpisodeId],
			episodeId: secondRemoteEpisodeId,
			title: "Second remote episode",
		};
		value.downloads[secondRemoteEpisodeId] = [
			{
				filePath: value.downloads[remoteEpisodeId][0].filePath,
				size: 4096,
			},
		];

		expect(validateLibraryV3(value)).toBeNull();
	});

	it("rejects a download path colliding with a local asset", () => {
		const value = cloneLibrary();
		value.downloads[remoteEpisodeId][0].filePath = value.localAssets[localEpisodeId].filePath;
		expect(validateLibraryV3(value)).toBeNull();
	});

	it("rejects a pod-note path colliding with a media asset", () => {
		const value = cloneLibrary();
		value.podNotes[remoteEpisodeId].filePath = value.downloads[remoteEpisodeId][0].filePath;
		expect(validateLibraryV3(value)).toBeNull();
	});

	it("rejects two pod notes that claim the same portable path", () => {
		const value = cloneLibrary();
		value.episodes[secondRemoteEpisodeId] = {
			...value.episodes[remoteEpisodeId],
			episodeId: secondRemoteEpisodeId,
		};
		value.podNotes[remoteEpisodeId].filePath = "PodNotes/Caf\u00e9.md";
		value.podNotes[secondRemoteEpisodeId] = {
			episodeId: secondRemoteEpisodeId,
			filePath: "podnotes/CAF\u00c9.md",
		};
		expect(validateLibraryV3(value)).toBeNull();
	});

	it("rejects case-insensitive aliases across download and local assets", () => {
		const value = cloneLibrary();
		value.localAssets[localEpisodeId].filePath =
			value.downloads[remoteEpisodeId][0].filePath.toUpperCase();
		expect(validateLibraryV3(value)).toBeNull();
	});
});
