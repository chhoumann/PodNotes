import { FilePathTemplateEngine } from "src/TemplateEngine";
import type { Episode } from "src/types/Episode";
import {
	enforceMaxPathLength,
	lastSegmentExtension,
} from "src/utility/enforceMaxPathLength";

export function getEpisodeTranscriptPath(
	episode: Episode,
	transcriptPathTemplate: string,
): string {
	const rendered = FilePathTemplateEngine(transcriptPathTemplate, episode);
	return enforceMaxPathLength(rendered, lastSegmentExtension(rendered));
}
