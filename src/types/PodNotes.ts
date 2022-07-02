export type PodNote = {
	episodeName: string;
	filePath: string;
	podcastFeedKey: string;
}

/**
 * @param {string} Episode name
 * @param {PodNote} Note
 */
export type PodNotes = Map<string, PodNote>;
