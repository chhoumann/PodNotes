import { describe, expect, test } from "vitest";
import type { Episode } from "src/types/Episode";
import type { LocalEpisode } from "src/types/LocalEpisode";
import {
	getEpisodeMediaType,
	getMediaTypeFromContentType,
	isSameMediaSource,
} from "./mediaType";

describe("mediaType", () => {
	test("detects media type from enclosure content type", () => {
		expect(getMediaTypeFromContentType("video/mp4")).toBe("video");
		expect(getMediaTypeFromContentType("Audio/MPEG; charset=utf-8")).toBe(
			"audio",
		);
		expect(getMediaTypeFromContentType("application/rss+xml")).toBeNull();
	});

	test("falls back to the stream URL extension for older episode records", () => {
		const episode = {
			title: "Video",
			streamUrl: "https://example.com/show/video.MP4?token=abc",
			url: "https://example.com/show/video",
			description: "",
			content: "",
			podcastName: "Feed",
		} satisfies Episode;

		expect(getEpisodeMediaType(episode)).toBe("video");
	});

	test("falls back to a local file path before a resource URL", () => {
		const episode = {
			title: "Local Video",
			streamUrl: "app://resource/no-extension?123",
			url: "[[Videos/local.mp4]]",
			description: "",
			content: "",
			podcastName: "local file",
			filePath: "Videos/local.mp4",
		} satisfies LocalEpisode;

		expect(getEpisodeMediaType(episode)).toBe("video");
	});

	test("falls back to a downloaded file path for old cached records", () => {
		const episode = {
			title: "Downloaded Video",
			streamUrl: "https://example.com/watch?id=42",
			url: "https://example.com/watch?id=42",
			description: "",
			content: "",
			podcastName: "Feed",
			filePath: "Podcasts/downloaded-video.webm",
		} satisfies Episode & { filePath: string };

		expect(getEpisodeMediaType(episode)).toBe("video");
	});

	test("trusts explicit audio metadata before downloaded path fallback", () => {
		const episode = {
			title: "Downloaded Audio WebM",
			streamUrl: "https://example.com/episode.webm",
			url: "https://example.com/episode",
			description: "",
			content: "",
			podcastName: "Feed",
			mediaType: "audio",
			filePath: "Podcasts/downloaded-audio.webm",
		} satisfies Episode & { filePath: string };

		expect(getEpisodeMediaType(episode)).toBe("audio");
	});

	test("trusts explicit audio metadata for mp4 file paths", () => {
		const episode = {
			title: "Downloaded Audio MP4",
			streamUrl: "https://example.com/episode.mp4",
			url: "https://example.com/episode",
			description: "",
			content: "",
			podcastName: "Feed",
			mediaType: "audio",
			filePath: "Podcasts/downloaded-audio.mp4",
		} satisfies Episode & { filePath: string };

		expect(getEpisodeMediaType(episode)).toBe("audio");
	});

	test("trusts remote episode media metadata before URL extension fallback", () => {
		expect(
			getEpisodeMediaType({
				title: "Audio MP4",
				streamUrl: "https://example.com/video.mp4",
				url: "https://example.com/video",
				description: "",
				content: "",
				podcastName: "Feed",
				mediaType: "audio",
			} satisfies Episode),
		).toBe("audio");
		expect(
			getEpisodeMediaType({
				title: "Video Metadata",
				streamUrl: "https://example.com/audio.mp3",
				url: "https://example.com/audio",
				description: "",
				content: "",
				podcastName: "Feed",
				mediaType: "video",
			} satisfies Episode),
		).toBe("video");
	});

	test("compares remote sources while ignoring signed query token rotation", () => {
		expect(
			isSameMediaSource(
				"https://cdn.example.com/video.mp4?token=old",
				"https://cdn.example.com/video.mp4?token=new",
			),
		).toBe(true);
		expect(
			isSameMediaSource(
				"https://cdn.example.com/video.mp4",
				"https://cdn.example.com/audio.mp3",
			),
		).toBe(false);
	});

	test("requires exact query strings for extensionless remote sources", () => {
		expect(
			isSameMediaSource(
				"https://cdn.example.com/watch?id=1",
				"https://cdn.example.com/watch?id=2",
			),
		).toBe(false);
		expect(
			isSameMediaSource(
				"https://cdn.example.com/watch?id=1",
				"https://cdn.example.com/watch?id=1",
			),
		).toBe(true);
	});
});
