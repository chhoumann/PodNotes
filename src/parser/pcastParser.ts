import { Episode } from "src/types/Episode";
import { Parser } from "./parser";

export class PocketCastsParser extends Parser {
    protected parsePage(page: Document): Episode {
        const audioPlayerEl = page.getElementById('audio_player');
		const headingEl = page.getElementsByTagName('h1')[0];
		const titleEl = page.querySelector('[property="og:title"]');
		const urlEl = page.querySelector('[property="og:url"]');
		const descriptionEl = page.querySelector('[property="og:description"]');
		const episodeDateEl = page.getElementById('episode_date');
		const artworkEl = page.getElementsByTagName('img');

		if (!audioPlayerEl || !headingEl || !titleEl || !episodeDateEl || !artworkEl || !urlEl) {
			throw new Error("Could not parse podcast");
		}

        const {title, podcastName} = this.parseTitleAndPodcastName(headingEl.innerText, titleEl.getAttribute('content') || "");
		const url = urlEl?.getAttribute('content') || "";
		const description = descriptionEl?.getAttribute('content') || "";
		const streamUrl = audioPlayerEl?.getAttribute('src');
		const episodeDate = episodeDateEl?.textContent;
		const artwork = artworkEl?.item(0)?.getAttribute('src') || undefined;


        if (!title || !streamUrl) {
            throw new Error("Unable to parse Pocket Cast podcast URL.");
        }

		return {
			title,
			podcastName,
			url,
			streamUrl,
			episodeDate: (episodeDate && new Date(episodeDate)) || undefined,
			artworkUrl: artwork,
			description,
		};
	}
	
	private parseTitleAndPodcastName(heading: string, meta: string): {title: string, podcastName: string} {
		if (meta.includes(heading)) {
			return {title: heading, podcastName: meta.replace(`${heading} - `, "")};
		}

		console.log(meta);

		return {title: heading, podcastName: ""};
	}
}
