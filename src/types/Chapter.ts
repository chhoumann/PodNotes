/**
 * Represents a chapter in a podcast episode.
 * Based on the Podcasting 2.0 JSON Chapters format.
 * @see https://github.com/Podcastindex-org/podcast-namespace/blob/main/chapters/jsonChapters.md
 */
export interface Chapter {
    /** Start time in seconds */
    startTime: number;
    /** Optional end time in seconds */
    endTime?: number;
    /** Chapter title */
    title: string;
    /** Optional chapter artwork URL */
    img?: string;
    /** Optional link URL */
    url?: string;
    /** Whether this chapter should be hidden (ad, etc.) */
    toc?: boolean;
}

export interface ChaptersData {
    version: string;
    chapters: Chapter[];
}
