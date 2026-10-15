import { formatSeconds } from "./formatSeconds";

export type PodcastSegmentTimes = {
	startTime: number;
	endTime: number;
};

export function normalizePodcastSegmentTimes(
	startTime: number,
	endTime: number,
): PodcastSegmentTimes | null {
	if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
		return null;
	}

	const normalized = {
		startTime: Math.max(0, startTime),
		endTime: Math.max(0, endTime),
	};

	return normalized.endTime > normalized.startTime ? normalized : null;
}

export function createRecentPodcastSegment(
	currentTime: number,
	lengthSeconds: number,
	offsetSeconds = 0,
): PodcastSegmentTimes | null {
	if (!Number.isFinite(currentTime) || !Number.isFinite(lengthSeconds) || lengthSeconds <= 0) {
		return null;
	}

	const endTime = Math.max(0, currentTime - offsetSeconds);
	const startTime = Math.max(0, endTime - lengthSeconds);

	return normalizePodcastSegmentTimes(startTime, endTime);
}

export function formatPodcastSegment(startTime: number, endTime: number, format: string): string {
	return `${formatSeconds(Math.max(0, startTime), format)}-${formatSeconds(
		Math.max(0, endTime),
		format,
	)}`;
}

export function getSegmentCaptureTemplate(template: string): string {
	if (/\{\{(?:linksegment|segment)(?::\s*?.+?)?\}\}/i.test(template)) {
		return template;
	}

	const withLinkSegment = template.replace(/\{\{linktime(:\s*?.+?)?\}\}/gi, "{{linksegment$1}}");
	const withSegment = withLinkSegment.replace(/\{\{time(:\s*?.+?)?\}\}/gi, "{{segment$1}}");

	return withSegment === template ? "- {{linksegment}}" : withSegment;
}
