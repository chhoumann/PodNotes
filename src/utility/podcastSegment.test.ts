import { describe, expect, test } from "vitest";
import {
	createRecentPodcastSegment,
	formatPodcastSegment,
	getSegmentCaptureTemplate,
	normalizePodcastSegmentTimes,
} from "./podcastSegment";

describe("normalizePodcastSegmentTimes", () => {
	test("normalizes valid positive segment ranges", () => {
		expect(normalizePodcastSegmentTimes(115, 125)).toEqual({
			startTime: 115,
			endTime: 125,
		});
	});

	test("rejects non-finite and non-positive ranges", () => {
		expect(normalizePodcastSegmentTimes(Number.NaN, 125)).toBeNull();
		expect(normalizePodcastSegmentTimes(125, Number.POSITIVE_INFINITY)).toBeNull();
		expect(normalizePodcastSegmentTimes(125, 125)).toBeNull();
		expect(normalizePodcastSegmentTimes(126, 125)).toBeNull();
	});
});

describe("createRecentPodcastSegment", () => {
	test("creates a trailing segment ending at the adjusted playback time", () => {
		expect(createRecentPodcastSegment(125, 10, 3)).toEqual({
			startTime: 112,
			endTime: 122,
		});
	});

	test("clamps the start to zero", () => {
		expect(createRecentPodcastSegment(5, 10, 0)).toEqual({
			startTime: 0,
			endTime: 5,
		});
	});

	test("returns null when no positive segment can be captured", () => {
		expect(createRecentPodcastSegment(0, 10, 0)).toBeNull();
		expect(createRecentPodcastSegment(125, 0, 0)).toBeNull();
	});
});

describe("formatPodcastSegment", () => {
	test("formats start and end with the same clock format", () => {
		expect(formatPodcastSegment(115, 125, "HH:mm:ss")).toBe(
			"00:01:55-00:02:05",
		);
	});
});

describe("getSegmentCaptureTemplate", () => {
	test("turns the default timestamp tags into segment tags", () => {
		expect(getSegmentCaptureTemplate("- {{linktime}}")).toBe(
			"- {{linksegment}}",
		);
		expect(getSegmentCaptureTemplate("- {{time:mm:ss}}")).toBe(
			"- {{segment:mm:ss}}",
		);
	});

	test("preserves an explicit segment template", () => {
		expect(getSegmentCaptureTemplate("> {{linksegment}}")).toBe(
			"> {{linksegment}}",
		);
	});

	test("falls back to a linked segment when no time tag exists", () => {
		expect(getSegmentCaptureTemplate("captured")).toBe("- {{linksegment}}");
	});
});
