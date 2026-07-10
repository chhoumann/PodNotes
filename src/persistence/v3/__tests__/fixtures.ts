import type { EpisodeHandle, FeedHandle } from "src/security/resourceHandles";
import { feedCapabilityReferenceForAttempt } from "src/security/feedCapabilityReferences";
import { LIBRARY_V3_SCHEMA_VERSION } from "../libraryModel";

export const remoteFeedId = `podnotes-feed-${"11".repeat(32)}` as FeedHandle;
export const localFeedId = `podnotes-feed-${"22".repeat(32)}` as FeedHandle;
export const foreignFeedId = `podnotes-feed-${"55".repeat(32)}` as FeedHandle;
export const remoteEpisodeId = `podnotes-episode-${"33".repeat(32)}` as EpisodeHandle;
export const localEpisodeId = `podnotes-episode-${"44".repeat(32)}` as EpisodeHandle;
export const missingEpisodeId = `podnotes-episode-${"66".repeat(32)}` as EpisodeHandle;
export const secondRemoteEpisodeId = `podnotes-episode-${"77".repeat(32)}` as EpisodeHandle;
export const remoteCapabilityRef = feedCapabilityReferenceForAttempt(remoteFeedId, 1)!;
export const foreignCapabilityRef = feedCapabilityReferenceForAttempt(foreignFeedId, 1)!;

export function playlist(name: string, episodeIds: EpisodeHandle[] = []) {
	return {
		name,
		icon: "list",
		episodeIds,
		shouldEpisodeRemoveAfterPlay: false,
		shouldRepeat: false,
	};
}

export function validLibrary(): Record<string, unknown> {
	return {
		schemaVersion: LIBRARY_V3_SCHEMA_VERSION,
		feeds: {
			[remoteFeedId]: {
				feedId: remoteFeedId,
				kind: "remote",
				capabilityRef: remoteCapabilityRef,
				title: "Remote show",
				collectionId: "12345",
				author: "Host",
				descriptionText: "A target-free feed description.",
			},
			[localFeedId]: {
				feedId: localFeedId,
				kind: "local",
				title: "Local files",
			},
		},
		episodes: {
			[remoteEpisodeId]: {
				episodeId: remoteEpisodeId,
				feedId: remoteFeedId,
				kind: "remote",
				title: "Remote episode",
				descriptionText: "Description",
				contentText: "Show notes\nwithout active markup.",
				episodeDate: "2026-07-10T10:20:30Z",
				itunesTitle: "Remote episode",
				episodeNumber: 12,
				duration: 1234,
				mediaType: "audio",
			},
			[localEpisodeId]: {
				episodeId: localEpisodeId,
				feedId: localFeedId,
				kind: "local",
				title: "Local episode",
				mediaType: "audio",
			},
		},
		queue: {
			...playlist("Queue", [remoteEpisodeId]),
			currentEpisodeId: remoteEpisodeId,
			shouldEpisodeRemoveAfterPlay: true,
		},
		favorites: playlist("Favorites", [remoteEpisodeId]),
		localFiles: playlist("Local Files", [localEpisodeId]),
		playlists: {
			Research: playlist("Research", [localEpisodeId, remoteEpisodeId]),
		},
		currentEpisodeId: remoteEpisodeId,
		progress: {
			[remoteEpisodeId]: {
				episodeId: remoteEpisodeId,
				time: 42.5,
				duration: 1234,
				finished: false,
			},
		},
		podNotes: {
			[remoteEpisodeId]: {
				episodeId: remoteEpisodeId,
				filePath: "PodNotes/Remote show/Remote episode.md",
			},
		},
		downloads: {
			[remoteEpisodeId]: [
				{
					filePath: "PodNotes/Remote show/Remote episode.mp3",
					size: 4096,
				},
			],
		},
		localAssets: {
			[localEpisodeId]: {
				episodeId: localEpisodeId,
				filePath: "Audio/Local episode.mp3",
			},
		},
		extensions: { schemaVersion: 1 },
	};
}

export function cloneLibrary(): Record<string, any> {
	return structuredClone(validLibrary());
}
