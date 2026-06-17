import { describe, expect, test } from "vitest";
import type { Episode } from "src/types/Episode";
import type { LocalEpisode } from "src/types/LocalEpisode";
import {
	getEpisodeMediaType,
	getEpisodeMediaTypeWithContainerHint,
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

	test("falls back to unambiguous stream URL extensions for older episode records", () => {
		const episode = {
			title: "Video",
			streamUrl: "https://example.com/show/video.MOV?token=abc",
			url: "https://example.com/show/video",
			description: "",
			content: "",
			podcastName: "Feed",
		} satisfies Episode;

		expect(getEpisodeMediaType(episode)).toBe("video");
	});

	test("falls back to unambiguous local file paths before resource URLs", () => {
		const episode = {
			title: "Local Video",
			streamUrl: "app://resource/no-extension?123",
			url: "[[Videos/local.mov]]",
			description: "",
			content: "",
			podcastName: "local file",
			filePath: "Videos/local.mov",
		} satisfies LocalEpisode;

		expect(getEpisodeMediaType(episode)).toBe("video");
	});

	test("falls back to unambiguous downloaded file paths for old cached records", () => {
		const episode = {
			title: "Downloaded Video",
			streamUrl: "https://example.com/watch?id=42",
			url: "https://example.com/watch?id=42",
			description: "",
			content: "",
			podcastName: "Feed",
			filePath: "Podcasts/downloaded-video.ogv",
		} satisfies Episode & { filePath: string };

		expect(getEpisodeMediaType(episode)).toBe("video");
	});

	test("preserves legacy ambiguous mp4 and webm records as audio", () => {
		for (const extension of ["mp4", "webm"]) {
			const episode = {
				title: `Legacy Audio ${extension}`,
				streamUrl: `https://example.com/episode.${extension}`,
				url: "https://example.com/episode",
				description: "",
				content: "",
				podcastName: "Feed",
				filePath: `Podcasts/downloaded-audio.${extension}`,
			} satisfies Episode & { filePath: string };

			expect(getEpisodeMediaType(episode)).toBe("audio");
		}
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

	test("audio hints keep legacy ambiguous container file paths as audio", () => {
		const episode = {
			title: "Legacy Downloaded Audio MP4",
			streamUrl: "https://example.com/episode.mp4",
			url: "https://example.com/episode",
			description: "",
			content: "",
			podcastName: "Feed",
			filePath: "Podcasts/downloaded-audio.mp4",
		} satisfies Episode & { filePath: string };

		expect(getEpisodeMediaType(episode)).toBe("audio");
		expect(getEpisodeMediaTypeWithContainerHint(episode, "audio")).toBe(
			"audio",
		);
	});

	test("video hints classify legacy ambiguous container file paths as video", () => {
		const episode = {
			title: "Legacy Downloaded Video MP4",
			streamUrl: "https://example.com/episode.mp4",
			url: "https://example.com/episode",
			description: "",
			content: "",
			podcastName: "Feed",
			filePath: "Podcasts/downloaded-video.mp4",
		} satisfies Episode & { filePath: string };

		expect(getEpisodeMediaType(episode)).toBe("audio");
		expect(getEpisodeMediaTypeWithContainerHint(episode, "video")).toBe(
			"video",
		);
	});

	test("does not let an audio hint override explicit video metadata", () => {
		const episode = {
			title: "Downloaded Video MP4",
			streamUrl: "https://example.com/episode.mp4",
			url: "https://example.com/episode",
			description: "",
			content: "",
			podcastName: "Feed",
			mediaType: "video",
			filePath: "Podcasts/downloaded-video.mp4",
		} satisfies Episode & { filePath: string };

		expect(getEpisodeMediaTypeWithContainerHint(episode, "audio")).toBe(
			"video",
		);
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
				"https://cdn.example.com/episode.mp4?id=1&token=old",
				"https://cdn.example.com/episode.mp4?id=1&token=new",
			),
		).toBe(true);
		expect(
			isSameMediaSource(
				"https://cdn.example.com/episode.mp4?id=1",
				"https://cdn.example.com/episode.mp4?id=2",
			),
		).toBe(false);
		expect(
			isSameMediaSource(
				"https://cdn.example.com/video.mp4",
				"https://cdn.example.com/audio.mp3",
			),
		).toBe(false);
	});

	test("compares extensionless remote sources by stable query params", () => {
		expect(
			isSameMediaSource(
				"https://cdn.example.com/download?id=123&token=old&exp=1",
				"https://cdn.example.com/download?id=123&token=new&exp=2",
			),
		).toBe(true);
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
		expect(
			isSameMediaSource(
				"https://cdn.example.com/download?token=old",
				"https://cdn.example.com/download?token=new",
			),
		).toBe(false);
	});
});
